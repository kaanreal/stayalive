// Java Edition models, rebuilt from the game's own definitions: ModelBox geometry and UVs, ModelPlayer parts,
// ModelBiped animation (setRotationAngles), armor layers and generated (extruded) item models.
import * as THREE from '/vendor/three.js'

const DEG = Math.PI / 180

// ModelBox: a cuboid in model pixels with the vanilla texture layout. Model space is y-down, like the game.
export function boxGeometry ([tx, ty], [x, y, z], [dx, dy, dz], delta = 0, { mirror = false, texW = 64, texH = 64, scale = 1 / 16 } = {}) {
  let x1 = x - delta; let x2 = x + dx + delta
  const y1 = y - delta; const y2 = y + dy + delta
  const z1 = z - delta; const z2 = z + dz + delta
  if (mirror) [x1, x2] = [x2, x1]
  const v = [[x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1], [x1, y1, z2], [x2, y1, z2], [x2, y2, z2], [x1, y2, z2]]
  // [vertex indices, u1, v1, u2, v2] per TexturedQuad
  const quads = [
    [[5, 1, 2, 6], tx + dz + dx, ty + dz, tx + dz + dx + dz, ty + dz + dy],
    [[0, 4, 7, 3], tx, ty + dz, tx + dz, ty + dz + dy],
    [[5, 4, 0, 1], tx + dz, ty, tx + dz + dx, ty + dz],
    [[2, 3, 7, 6], tx + dz + dx, ty + dz, tx + dz + dx + dx, ty],
    [[1, 0, 3, 2], tx + dz, ty + dz, tx + dz + dx, ty + dz + dy],
    [[4, 5, 6, 7], tx + dz + dx + dz, ty + dz, tx + dz + dx + dz + dx, ty + dz + dy]
  ]
  const positions = []; const uvs = []; const normals = []; const indices = []
  for (const [ids, u1, v1, u2, v2] of quads) {
    const corners = ids.map(i => v[i])
    // TexturedQuad: vertex 0 → (u2, v1), 1 → (u1, v1), 2 → (u1, v2), 3 → (u2, v2); mirroring flips the order.
    let tex = [[u2, v1], [u1, v1], [u1, v2], [u2, v2]]
    let order = [0, 1, 2, 3]
    if (mirror) { order = [3, 2, 1, 0]; tex = [tex[3], tex[2], tex[1], tex[0]] }
    const base = positions.length / 3
    const a = new THREE.Vector3(...corners[order[1]]).sub(new THREE.Vector3(...corners[order[0]]))
    const b = new THREE.Vector3(...corners[order[1]]).sub(new THREE.Vector3(...corners[order[2]]))
    const n = b.cross(a).normalize()
    order.forEach((k, i) => {
      positions.push(corners[k][0] * scale, corners[k][1] * scale, corners[k][2] * scale)
      uvs.push(tex[i][0] / texW, tex[i][1] / texH)
      normals.push(n.x, n.y, n.z)
    })
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  return geometry
}

export function pixelMaterial (map, extra = {}) {
  return new THREE.MeshLambertMaterial({ map, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, ...extra })
}

// One ModelRenderer: a rotation point, angles and its boxes.
class Part {
  constructor (point, boxes, material) {
    this.point = new THREE.Vector3(...point)
    this.rest = this.point.clone()
    this.angles = new THREE.Vector3()
    this.object = new THREE.Group()
    this.object.matrixAutoUpdate = false
    for (const geometry of boxes) this.object.add(new THREE.Mesh(geometry, material))
  }

  // translate(point/16), rotate Z, Y, X, like ModelRenderer.render.
  matrix () {
    const m = new THREE.Matrix4().makeTranslation(this.point.x / 16, this.point.y / 16, this.point.z / 16)
    if (this.angles.z) m.multiply(new THREE.Matrix4().makeRotationZ(this.angles.z))
    if (this.angles.y) m.multiply(new THREE.Matrix4().makeRotationY(this.angles.y))
    if (this.angles.x) m.multiply(new THREE.Matrix4().makeRotationX(this.angles.x))
    return m
  }

  apply () { this.object.matrix.copy(this.matrix()); this.object.matrixWorldNeedsUpdate = true }
}

// ModelBiped / ModelPlayer. `layer` is the inflation for armor (1 for helmet, chest and boots, 0.5 for leggings).
export class BipedModel {
  constructor (material, { slim = false, armor = 0, texH = 64 } = {}) {
    this.group = new THREE.Group()
    this.group.matrixAutoUpdate = false
    const t = { texH }
    const wear = !armor
    const d = armor
    const arm = slim ? 3 : 4
    const armY = slim ? 2.5 : 2
    this.parts = {
      head: new Part([0, 0, 0], [boxGeometry([0, 0], [-4, -8, -4], [8, 8, 8], d, t), boxGeometry([32, 0], [-4, -8, -4], [8, 8, 8], armor ? d + 0.5 : 0.5, t)], material),
      body: new Part([0, 0, 0], [boxGeometry([16, 16], [-4, 0, -2], [8, 12, 4], d, t), ...(wear ? [boxGeometry([16, 32], [-4, 0, -2], [8, 12, 4], 0.25, t)] : [])], material),
      rightArm: new Part([-5, armY, 0], [boxGeometry([40, 16], [slim ? -2 : -3, -2, -2], [arm, 12, 4], d, t), ...(wear ? [boxGeometry([40, 32], [slim ? -2 : -3, -2, -2], [arm, 12, 4], 0.25, t)] : [])], material),
      leftArm: new Part([5, armY, 0], armor ? [boxGeometry([40, 16], [-1, -2, -2], [4, 12, 4], d, { ...t, mirror: true })] : [boxGeometry([32, 48], [-1, -2, -2], [arm, 12, 4], 0, t), boxGeometry([48, 48], [-1, -2, -2], [arm, 12, 4], 0.25, t)], material),
      rightLeg: new Part([-1.9, 12, 0], [boxGeometry([0, 16], [-2, 0, -2], [4, 12, 4], d, t), ...(wear ? [boxGeometry([0, 32], [-2, 0, -2], [4, 12, 4], 0.25, t)] : [])], material),
      leftLeg: new Part([1.9, 12, 0], armor ? [boxGeometry([0, 16], [-2, 0, -2], [4, 12, 4], d, { ...t, mirror: true })] : [boxGeometry([16, 48], [-2, 0, -2], [4, 12, 4], 0, t), boxGeometry([0, 48], [-2, 0, -2], [4, 12, 4], 0.25, t)], material)
    }
    for (const part of Object.values(this.parts)) this.group.add(part.object)
  }

  show (names) { for (const [name, part] of Object.entries(this.parts)) part.object.visible = names.includes(name) }

  // ModelBiped.setRotationAngles. Angles in radians, head yaw and pitch in degrees, swing 0..1, age in ticks.
  pose ({ limbSwing = 0, limbAmount = 0, age = 0, headYaw = 0, headPitch = 0, swing = 0, sneak = false, holding = false }) {
    const p = this.parts
    for (const part of Object.values(p)) { part.angles.set(0, 0, 0); part.point.copy(part.rest) }
    p.head.angles.y = headYaw * DEG
    p.head.angles.x = headPitch * DEG
    p.rightArm.angles.x = Math.cos(limbSwing * 0.6662 + Math.PI) * 2 * limbAmount * 0.5
    p.leftArm.angles.x = Math.cos(limbSwing * 0.6662) * 2 * limbAmount * 0.5
    p.rightLeg.angles.x = Math.cos(limbSwing * 0.6662) * 1.4 * limbAmount
    p.leftLeg.angles.x = Math.cos(limbSwing * 0.6662 + Math.PI) * 1.4 * limbAmount
    if (holding) p.rightArm.angles.x = p.rightArm.angles.x * 0.5 - Math.PI / 10
    if (swing > 0) {
      const body = Math.sin(Math.sqrt(swing) * Math.PI * 2) * 0.2
      p.body.angles.y = body
      p.rightArm.point.z = Math.sin(body) * 5; p.rightArm.point.x = -Math.cos(body) * 5
      p.leftArm.point.z = -Math.sin(body) * 5; p.leftArm.point.x = Math.cos(body) * 5
      p.rightArm.angles.y += body; p.leftArm.angles.y += body; p.leftArm.angles.x += body
      let f = 1 - swing; f *= f; f *= f; f = 1 - f
      const f2 = Math.sin(f * Math.PI)
      const f3 = Math.sin(swing * Math.PI) * -(p.head.angles.x - 0.7) * 0.75
      p.rightArm.angles.x -= f2 * 1.2 + f3
      p.rightArm.angles.y += body * 2
      p.rightArm.angles.z += Math.sin(swing * Math.PI) * -0.4
    }
    if (sneak) {
      p.body.angles.x = 0.5
      p.rightArm.angles.x += 0.4; p.leftArm.angles.x += 0.4
      p.rightLeg.point.z = 4; p.leftLeg.point.z = 4
      p.rightLeg.point.y = 9; p.leftLeg.point.y = 9
      p.head.point.y = 1
    } else {
      p.rightLeg.point.z = 0.1; p.leftLeg.point.z = 0.1
    }
    p.rightArm.angles.z += Math.cos(age * 0.09) * 0.05 + 0.05
    p.leftArm.angles.z -= Math.cos(age * 0.09) * 0.05 + 0.05
    p.rightArm.angles.x += Math.sin(age * 0.067) * 0.05
    p.leftArm.angles.x -= Math.sin(age * 0.067) * 0.05
    for (const part of Object.values(p)) part.apply()
  }

  copyPose (other) {
    for (const [name, part] of Object.entries(this.parts)) {
      part.point.copy(other.parts[name].point)
      part.angles.copy(other.parts[name].angles)
      part.apply()
    }
  }
}

// RendererLivingEntity: feet position, body yaw, the (-1, -1, 1) flip, the player's 0.9375 scale and the 1.5 block offset.
export function livingMatrix (position, bodyYaw, { scale = 0.9375, sneak = false } = {}) {
  const m = new THREE.Matrix4().makeTranslation(position.x, position.y, position.z)
  m.multiply(new THREE.Matrix4().makeRotationY((180 - bodyYaw) * DEG))
  m.multiply(new THREE.Matrix4().makeScale(-scale, -scale, scale))
  m.multiply(new THREE.Matrix4().makeTranslation(0, -1.5078125, 0))
  if (sneak) m.multiply(new THREE.Matrix4().makeTranslation(0, 0.2, 0))
  return m
}

// Generated item model: the sprite as a one pixel thick slab, with side faces along every opaque edge (ItemModelGenerator).
const itemGeometries = new Map()
export function itemGeometry (image, key) {
  if (itemGeometries.has(key)) return itemGeometries.get(key)
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, image.width, Math.min(image.height, image.width), 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data
  const solid = (x, y) => x >= 0 && y >= 0 && x < size && y < size && data[(y * size + x) * 4 + 3] > 0
  const positions = []; const uvs = []; const normals = []; const indices = []
  const quad = (corners, uv, normal) => {
    const base = positions.length / 3
    for (const c of corners) positions.push(...c)
    uvs.push(...uv)
    for (let i = 0; i < 4; i++) normals.push(...normal)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const z0 = 7.5 / 16; const z1 = 8.5 / 16
  quad([[0, 0, z1], [1, 0, z1], [1, 1, z1], [0, 1, z1]], [0, 1, 1, 1, 1, 0, 0, 0], [0, 0, 1])
  quad([[1, 0, z0], [0, 0, z0], [0, 1, z0], [1, 1, z0]], [1, 1, 0, 1, 0, 0, 1, 0], [0, 0, -1])
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      if (!solid(px, py)) continue
      const x0 = px / size; const x1 = (px + 1) / size
      const y1 = 1 - py / size; const y0 = 1 - (py + 1) / size
      const u0 = (px + 0.25) / size; const u1 = (px + 0.75) / size; const v0 = (py + 0.25) / size; const v1 = (py + 0.75) / size
      const uv = [u0, v1, u1, v1, u1, v0, u0, v0]
      if (!solid(px - 1, py)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], uv, [-1, 0, 0])
      if (!solid(px + 1, py)) quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], uv, [1, 0, 0])
      if (!solid(px, py - 1)) quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], uv, [0, 1, 0])
      if (!solid(px, py + 1)) quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], uv, [0, -1, 0])
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  itemGeometries.set(key, geometry)
  return geometry
}

// A block item as its block model, from the renderer's block states and atlas.
export function blockGeometry (blocks, name) {
  const state = blocks?.[name]
  const first = state && (state.variants ? Object.values(state.variants)[0] : null)
  const model = (Array.isArray(first) ? first[0] : first)?.model
  if (!model?.elements?.length) return null
  const positions = []; const uvs = []; const normals = []; const indices = []
  const faces = {
    up: (f, t) => [[[f[0], t[1], f[2]], [f[0], t[1], t[2]], [t[0], t[1], t[2]], [t[0], t[1], f[2]]], [0, 1, 0]],
    down: (f, t) => [[[f[0], f[1], t[2]], [f[0], f[1], f[2]], [t[0], f[1], f[2]], [t[0], f[1], t[2]]], [0, -1, 0]],
    north: (f, t) => [[[t[0], t[1], f[2]], [t[0], f[1], f[2]], [f[0], f[1], f[2]], [f[0], t[1], f[2]]], [0, 0, -1]],
    south: (f, t) => [[[f[0], t[1], t[2]], [f[0], f[1], t[2]], [t[0], f[1], t[2]], [t[0], t[1], t[2]]], [0, 0, 1]],
    west: (f, t) => [[[f[0], t[1], f[2]], [f[0], f[1], f[2]], [f[0], f[1], t[2]], [f[0], t[1], t[2]]], [-1, 0, 0]],
    east: (f, t) => [[[t[0], t[1], t[2]], [t[0], f[1], t[2]], [t[0], f[1], f[2]], [t[0], t[1], f[2]]], [1, 0, 0]]
  }
  for (const element of model.elements) {
    const f = element.from.map(v => v / 16)
    const t = element.to.map(v => v / 16)
    for (const [dir, build] of Object.entries(faces)) {
      const face = element.faces?.[dir]
      const tex = face && typeof face.texture === 'object' ? face.texture : null
      if (!tex) continue
      const [corners, normal] = build(f, t)
      const base = positions.length / 3
      for (const c of corners) positions.push(...c)
      uvs.push(tex.u, tex.v, tex.u, tex.v + tex.sv, tex.u + tex.su, tex.v + tex.sv, tex.u + tex.su, tex.v)
      for (let i = 0; i < 4; i++) normals.push(...normal)
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  return geometry
}

// Display transforms from the 1.8 item models (translation in pixels).
const DISPLAY = {
  generated: { firstperson: { rotation: [0, -135, 25], translation: [0, 4, 2], scale: 1.7 }, thirdperson: { rotation: [-90, 0, 0], translation: [0, 1, -3], scale: 0.55 } },
  handheld: { firstperson: { rotation: [0, -135, 25], translation: [0, 4, 2], scale: 1.7 }, thirdperson: { rotation: [0, 90, -35], translation: [0, 1.25, -3.5], scale: 0.85 } },
  block: { firstperson: { rotation: [0, 135, 0], translation: [0, 0, 0], scale: 0.4 }, thirdperson: { rotation: [10, -45, 170], translation: [0, 1.5, -2.75], scale: 0.375 } }
}
export const isHandheld = id => /sword|pickaxe|_axe|shovel|_hoe|^stick$|fishing_rod|carrot_on_a_stick|blaze_rod|^bone$/.test(id || '')

// RenderItem: preTransform (scale 2 for flat items), the model's display transform, scale 0.5, then centre the 0..1 model.
export function itemTransform (kind, view) {
  const d = DISPLAY[kind][view]
  const m = new THREE.Matrix4()
  if (kind !== 'block') m.multiply(new THREE.Matrix4().makeScale(2, 2, 2))
  m.multiply(new THREE.Matrix4().makeTranslation(d.translation[0] / 16, d.translation[1] / 16, d.translation[2] / 16))
  m.multiply(new THREE.Matrix4().makeRotationY(d.rotation[1] * DEG))
  m.multiply(new THREE.Matrix4().makeRotationX(d.rotation[0] * DEG))
  m.multiply(new THREE.Matrix4().makeRotationZ(d.rotation[2] * DEG))
  m.multiply(new THREE.Matrix4().makeScale(d.scale, d.scale, d.scale))
  m.multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5))
  m.multiply(new THREE.Matrix4().makeTranslation(-0.5, -0.5, -0.5))
  return m
}
