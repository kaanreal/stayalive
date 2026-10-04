// Entities: models from prismarine-viewer's entities.json (ported from its Entity.js), real player skins,
// nameplates and simple walk and head animation.
import * as THREE from '/vendor/three.js'
import { textRuns } from './mechanics.js'

const faces = {
  up: { dir: [0, 1, 0], u0: [0, 0, 1], v0: [0, 0, 0], u1: [1, 0, 1], v1: [0, 0, 1], corners: [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [0, 1, 0, 0, 1], [1, 1, 0, 1, 1]] },
  down: { dir: [0, -1, 0], u0: [1, 0, 1], v0: [0, 0, 0], u1: [2, 0, 1], v1: [0, 0, 1], corners: [[1, 0, 1, 0, 0], [0, 0, 1, 1, 0], [1, 0, 0, 0, 1], [0, 0, 0, 1, 1]] },
  east: { dir: [1, 0, 0], u0: [0, 0, 0], v0: [0, 0, 1], u1: [0, 0, 1], v1: [0, 1, 1], corners: [[1, 1, 1, 0, 0], [1, 0, 1, 0, 1], [1, 1, 0, 1, 0], [1, 0, 0, 1, 1]] },
  west: { dir: [-1, 0, 0], u0: [1, 0, 1], v0: [0, 0, 1], u1: [1, 0, 2], v1: [0, 1, 1], corners: [[0, 1, 0, 0, 0], [0, 0, 0, 0, 1], [0, 1, 1, 1, 0], [0, 0, 1, 1, 1]] },
  north: { dir: [0, 0, -1], u0: [0, 0, 1], v0: [0, 0, 1], u1: [1, 0, 1], v1: [0, 1, 1], corners: [[1, 0, 0, 0, 1], [0, 0, 0, 1, 1], [1, 1, 0, 0, 0], [0, 1, 0, 1, 0]] },
  south: { dir: [0, 0, 1], u0: [1, 0, 2], v0: [0, 0, 1], u1: [2, 0, 2], v1: [0, 1, 1], corners: [[0, 0, 1, 0, 1], [1, 0, 1, 1, 1], [0, 1, 1, 0, 0], [1, 1, 1, 1, 0]] }
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function addCube (attr, boneId, bone, cube, texWidth = 64, texHeight = 64) {
  const rotation = new THREE.Euler(...(cube.rotation || [0, 0, 0]).map(r => -r * Math.PI / 180))
  const inflate = cube.inflate || 0
  for (const { dir, corners, u0, v0, u1, v1 } of Object.values(faces)) {
    const base = attr.positions.length / 3
    for (const pos of corners) {
      attr.uvs.push((cube.uv[0] + dot(pos[3] ? u1 : u0, cube.size)) / texWidth, (cube.uv[1] + dot(pos[4] ? v1 : v0, cube.size)) / texHeight)
      const v = new THREE.Vector3(
        cube.origin[0] + pos[0] * cube.size[0] + (pos[0] ? inflate : -inflate),
        cube.origin[1] + pos[1] * cube.size[1] + (pos[1] ? inflate : -inflate),
        cube.origin[2] + pos[2] * cube.size[2] + (pos[2] ? inflate : -inflate)
      ).applyEuler(rotation).sub(bone.position).applyEuler(bone.rotation).add(bone.position)
      attr.positions.push(v.x, v.y, v.z)
      attr.normals.push(...dir)
      attr.skinIndices.push(boneId, 0, 0, 0)
      attr.skinWeights.push(1, 0, 0, 0)
    }
    attr.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
  }
}

function buildMesh (model) {
  const bones = {}
  const attr = { positions: [], normals: [], uvs: [], indices: [], skinIndices: [], skinWeights: [] }
  model.bones.forEach((json, i) => {
    const bone = new THREE.Bone()
    bone.name = json.name
    if (json.pivot) bone.position.set(...json.pivot)
    const rotation = json.bind_pose_rotation || json.rotation
    if (rotation) bone.rotation.set(...rotation.map(r => -r * Math.PI / 180))
    bones[json.name] = bone
    for (const cube of json.cubes || []) addCube(attr, i, bone, cube, model.texturewidth, model.textureheight)
  })
  const roots = []
  for (const json of model.bones) {
    if (json.parent && bones[json.parent]) {
      // Bedrock model pivots are absolute; Three's child bone positions are relative.
      const parent = model.bones.find(bone => bone.name === json.parent)
      bones[json.name].position.sub(new THREE.Vector3(...(parent.pivot || [0, 0, 0])))
      bones[json.parent].add(bones[json.name])
    }
    else roots.push(bones[json.name])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(attr.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(attr.normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(attr.uvs, 2))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(attr.skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(attr.skinWeights, 4))
  geometry.setIndex(attr.indices)
  const material = new THREE.MeshLambertMaterial({ skinning: true, alphaTest: 0.1 })
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.add(...roots)
  mesh.bind(new THREE.Skeleton(Object.values(bones)))
  mesh.scale.setScalar(1 / 16)
  return { mesh, bones }
}

// Slim ("Alex") skins have three pixel wide arms.
function slimGeometry (geometry) {
  const copy = structuredClone(geometry)
  for (const bone of copy.bones) {
    if (!/^(left|right)(Arm|Sleeve)$/.test(bone.name)) continue
    for (const cube of bone.cubes || []) {
      cube.size[0] = 3
      if (bone.name.startsWith('right')) cube.origin[0] += 1
    }
  }
  return copy
}

let catalogue = null
export const loadModels = () => (catalogue ??= fetch('/play/entities.json').then(r => r.json()))

const textureLoader = new THREE.TextureLoader()
function pixelTexture (texture) {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.flipY = false
  texture.encoding = THREE.sRGBEncoding
  return texture
}

// Old 64×32 skins get their left limbs mirrored from the right ones, as the game does.
function upgradeSkin (image) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  if (image.height === 32) {
    const copy = (sx, sy, w, h, dx, dy) => {
      const data = ctx.getImageData(sx, sy, w, h)
      const flipped = ctx.createImageData(w, h)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) flipped.data[(y * w + x) * 4 + c] = data.data[(y * w + (w - 1 - x)) * 4 + c]
      ctx.putImageData(flipped, dx, dy)
    }
    copy(4, 16, 4, 4, 20, 48); copy(8, 16, 4, 4, 24, 48); copy(0, 20, 4, 12, 24, 52); copy(4, 20, 4, 12, 20, 52); copy(8, 20, 4, 12, 16, 52); copy(12, 20, 4, 12, 28, 52)
    copy(44, 16, 4, 4, 36, 48); copy(48, 16, 4, 4, 40, 48); copy(40, 20, 4, 12, 40, 52); copy(44, 20, 4, 12, 36, 52); copy(48, 20, 4, 12, 32, 52); copy(52, 20, 4, 12, 44, 52)
    // Legacy skins often fill the hat layer with an opaque color; the game ignores it.
    const hat = ctx.getImageData(32, 0, 32, 16).data
    let opaque = true
    for (let i = 3; i < hat.length; i += 4) if (hat[i] < 255) { opaque = false; break }
    if (opaque) ctx.clearRect(32, 0, 32, 16)
  }
  return pixelTexture(new THREE.CanvasTexture(canvas))
}

const skins = new Map()
export function skinTexture (hash, slim) {
  const url = hash ? `/play/skin/${hash}.png` : `/play/textures/1.16.4/entity/${slim ? 'alex' : 'steve'}.png`
  if (!skins.has(url)) {
    skins.set(url, new Promise(resolve => {
      const image = new Image()
      image.onload = () => resolve(upgradeSkin(image))
      image.onerror = () => resolve(hash ? skinTexture(null, slim) : null)
      image.src = url
    }))
  }
  return skins.get(url)
}

const modelTextures = new Map()
function modelTexture (path) {
  if (!modelTextures.has(path)) modelTextures.set(path, pixelTexture(textureLoader.load(`/play/${path.replace('textures/', 'textures/1.16.4/')}.png`)))
  return modelTextures.get(path)
}

// A nameplate like the game's: white text on a translucent dark plate, visible through walls.
function nameplate (text) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const runs = textRuns(text)
  const font = run => `${run.italic ? 'italic ' : ''}${run.bold ? '700' : '400'} 30px "Segoe UI", system-ui, sans-serif`
  canvas.width = Math.ceil(runs.reduce((width, run) => { ctx.font = font(run); return width + ctx.measureText(run.text).width }, 0)) + 20
  canvas.height = 42
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let x = 10
  for (const run of runs) {
    ctx.font = font(run)
    const width = ctx.measureText(run.text).width
    ctx.fillStyle = '#0008'
    ctx.fillText(run.text, x + 2, canvas.height / 2 + 3)
    ctx.fillStyle = run.color || '#ffffff'
    ctx.fillText(run.text, x, canvas.height / 2 + 1)
    if (run.underline) ctx.fillRect(x, 35, width, 2)
    if (run.strike) ctx.fillRect(x, 22, width, 2)
    x += width
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.encoding = THREE.sRGBEncoding
  texture.minFilter = THREE.LinearFilter
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true }))
  const scale = 0.26 / canvas.height
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1)
  sprite.renderOrder = 10
  return sprite
}

const angle = a => Math.atan2(Math.sin(a), Math.cos(a))
const damp = (dt, seconds) => 1 - Math.exp(-dt / seconds)

class EntityView {
  constructor (data, models) {
    this.id = data.id
    this.group = new THREE.Group()
    this.target = new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z)
    this.group.position.copy(this.target)
    this.yaw = this.targetYaw = data.yaw || 0
    this.headYaw = data.headYaw ?? this.yaw
    this.pitch = data.pitch || 0
    this.speed = 0
    this.phase = 0
    this.bones = {}
    this.base = {}
    this.apply(data, models)
  }

  apply (data, models) {
    this.local = Boolean(data.local)
    const key = `${data.model}|${data.skin}|${data.slim}|${data.invisible}`
    if (key !== this.key) {
      this.key = key
      if (this.model) { this.group.remove(this.model); this.model.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.() }) }
      this.model = null
      this.cape = null
      this.capeHash = undefined
      this.bones = {}
      const entry = models[data.model]
      if (entry && !data.invisible) {
        this.model = new THREE.Object3D()
        for (const [name, geometry] of Object.entries(entry.geometry)) {
          if (name !== 'default' || !entry.textures[name]) continue
          const { mesh, bones } = buildMesh(data.model === 'player' && data.slim ? slimGeometry(geometry) : geometry)
          if (data.model === 'player') mesh.scale.multiplyScalar(0.9375)
          if (data.model === 'player') skinTexture(data.skin, data.slim).then(texture => { mesh.material.map = texture; mesh.material.needsUpdate = true })
          else { mesh.material.map = modelTexture(entry.textures[name]); mesh.material.needsUpdate = true }
          Object.assign(this.bones, bones)
          this.model.add(mesh)
        }
        for (const [name, bone] of Object.entries(this.bones)) this.base[name] = bone.rotation.clone()
        this.group.add(this.model)
      }
    }
    if (data.label !== this.label) {
      this.label = data.label
      if (this.tag) { this.group.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose() }
      this.tag = data.label ? nameplate(data.label) : null
      if (this.tag) this.group.add(this.tag)
    }
    this.height = data.height || 1.8
    if (data.cape !== this.capeHash) {
      this.capeHash = data.cape
      if (this.cape) { this.cape.parent.remove(this.cape); this.cape.geometry.dispose(); this.cape.material.dispose(); this.cape = null }
      if (data.cape && this.bones.cape) {
        const attr = { positions: [], normals: [], uvs: [], indices: [], skinIndices: [], skinWeights: [] }
        addCube(attr, 0, new THREE.Bone(), { origin: [-5, -16, 0], size: [10, 16, 1], uv: [0, 0] }, 64, 32)
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(attr.positions, 3))
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(attr.normals, 3))
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(attr.uvs, 2))
        geometry.setIndex(attr.indices)
        const texture = pixelTexture(textureLoader.load(`/play/skin/${data.cape}.png`))
        this.cape = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.1 }))
        this.bones.cape.add(this.cape)
      }
    }
    this.sneaking = Boolean(data.sneaking)
    if (this.tag) this.tag.position.y = this.height + (this.model ? 0.35 : 0) - (this.sneaking ? 0.3 : 0)
    if (data.pos) this.moveTo(data)
  }

  moveTo (data) {
    const now = performance.now()
    if (data.pos || data.x !== undefined) {
      const next = data.pos ? data.pos : data
      if (this.lastMove) {
        const elapsed = Math.max(0.03, (now - this.lastMove) / 1000)
        const moved = Math.hypot(next.x - this.target.x, next.z - this.target.z) / elapsed
        this.speed += (Math.min(moved, 10) - this.speed) * 0.5
      }
      this.lastMove = now
      this.target.set(next.x, next.y, next.z)
    }
    if (data.yaw !== undefined) this.targetYaw = data.yaw
    if (data.headYaw !== undefined) this.targetHeadYaw = data.headYaw
    if (data.pitch !== undefined) this.targetPitch = data.pitch
  }

  rotate (name, x = 0, y = 0, z = 0) {
    const bone = this.bones[name]
    if (bone) bone.rotation.set(this.base[name].x + x, this.base[name].y + y, this.base[name].z + z)
  }

  update (dt, camera) {
    if (this.local) {
      this.group.position.copy(this.target)
      this.yaw = this.targetYaw
      this.headYaw = this.targetHeadYaw ?? this.targetYaw
      this.pitch = this.targetPitch ?? 0
    } else {
      this.group.position.lerp(this.target, damp(dt, 0.07))
      if (performance.now() - (this.lastMove || 0) > 250) this.speed *= 1 - damp(dt, 0.15)
      this.yaw += angle(this.targetYaw - this.yaw) * damp(dt, 0.08)
      this.headYaw += angle((this.targetHeadYaw ?? this.targetYaw) - this.headYaw) * damp(dt, 0.06)
      this.pitch += ((this.targetPitch ?? 0) - this.pitch) * damp(dt, 0.06)
    }
    this.group.rotation.y = this.yaw
    if (this.tag) this.tag.visible = this.group.position.distanceTo(camera.position) < 64
    if (!this.model) return
    // Walk cycle from speed; the head turns relative to the body.
    const amount = Math.min(1, this.speed / 4.3)
    this.phase += dt * (4 + this.speed * 1.6) * (amount > 0.05 ? 1 : 0)
    const swing = Math.sin(this.phase) * 0.9 * amount
    this.rotate('head', this.pitch, Math.max(-1.2, Math.min(1.2, angle(this.headYaw - this.yaw))))
    this.rotate('rightLeg', swing); this.rotate('leftLeg', -swing)
    this.rotate('rightArm', -swing * 0.8); this.rotate('leftArm', swing * 0.8)
    if (this.swingUntil > performance.now()) {
      const progress = 1 - (this.swingUntil - performance.now()) / 350
      this.rotate('rightArm', -Math.sin(progress * Math.PI) * 1.8)
    }
    this.model.traverse(object => {
      if (object.material?.color) object.material.color.set(this.hurtUntil > performance.now() ? 0xff6666 : 0xffffff)
    })
    this.rotate('leg0', swing); this.rotate('leg3', swing); this.rotate('leg1', -swing); this.rotate('leg2', -swing)
    this.rotate('body', this.sneaking ? -0.45 : 0)
    this.model.position.y = this.sneaking ? -0.2 : 0
    if (this.cape) this.cape.rotation.x = -(6 + Math.min(55, this.speed * 7) + Math.sin(this.phase) * amount * 8 + (this.sneaking ? 25 : 0)) * Math.PI / 180
  }

  dispose (scene) {
    scene.remove(this.group)
    this.group.traverse(o => { o.geometry?.dispose(); if (o.material && o.material.map && o.isSprite) o.material.map.dispose(); o.material?.dispose?.() })
  }
}

export class EntityManager {
  constructor (scene) {
    this.scene = scene
    this.entities = new Map()
    this.models = null
    this.pending = []
    loadModels().then(models => {
      this.models = models
      for (const data of this.pending) this.update(data)
      this.pending = []
    })
  }

  update (data) {
    if (!this.models) { this.pending.push(data); return }
    const existing = this.entities.get(data.id)
    if (data.delete) {
      if (existing) { existing.dispose(this.scene); this.entities.delete(data.id) }
      return
    }
    if (existing) { existing.apply(data, this.models); return }
    const view = new EntityView(data, this.models)
    this.entities.set(data.id, view)
    this.scene.add(view.group)
  }

  move (data) {
    this.entities.get(data.id)?.moveTo(data)
  }

  event (data) {
    const entity = this.entities.get(data.id)
    if (!entity) return
    if (data.swing) entity.swingUntil = performance.now() + 350
    if (data.hurt) entity.hurtUntil = performance.now() + 400
  }

  clear () {
    for (const view of this.entities.values()) view.dispose(this.scene)
    this.entities.clear()
  }

  tick (dt, camera) {
    for (const view of this.entities.values()) view.update(dt, camera)
  }
}
