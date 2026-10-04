// World meshes: chunk columns go to prismarine-viewer's meshing workers, which return one mesh per 16³ section.
import * as THREE from '/vendor/three.js'

const mod = (x, n) => ((x % n) + n) % n
const TILE = 16
const CLEAN_LEVELS = 4 // 16 px tiles stay separate down to 1 px each

// Mipmaps built tile by tile, so distant blocks blend only their own texture (alpha-weighted, like the game).
function tileMipmaps (image) {
  const levels = []
  let canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext('2d').drawImage(image, 0, 0)
  levels.push(canvas)
  let size = image.width
  let block = TILE
  while (size > 1) {
    const source = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, size, size).data
    const next = size / 2
    const target = new ImageData(next, next)
    // Past the clean levels a tile is under one pixel; neighbours merge, but the shader never samples those levels.
    block = Math.max(1, block / 2)
    for (let y = 0; y < next; y++) {
      for (let x = 0; x < next; x++) {
        let r = 0; let g = 0; let b = 0; let a = 0
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const i = ((y * 2 + dy) * size + x * 2 + dx) * 4
          const alpha = source[i + 3]
          r += source[i] * alpha; g += source[i + 1] * alpha; b += source[i + 2] * alpha; a += alpha
        }
        const o = (y * next + x) * 4
        if (a) { target.data[o] = r / a; target.data[o + 1] = g / a; target.data[o + 2] = b / a }
        target.data[o + 3] = a / 4
      }
    }
    canvas = document.createElement('canvas')
    canvas.width = canvas.height = next
    canvas.getContext('2d').putImageData(target, 0, 0)
    levels.push(canvas)
    size = next
  }
  return levels
}

// Keeps every texture lookup inside its own atlas tile, at the mip level the GPU will read.
function tileSampling (material, atlasSize) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 uvRect;\nvarying vec4 vUvRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUvRect = uvRect;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vUvRect;')
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 atlas = vec2(${atlasSize.toFixed(1)});
          vec2 gx = dFdx(vUv);
          vec2 gy = dFdy(vUv);
          float lod = log2(max(max(length(gx * atlas), length(gy * atlas)), 1e-6));
          float capped = clamp(lod, 0.0, ${CLEAN_LEVELS.toFixed(1)});
          float shrink = exp2(capped - max(lod, 0.0));
          vec2 halfTexel = 0.5 * exp2(min(ceil(capped), ${CLEAN_LEVELS.toFixed(1)})) / atlas;
          vec2 lo = vUvRect.xy + halfTexel;
          vec2 hi = vUvRect.zw - halfTexel;
          vec2 tileUv = clamp(vUv, min(lo, hi), max(lo, hi));
          vec4 texelColor = mapTexelToLinear(textureGrad(map, tileUv, gx * shrink, gy * shrink));
          diffuseColor *= texelColor;
        #endif`)
  }
}

export class WorldMeshes {
  constructor (scene, workers = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 1))) {
    this.scene = scene
    this.meshes = new Map()
    this.columns = new Set()
    this.version = null
    this.minY = 0
    this.height = 256
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, alphaTest: 0.1 })
    // The worker bundle is 63 MB. Chrome fails every request but one when several workers load the same URL
    // at once, which silently dropped most of the world, so each worker gets its own URL.
    this.workers = Array.from({ length: workers }, (_, i) => {
      const worker = new Worker(`/play/worker.js?worker=${i}`)
      worker.onmessage = ({ data }) => this.receive(data)
      worker.onerror = event => console.error('Meshing worker:', event.message)
      return worker
    })
  }

  // Mipmapped, tile-clamped sampling needs WebGL2 (textureGrad); otherwise textures stay nearest-filtered.
  useTileMipmaps (enabled) { this.tileMipmaps = enabled }

  setVersion (version, minY = 0, height = 256) {
    this.minY = minY
    this.height = height
    if (version === this.version) return
    this.reset()
    this.version = version
    for (const worker of this.workers) worker.postMessage({ type: 'version', version })
    new THREE.ImageLoader().load(`/play/textures/${version}.png`, image => {
      const texture = new THREE.Texture(image)
      texture.magFilter = THREE.NearestFilter
      texture.flipY = false
      if (this.tileMipmaps && image.width === image.height && image.width >= TILE * 2) {
        texture.mipmaps = tileMipmaps(image)
        texture.generateMipmaps = false
        texture.minFilter = THREE.NearestMipmapLinearFilter
        tileSampling(this.material, image.width)
      } else {
        texture.generateMipmaps = false
        texture.minFilter = THREE.NearestFilter
      }
      texture.needsUpdate = true
      this.material.map = texture
      this.material.needsUpdate = true
    })
    fetch(`/play/blocksStates/${version}.json`).then(r => r.json()).then(json => {
      for (const worker of this.workers) worker.postMessage({ type: 'blockStates', json })
    })
  }

  reset () {
    for (const mesh of this.meshes.values()) this.drop(mesh)
    this.meshes.clear()
    this.columns.clear()
    this.version = null
    for (const worker of this.workers) worker.postMessage({ type: 'reset' })
  }

  drop (mesh) {
    this.scene.remove(mesh)
    mesh.geometry.dispose()
  }

  receive (data) {
    if (data.type !== 'geometry') return
    const old = this.meshes.get(data.key)
    if (old) { this.drop(old); this.meshes.delete(data.key) }
    const [x, , z] = data.key.split(',')
    if (!this.columns.has(`${x},${z}`) || !data.geometry.positions.length) return
    const g = data.geometry
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(g.colors, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2))
    // Each face is four vertices; record the atlas rectangle it samples from.
    const rects = new Float32Array(g.uvs.length * 2)
    for (let v = 0; v < g.uvs.length / 2; v += 4) {
      let minU = Infinity; let minV = Infinity; let maxU = -Infinity; let maxV = -Infinity
      for (let k = v; k < v + 4; k++) {
        const u = g.uvs[k * 2]; const w = g.uvs[k * 2 + 1]
        if (u < minU) minU = u; if (u > maxU) maxU = u; if (w < minV) minV = w; if (w > maxV) maxV = w
      }
      for (let k = v; k < v + 4; k++) rects.set([minU, minV, maxU, maxV], k * 4)
    }
    geometry.setAttribute('uvRect', new THREE.BufferAttribute(rects, 4))
    geometry.setIndex(g.indices)
    const mesh = new THREE.Mesh(geometry, this.material)
    mesh.position.set(g.sx, g.sy, g.sz)
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    this.meshes.set(data.key, mesh)
    this.scene.add(mesh)
  }

  dirty (x, y, z, value = true) {
    const worker = this.workers[mod(Math.floor(x / 16) + Math.floor(y / 16) + Math.floor(z / 16), this.workers.length)]
    worker.postMessage({ type: 'dirty', x, y, z, value })
  }

  sections (fn) {
    for (let y = this.minY; y < this.minY + this.height; y += 16) fn(y)
  }

  addColumn (x, z, chunk) {
    this.columns.add(`${x},${z}`)
    for (const worker of this.workers) worker.postMessage({ type: 'chunk', x, z, chunk })
    this.sections(y => {
      this.dirty(x, y, z)
      // Neighbours re-mesh so faces along the shared border are culled.
      for (const [dx, dz] of [[-16, 0], [16, 0], [0, -16], [0, 16]]) {
        if (this.columns.has(`${x + dx},${z + dz}`)) this.dirty(x + dx, y, z + dz)
      }
    })
  }

  removeColumn (x, z) {
    if (!this.columns.delete(`${x},${z}`)) return
    for (const worker of this.workers) worker.postMessage({ type: 'unloadChunk', x, z })
    this.sections(y => {
      this.dirty(x, y, z, false)
      const key = `${x},${y},${z}`
      const mesh = this.meshes.get(key)
      if (mesh) { this.drop(mesh); this.meshes.delete(key) }
    })
  }

  setBlock (x, y, z, stateId) {
    for (const worker of this.workers) worker.postMessage({ type: 'blockUpdate', pos: { x, y, z }, stateId })
    this.dirty(x, y, z)
    if ((x & 15) === 0) this.dirty(x - 16, y, z)
    if ((x & 15) === 15) this.dirty(x + 16, y, z)
    if ((y & 15) === 0) this.dirty(x, y - 16, z)
    if ((y & 15) === 15) this.dirty(x, y + 16, z)
    if ((z & 15) === 0) this.dirty(x, y, z - 16)
    if ((z & 15) === 15) this.dirty(x, y, z + 16)
  }

  // Nearby section meshes, for picking the block under the crosshair.
  near (position, range = 1) {
    const sx = Math.floor(position.x / 16) * 16
    const sy = Math.floor(position.y / 16) * 16
    const sz = Math.floor(position.z / 16) * 16
    const list = []
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        for (let dz = -range; dz <= range; dz++) {
          const mesh = this.meshes.get(`${sx + dx * 16},${sy + dy * 16},${sz + dz * 16}`)
          if (mesh) list.push(mesh)
        }
      }
    }
    return list
  }
}
