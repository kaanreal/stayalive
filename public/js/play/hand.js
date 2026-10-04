// First-person hand: the player's own skin, or the held item's icon. Drawn on top of the world like the game does.
import * as THREE from '/vendor/three.js'
import { skinTexture } from './entities.js'
import { spriteGeometry, blockGeometry } from './item-geometry.js'

// One arm cube with its sleeve, using the skin's right-arm area.
function armGeometry (slim) {
  const width = slim ? 3 : 4
  const positions = []
  const uvs = []
  const normals = []
  const indices = []
  const box = (size, uv, inflate) => {
    const [w, h, d] = size
    const x0 = (slim ? -2 : -3) - inflate; const x1 = x0 + w + inflate * 2
    const y0 = -2 - inflate; const y1 = h - 2 + inflate
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
      corners.forEach(([x, y, z]) => positions.push(x, 8 - y, z))
      uvs.push(u / 64, v / 64, (u + uw) / 64, v / 64, u / 64, (v + vh) / 64, (u + uw) / 64, (v + vh) / 64)
      for (let i = 0; i < 4; i++) normals.push(normal[0], -normal[1], normal[2])
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
    }
  }
  box([width, 12, 4], [40, 16], 0)
  box([width, 12, 4], [40, 32], 0.25)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.translate(-5, slim ? 2.5 : 2, 0)
  geometry.scale(1 / 16, 1 / 16, 1 / 16)
  return geometry
}

const radians = degrees => degrees * Math.PI / 180
const angle = value => Math.atan2(Math.sin(value), Math.cos(value))

export class Hand {
  constructor () {
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 10)
    this.light = new THREE.AmbientLight(0xffffff, 0.7)
    this.scene.add(this.light)
    const light = new THREE.DirectionalLight(0xffffff, 0.5)
    light.position.set(-1, 3, 2)
    this.scene.add(light)
    this.view = new THREE.Group()
    this.view.matrixAutoUpdate = false
    this.scene.add(this.view)
    this.root = new THREE.Group()
    this.root.matrixAutoUpdate = false
    this.view.add(this.root)
    this.arm = new THREE.Mesh(armGeometry(false), new THREE.MeshLambertMaterial({ transparent: true, alphaTest: 0.1 }))
    this.arm.visible = false
    this.root.add(this.arm)
    this.item = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ alphaTest: 0.1, vertexColors: true }))
    this.item.visible = false
    this.root.add(this.item)
    this.models = new Map()
    this.swingStart = -Infinity
    this.mining = false
    this.equip = 1
    this.desired = null
    this.displayed = null
    this.currentKey = ''
    this.lagYaw = null
    this.lagPitch = null
    this.matrix = new THREE.Matrix4()
    this.operation = new THREE.Matrix4()
  }

  resize (aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix() }

  setSkin ({ skin, slim }) {
    const key = `${skin}|${slim}`
    if (key === this.skinKey) return
    this.skinKey = key
    this.arm.geometry.dispose()
    this.arm.geometry = armGeometry(slim)
    skinTexture(skin, slim).then(texture => {
      if (this.skinKey !== key) return
      this.arm.material.map = texture
      this.arm.material.needsUpdate = true
      this.arm.visible = !this.displayed
    })
  }

  setVersion (version) {
    if (this.version === version) return
    this.version = version
    this.blockAssets = Promise.all([
      fetch(`/play/blocksStates/${version}.json`).then(response => response.json()),
      new Promise((resolve, reject) => new THREE.TextureLoader().load(`/play/textures/${version}.png`, resolve, undefined, reject))
    ]).then(([states, texture]) => {
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.encoding = THREE.sRGBEncoding
      return { states, texture }
    })
    this.blockAssets.catch(error => console.error('Held block assets:', error))
  }

  setItem (item) { this.desired = item?.icon ? item : null }

  async loadItem (item) {
    const key = `${this.version}|${item.block || ''}|${item.tint}|${item.icon}`
    if (!this.models.has(key)) {
      const pending = (async () => {
        if (item.block && this.blockAssets) {
          const { states, texture } = await this.blockAssets
          const variants = states[item.block]?.variants
          if (variants) {
            const preferred = Object.keys(variants).sort((a, b) => {
              const score = name => ['shape=straight', 'half=bottom', 'type=bottom', 'snowy=false', 'axis=y'].filter(value => name.includes(value)).length
              return score(b) - score(a)
            })[0]
            const variant = variants[preferred]
            const model = (Array.isArray(variant) ? variant[0] : variant)?.model
            if (model?.elements?.length) return { geometry: blockGeometry(model, item.tint), texture, block: true }
          } else if (states[item.block]?.multipart) {
            const elements = []
            for (const part of states[item.block].multipart) {
              if (part.when && part.when.north !== 'true' && part.when.south !== 'true') continue
              const variant = Array.isArray(part.apply) ? part.apply[0] : part.apply
              for (const element of variant.model?.elements || []) elements.push({ ...element, modelRotation: variant.y || 0 })
            }
            if (elements.length) return { geometry: blockGeometry({ elements }, item.tint), texture, block: true }
          }
        }
        const texture = await new Promise((resolve, reject) => new THREE.TextureLoader().load('/play/' + item.icon, resolve, undefined, reject))
        texture.magFilter = THREE.NearestFilter
        texture.minFilter = THREE.NearestFilter
        texture.encoding = THREE.sRGBEncoding
        return { geometry: spriteGeometry(texture.image), texture, block: false }
      })()
      this.models.set(key, pending)
      pending.catch(() => this.models.delete(key))
    }
    return this.models.get(key)
  }

  display (item) {
    this.displayed = item
    this.item.visible = false
    this.arm.visible = !item && Boolean(this.arm.material.map)
    if (!item) return
    this.loadItem(item).then(model => {
      if (this.displayed !== item) return
      this.item.geometry = model.geometry
      this.item.material.map = model.texture
      this.item.material.needsUpdate = true
      this.block = model.block
      this.item.visible = true
    }).catch(error => console.error('Held item:', error))
  }

  swing () {
    const now = performance.now()
    if (now - this.swingStart >= 300) this.swingStart = now
  }

  translate (x, y, z) { this.matrix.multiply(this.operation.makeTranslation(x, y, z)) }
  rotate (axis, degrees) {
    if (axis === 'x') this.operation.makeRotationX(radians(degrees))
    if (axis === 'y') this.operation.makeRotationY(radians(degrees))
    if (axis === 'z') this.operation.makeRotationZ(radians(degrees))
    this.matrix.multiply(this.operation)
  }

  update (dt, bobMatrix, yaw, pitch) {
    const key = this.desired ? `${this.desired.id || this.desired.name}|${this.desired.icon}` : ''
    const target = key === this.currentKey ? 1 : 0
    this.equip += Math.max(-dt * 8, Math.min(dt * 8, target - this.equip))
    if (this.equip < 0.1 && key !== this.currentKey) {
      this.currentKey = key
      this.display(this.desired)
    }
    const now = performance.now()
    if (this.mining && now - this.swingStart >= 300) this.swingStart = now
    const progress = Math.max(0, Math.min(1, (now - this.swingStart) / 300))
    const swing = progress < 1 ? progress : 0
    const arc = Math.sin(Math.sqrt(swing) * Math.PI)
    const lift = Math.sin(Math.sqrt(swing) * Math.PI * 2)
    const sweep = Math.sin(swing * swing * Math.PI)
    const dip = 1 - this.equip
    this.lagYaw ??= yaw; this.lagPitch ??= pitch
    const follow = 1 - Math.exp(-dt / 0.06)
    this.lagYaw += angle(yaw - this.lagYaw) * follow
    this.lagPitch += (pitch - this.lagPitch) * follow
    this.view.matrix.copy(bobMatrix)
      .multiply(this.operation.makeRotationX(-(pitch - this.lagPitch) * 0.1))
      .multiply(this.operation.makeRotationY(-angle(yaw - this.lagYaw) * 0.1))
    this.matrix.identity()
    if (this.displayed) {
      this.translate(0.56 - 0.4 * arc, -0.52 - dip * 0.6 + 0.2 * lift, -0.72 - 0.2 * Math.sin(swing * Math.PI))
      this.rotate('y', 45 - sweep * 20)
      this.rotate('z', -arc * 20)
      this.rotate('x', -arc * 80)
      this.rotate('y', -45)
      if (this.block) {
        this.rotate('y', 45)
        this.matrix.scale(new THREE.Vector3(0.4, 0.4, 0.4))
      } else {
        this.translate(1.13 / 16, 3.2 / 16, 1.13 / 16)
        this.rotate('y', -90)
        this.rotate('z', 25)
        this.matrix.scale(new THREE.Vector3(0.68, 0.68, 0.68))
      }
    } else {
      this.translate(0.64 - arc * 0.3, -0.6 - dip * 0.6 + lift * 0.4, -0.72 - Math.sin(swing * Math.PI) * 0.4)
      this.rotate('y', 45 + arc * 70)
      this.rotate('z', -sweep * 20)
      this.translate(-1, 3.6, 3.5)
      this.rotate('z', 120)
      this.rotate('x', 200)
      this.rotate('y', -135)
      this.translate(5.6, 0, 0)
    }
    this.root.matrix.copy(this.matrix)
  }
}
