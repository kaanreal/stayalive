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
    this.colliders = new Map()
    this.columns = new Set()
    this.pending = new Map()
    this.dirtySections = new Map()
    this.version = null
    this.epoch = 0
    this.minY = 0
    this.height = 256
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.1 })
    this.translucentMaterial = this.material.clone()
    this.translucentMaterial.transparent = true
    this.translucentMaterial.depthWrite = false
    // The worker bundle is 63 MB. Chrome fails every request but one when several workers load the same URL
    // at once, which silently dropped most of the world, so each worker gets its own URL.
    this.workers = Array.from({ length: workers }, (_, i) => {
      const worker = new Worker(`/play/mesher.js?worker=${i}`)
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
      if (this.version !== version) return
      const texture = new THREE.Texture(image)
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      const size = Math.floor(image.width / TILE)
      const tiles = new Uint8Array(size * size)
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const alpha = pixels[(y * image.width + x) * 4 + 3]
        if (alpha > 25 && alpha < 240) tiles[Math.floor(y / TILE) * size + Math.floor(x / TILE)] = 1
      }
      for (const worker of this.workers) worker.postMessage({ type: 'atlasAlpha', tiles, size })
      for (const column of this.columns) { const [x, z] = column.split(',').map(Number); this.sections(y => this.dirty(x, y, z)) }
      texture.magFilter = THREE.NearestFilter
      texture.flipY = false
      texture.encoding = THREE.sRGBEncoding
      if (this.tileMipmaps && image.width === image.height && image.width >= TILE * 2) {
        texture.mipmaps = tileMipmaps(image)
        texture.generateMipmaps = false
        texture.minFilter = THREE.NearestMipmapLinearFilter
        tileSampling(this.material, image.width)
        tileSampling(this.translucentMaterial, image.width)
      } else {
        texture.generateMipmaps = false
        texture.minFilter = THREE.NearestFilter
      }
      texture.needsUpdate = true
      this.material.map = texture
      this.material.needsUpdate = true
      this.translucentMaterial.map = texture
      this.translucentMaterial.needsUpdate = true
    })
    fetch(`/play/blocksStates/${version}.json`).then(r => r.json()).then(json => {
      if (this.version !== version) return
      for (const worker of this.workers) worker.postMessage({ type: 'blockStates', json })
    })
  }

  reset () {
    for (const mesh of this.meshes.values()) this.drop(mesh)
    this.meshes.clear()
    this.colliders.clear()
    this.columns.clear()
    this.pending.clear()
    this.dirtySections.clear()
    this.version = null
    this.epoch++
    for (const worker of this.workers) worker.postMessage({ type: 'reset', epoch: this.epoch })
  }

  drop (mesh) {
    const key = mesh.userData.section
    for (const collider of this.colliders.get(key) || []) collider.geometry.dispose()
    this.colliders.delete(key)
    this.scene.remove(mesh)
    mesh.geometry.dispose()
  }

  receive (data) {
    if (data.type !== 'geometry' || (data.epoch !== undefined && data.epoch !== this.epoch)) return
    this.pending.set(data.key, data)
  }

  // Coalesce border rebuilds and spread geometry uploads across rendered frames.
  flush () {
    for (const data of this.dirtySections.values()) {
      const worker = this.workers[mod(Math.floor(data.x / 16) + Math.floor(data.y / 16) + Math.floor(data.z / 16), this.workers.length)]
      worker.postMessage(data)
    }
    this.dirtySections.clear()
    const started = performance.now()
    let count = 0
    for (const [key, data] of this.pending) {
      this.pending.delete(key)
      this.install(data)
      if (++count >= 2 || performance.now() - started >= 3) break
    }
  }

  install (data) {
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
    geometry.setAttribute('uvRect', new THREE.BufferAttribute(g.uvRects, 4))
    geometry.setIndex(new THREE.BufferAttribute(g.indices, 1))
    geometry.addGroup(0, g.opaqueCount, 0)
    geometry.addGroup(g.opaqueCount, g.indices.length - g.opaqueCount, 1)
    const mesh = new THREE.Mesh(geometry, [this.material, this.translucentMaterial])
    mesh.position.set(g.sx, g.sy, g.sz)
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    mesh.updateMatrixWorld(true)
    mesh.userData.section = data.key
    this.colliders.set(data.key, (g.collision || []).map(({ cell, indices }) => {
      const collision = new THREE.BufferGeometry()
      collision.setAttribute('position', geometry.getAttribute('position'))
      collision.setIndex(new THREE.BufferAttribute(indices, 1))
      const min = new THREE.Vector3(...cell.map(value => value * 4 - 8))
      collision.boundingBox = new THREE.Box3(min, min.clone().addScalar(4))
      collision.boundingSphere = collision.boundingBox.getBoundingSphere(new THREE.Sphere())
      const collider = new THREE.Mesh(collision, this.material)
      collider.position.copy(mesh.position)
      collider.updateMatrixWorld(true)
      return collider
    }))
    this.meshes.set(data.key, mesh)
    this.scene.add(mesh)
  }

  dirty (x, y, z, value = true) {
    const key = `${Math.floor(x / 16)},${Math.floor(y / 16)},${Math.floor(z / 16)}`
    this.dirtySections.set(key, { type: 'dirty', x, y, z, value })
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

  collisionNear (position) {
    const list = []
    for (const mesh of this.near(position)) {
      for (const collider of this.colliders.get(mesh.userData.section) || []) {
        const center = collider.geometry.boundingSphere.center.clone().add(collider.position)
        if (center.distanceTo(position) <= 5 + collider.geometry.boundingSphere.radius) list.push(collider)
      }
    }
    return list
  }
}
