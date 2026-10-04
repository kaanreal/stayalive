const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const THREE = require('three')

function world () {
  const messages = []
  const context = {
    THREE, navigator: { hardwareConcurrency: 2 }, performance: { now: () => 0 }, exports: {},
    Worker: class { postMessage (data) { messages.push(data) } }
  }
  const source = fs.readFileSync('public/js/play/world.js', 'utf8')
    .replace("import * as THREE from '/vendor/three.js'", '')
    .replace('export class WorldMeshes', 'exports.WorldMeshes = class WorldMeshes')
  vm.runInNewContext(source, context)
  return { meshes: new context.exports.WorldMeshes(new THREE.Scene(), 1), messages }
}

test('chunk uploads are bounded per frame and repeated section work is coalesced', () => {
  const { meshes, messages } = world()
  meshes.dirty(1, 64, 1)
  meshes.dirty(2, 65, 2)
  for (let i = 0; i < 8; i++) meshes.receive({ type: 'geometry', key: `${i},64,0` })
  meshes.receive({ type: 'geometry', key: '0,64,0', latest: true })
  const installed = []
  meshes.install = data => installed.push(data)
  meshes.flush()
  assert.equal(messages.filter(data => data.type === 'dirty').length, 1)
  assert.equal(installed.length, 2)
  assert.equal(installed[0].latest, true)
  assert.equal(meshes.pending.size, 6)
  for (let i = 0; i < 3; i++) meshes.flush()
  assert.equal(installed.length, 8)
  assert.equal(meshes.pending.size, 0)
  meshes.receive({ type: 'geometry', key: '0,64,0' })
  meshes.dirty(0, 64, 0)
  meshes.reset()
  assert.equal(meshes.pending.size, 0)
  assert.equal(meshes.dirtySections.size, 0)
  meshes.receive({ type: 'geometry', key: '0,64,0', epoch: meshes.epoch - 1 })
  assert.equal(meshes.pending.size, 0)
})

test('the meshing worker transfers atlas bounds without changing the original UVs', () => {
  let result
  const context = {
    self: { location: { search: '?worker=1' }, postMessage: (data, transfer) => { result = { data, transfer } } },
    importScripts: url => assert.equal(url, '/play/worker.js?worker=1')
  }
  vm.runInNewContext(fs.readFileSync('public/js/play/mesher.js', 'utf8'), context)
  const uvs = new Float32Array([0.25, 0.5, 0.5, 0.5, 0.5, 0.75, 0.25, 0.75])
  const positions = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1])
  context.self.postMessage({ type: 'geometry', geometry: { uvs, positions, indices: [0, 1, 2, 0, 2, 3] } }, [uvs.buffer])
  assert.deepEqual(Array.from(result.data.geometry.uvRects), Array(4).fill([0.25, 0.5, 0.5, 0.75]).flat())
  assert.equal(result.data.geometry.uvs, uvs)
  assert.equal(result.transfer[1], result.data.geometry.uvRects.buffer)
  assert.ok(result.data.geometry.collision.length > 0)
  assert.equal(result.data.geometry.opaqueCount, 6)
  context.self.onmessage({ data: { type: 'atlasAlpha', size: 4, tiles: new Uint8Array(16).fill(1) } })
  context.self.postMessage({ type: 'geometry', geometry: { uvs, positions, indices: [0, 1, 2, 0, 2, 3] } }, [])
  assert.equal(result.data.geometry.opaqueCount, 0)
  assert.equal(result.data.geometry.indices.length, 6)
})

test('camera collision regions preserve ray hits at their shared boundaries', () => {
  let geometry
  const context = { self: { location: { search: '' }, postMessage: data => { geometry = data.geometry } }, importScripts: () => {} }
  vm.runInNewContext(fs.readFileSync('public/js/play/mesher.js', 'utf8'), context)
  context.self.postMessage({ type: 'geometry', geometry: {
    sx: 8, sy: 8, sz: 8,
    positions: new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]),
    normals: new Float32Array(12), colors: new Float32Array(12).fill(1),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), indices: [0, 2, 1, 0, 3, 2]
  } })
  const { meshes } = world()
  meshes.columns.add('0,0')
  meshes.install({ key: '0,0,0', geometry })
  for (const x of [7.2, 8, 8.8]) for (const z of [7.2, 8, 8.8]) {
    const origin = new THREE.Vector3(x, 10, z)
    const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 5)
    const full = ray.intersectObjects(meshes.near(origin), false)[0]
    const partitioned = ray.intersectObjects(meshes.collisionNear(origin), false)[0]
    assert.ok(full)
    assert.equal(partitioned?.distance, full.distance)
    assert.deepEqual(partitioned.point.toArray(), full.point.toArray())
  }
})
