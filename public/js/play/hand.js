// First-person hand: the player's own skin, or the held item's icon. Drawn on top of the world like the game does.
import * as THREE from '/vendor/three.js'
import { skinTexture } from './entities.js'

// One arm cube with its sleeve, using the skin's right-arm area.
function armGeometry (slim) {
  const width = slim ? 3 : 4
  const positions = []
  const uvs = []
  const normals = []
  const indices = []
  const box = (size, uv, inflate) => {
    const [w, h, d] = size
    const x0 = -w / 2 - inflate; const x1 = w / 2 + inflate
    const y0 = -h + 2 - inflate; const y1 = 2 + inflate
    const z0 = -d / 2 - inflate; const z1 = d / 2 + inflate
    // [corner positions], uv rect (u, v, w, h) in skin pixels, normal
    const faces = [
      [[[x1, y1, z1], [x1, y1, z0], [x0, y1, z1], [x0, y1, z0]], [uv[0] + d, uv[1], w, d], [0, 1, 0]],
      [[[x1, y0, z0], [x1, y0, z1], [x0, y0, z0], [x0, y0, z1]], [uv[0] + d + w, uv[1], w, d], [0, -1, 0]],
      [[[x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [x1, y0, z1]], [uv[0] + d, uv[1] + d, w, h], [0, 0, 1]],
      [[[x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [x0, y0, z0]], [uv[0] + 2 * d + w, uv[1] + d, w, h], [0, 0, -1]],
      [[[x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [x1, y0, z0]], [uv[0] + d + w, uv[1] + d, d, h], [1, 0, 0]],
      [[[x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [x0, y0, z1]], [uv[0], uv[1] + d, d, h], [-1, 0, 0]]
    ]
    for (const [corners, [u, v, uw, vh], normal] of faces) {
      const base = positions.length / 3
      corners.forEach(c => positions.push(...c))
      uvs.push(u / 64, v / 64, (u + uw) / 64, v / 64, u / 64, (v + vh) / 64, (u + uw) / 64, (v + vh) / 64)
      for (let i = 0; i < 4; i++) normals.push(...normal)
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
    }
  }
  box([width, 12, 4], [40, 16], 0)
  box([width, 12, 4], [40, 32], 0.25)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.scale(1 / 16, 1 / 16, 1 / 16)
  return geometry
}

const overlay = material => Object.assign(material, { depthTest: false, depthWrite: false, transparent: true, alphaTest: 0.1 })

export class Hand {
  constructor (camera) {
    this.root = new THREE.Group()
    this.root.position.set(0.5, -0.44, -0.72)
    camera.add(this.root)
    this.arm = new THREE.Mesh(armGeometry(false), overlay(new THREE.MeshLambertMaterial()))
    this.arm.rotation.set(1.25, -0.42, -0.15)
    this.arm.position.set(0.08, -0.1, 0.12)
    this.arm.renderOrder = 1000
    this.arm.visible = false
    this.root.add(this.arm)
    this.item = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), overlay(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })))
    this.item.position.set(0.02, 0.12, -0.05)
    this.item.rotation.set(0.15, -0.95, 0.35)
    this.item.renderOrder = 1001
    this.item.visible = false
    this.root.add(this.item)
    this.textures = new Map()
    this.swingStart = -1
    this.bob = 0
    this.icon = null
  }

  setSkin ({ skin, slim }) {
    this.arm.geometry.dispose()
    this.arm.geometry = armGeometry(slim)
    skinTexture(skin, slim).then(texture => {
      this.arm.material.map = texture
      this.arm.material.needsUpdate = true
      this.arm.visible = !this.icon
    })
  }

  setItem (item) {
    const icon = item?.icon || null
    if (icon === this.icon) return
    this.icon = icon
    this.item.visible = false
    this.arm.visible = !icon && Boolean(this.arm.material.map)
    if (!icon) return
    if (!this.textures.has(icon)) {
      const texture = new THREE.TextureLoader().load('/play/' + icon)
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      this.textures.set(icon, texture)
    }
    this.item.material.map = this.textures.get(icon)
    this.item.material.needsUpdate = true
    this.item.visible = true
  }

  swing () { this.swingStart = performance.now() }

  // Bob with walking speed, dip and turn while swinging.
  update (dt, speed) {
    this.bob += dt * speed * 1.8
    const walking = Math.min(1, speed / 4.3)
    let x = 0.5 + Math.sin(this.bob) * 0.03 * walking
    let y = -0.44 - Math.abs(Math.cos(this.bob)) * 0.04 * walking
    let turn = 0
    const t = this.swingStart < 0 ? 1 : (performance.now() - this.swingStart) / 300
    if (t < 1) {
      const s = Math.sin(t * Math.PI)
      x -= s * 0.18
      y += Math.sin(Math.sqrt(t) * Math.PI * 2) * 0.08
      turn = s * 0.8
    }
    this.root.position.set(x, y, -0.72)
    this.root.rotation.set(-turn * 0.6, turn * 0.4, turn * 0.3)
  }
}
