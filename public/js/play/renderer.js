// The 3D view: sky, fog, lighting, world meshes, entities and a first-person camera.
// The camera turns locally with the mouse while you control the player, so looking has no network delay.
import * as THREE from '/vendor/three.js'
import { WorldMeshes } from './world.js'
import { EntityManager } from './entities.js'
import { Hand } from './hand.js'
import { PlayerMotion, viewBob } from './motion.js'

const SKY_TOP = new THREE.Color('#78a7ff')
const SKY_HORIZON = new THREE.Color('#c0d8ff')
const damp = (dt, seconds) => 1 - Math.exp(-dt / seconds)
const angle = a => Math.atan2(Math.sin(a), Math.cos(a))

function skyDome () {
  const geometry = new THREE.SphereGeometry(400, 24, 16)
  const colors = []
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const t = Math.max(0, Math.min(1, position.getY(i) / 400))
    const c = SKY_HORIZON.clone().lerp(SKY_TOP, Math.pow(t, 0.6))
    colors.push(c.r, c.g, c.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
  mesh.renderOrder = -1
  return mesh
}

export class GameRenderer {
  constructor () {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputEncoding = THREE.sRGBEncoding
    document.body.prepend(this.renderer.domElement)
    this.canvas = this.renderer.domElement

    this.scene = new THREE.Scene()
    this.scene.background = SKY_HORIZON.clone()
    this.scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 80, 128)
    this.sky = skyDome()
    this.scene.add(this.sky)

    // Face shading like the game: top 100%, north/south 80%, east/west 60%, bottom 50%.
    this.lights = [new THREE.AmbientLight(0xffffff, 0.5)]
    this.scene.add(this.lights[0])
    for (const [x, y, z, intensity] of [[0, 1, 0, 0.5], [0, 0, 1, 0.3], [0, 0, -1, 0.3], [1, 0, 0, 0.1], [-1, 0, 0, 0.1]]) {
      const light = new THREE.DirectionalLight(0xffffff, intensity)
      light.position.set(x, y, z)
      this.scene.add(light)
      this.lights.push(light)
    }

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1000)
    this.camera.rotation.order = 'YXZ'
    this.scene.add(this.camera)
    this.camera.matrixAutoUpdate = false
    this.hand = new Hand()
    this.motion = new PlayerMotion()
    this.bobMatrix = new THREE.Matrix4()
    this.cameraMatrix = new THREE.Matrix4()
    this.operation = new THREE.Matrix4()
    this.world = new WorldMeshes(this.scene)
    this.world.useTileMipmaps(this.renderer.capabilities.isWebGL2)

    // Sun and clouds, from the game's own textures.
    const loader = new THREE.TextureLoader()
    const sunTexture = loader.load('/play/textures/1.16.4/environment/sun.png')
    sunTexture.magFilter = THREE.NearestFilter
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({ map: sunTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
    this.sun.renderOrder = -1
    this.sunDirection = new THREE.Vector3(-0.5, 0.78, 0.38).normalize()
    this.scene.add(this.sun)
    const cloudTexture = loader.load('/play/textures/1.16.4/environment/clouds.png')
    cloudTexture.magFilter = THREE.NearestFilter
    cloudTexture.minFilter = THREE.NearestFilter
    cloudTexture.wrapS = cloudTexture.wrapT = THREE.RepeatWrapping
    this.cloudSpan = 1536
    cloudTexture.repeat.set(this.cloudSpan / 3072, this.cloudSpan / 3072)
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(this.cloudSpan, this.cloudSpan), new THREE.MeshBasicMaterial({ map: cloudTexture, transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide, alphaTest: 0.02 }))
    this.clouds.rotation.x = -Math.PI / 2
    this.clouds.renderOrder = -1
    this.cloudHeight = 128
    this.scene.add(this.clouds)
    this.entities = new EntityManager(this.scene)

    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }))
    this.outline.visible = false
    this.scene.add(this.outline)
    this.cracks = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }))
    this.cracks.visible = false
    this.scene.add(this.cracks)
    this.crackTextures = Array.from({ length: 10 }, (_, i) => {
      const texture = loader.load(`/play/textures/1.16.4/blocks/destroy_stage_${i}.png`)
      texture.magFilter = THREE.NearestFilter
      return texture
    })
    this.raycaster = new THREE.Raycaster()
    this.raycaster.far = 5
    this.cameraCollision = new THREE.Raycaster()
    this.playerEye = new THREE.Vector3()
    this.playerDirection = new THREE.Vector3()
    this.perspective = 0

    this.target = null
    this.yaw = 0
    this.pitch = 0
    this.serverYaw = 0
    this.serverPitch = 0
    this.look = null // () => { yaw, pitch } while controlling
    this.eyeHeight = 1.62
    this.baseFov = 70
    this.sprinting = false
    this.bobbing = true
    this.daylight = 1
    this.ready = false
    this.last = performance.now()
    this.lastPick = 0

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.hand.resize(this.camera.aspect)
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })
    const loop = now => {
      requestAnimationFrame(loop)
      this.frame(now)
    }
    requestAnimationFrame(loop)
  }

  setWorld ({ version, radius, minY, height, keep, cloudHeight, self }) {
    if (!keep) { this.world.reset(); this.entities.clear(); this.motion.reset(); this.target = null }
    this.world.setVersion(version, minY, height)
    this.hand.setVersion(version)
    if (cloudHeight) this.cloudHeight = cloudHeight
    if (self) {
      this.hand.setSkin(self)
      this.entities.update({ id: 'self', model: 'player', skin: self.skin, cape: self.cape, slim: self.slim, pos: { x: 0, y: 0, z: 0 }, height: 1.8, label: self.label ?? self.name, local: true })
      this.avatar?.entities.update({ id: -1, model: 'player', skin: self.skin, slim: self.slim, pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, height: 1.8, label: '' })
    }
    const distance = radius * 16
    this.scene.fog.near = distance * 0.55
    this.scene.fog.far = distance * 0.95
    this.camera.far = distance + 64
    this.camera.updateProjectionMatrix()
  }

  createInventoryPreview (element) {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
    renderer.outputEncoding = THREE.sRGBEncoding
    renderer.setSize(100, 140)
    element.append(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const light = new THREE.DirectionalLight(0xffffff, 0.5)
    light.position.set(-2, 3, 4)
    scene.add(light)
    const camera = new THREE.PerspectiveCamera(35, 100 / 140, 0.1, 20)
    camera.position.set(0, 1, -3.5)
    camera.lookAt(0, 0.9, 0)
    this.avatar = { element, renderer, scene, camera, entities: new EntityManager(scene) }
  }

  setPosition (state) {
    const { pos, yaw, pitch } = state
    if (!this.target || state.teleport || this.target.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z)) > 8) {
      this.target = new THREE.Vector3(pos.x, pos.y, pos.z)
      this.camera.position.set(pos.x, pos.y + this.eyeHeight, pos.z)
      this.yaw = yaw
      this.pitch = pitch
    }
    this.target.set(pos.x, pos.y, pos.z)
    this.serverYaw = yaw
    this.serverPitch = pitch
    this.motion.push(state)
    this.ready = true
  }

  setDig (data) {
    this.dig = data ? { ...data, start: performance.now() } : null
    this.cracks.visible = Boolean(data)
    if (data) this.cracks.position.set(data.position.x + 0.5, data.position.y + 0.5, data.position.z + 0.5)
  }

  setEnvironment ({ time, raining, gameMode, dimension }) {
    const phase = (time % 24000) / 24000 * Math.PI * 2
    this.sunDirection.set(-Math.cos(phase), Math.sin(phase), 0).normalize()
    const daylight = Math.max(0.12, Math.min(1, Math.sin(phase) * 2 + 0.4)) * (raining ? 0.7 : 1)
    this.daylight = daylight
    const nether = String(dimension).includes('nether')
    const end = String(dimension).includes('end')
    const horizon = nether ? new THREE.Color('#330808') : end ? new THREE.Color('#181020') : SKY_HORIZON.clone().multiplyScalar(daylight)
    this.scene.background.copy(horizon)
    this.scene.fog.color.copy(horizon)
    this.sky.visible = !nether && !end
    this.sky.material.color.setRGB(daylight, daylight, daylight)
    this.sun.visible = !nether && !end && !raining && this.sunDirection.y > -0.1
    this.clouds.visible = !nether && !end
    for (const light of this.lights) light.color.setScalar(nether || end ? 0.8 : Math.max(0.55, daylight))
    this.spectator = gameMode === 'spectator'
    this.hand.root.visible = !this.spectator && this.perspective === 0
    this.hand.light.color.setScalar(Math.max(0.55, daylight))
  }

  frame (now) {
    this.beforeFrame?.()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.world.flush()
    if (this.dig) {
      const stage = Math.min(9, Math.floor((now - this.dig.start) / Math.max(1, this.dig.duration) * 10))
      if (this.cracks.material.map !== this.crackTextures[stage]) {
        this.cracks.material.map = this.crackTextures[stage]
        this.cracks.material.needsUpdate = true
      }
    }
    if (this.target) {
      const state = this.motion.sample(now)
      this.displayEye ??= this.eyeHeight
      this.displayEye += (this.eyeHeight - this.displayEye) * damp(dt, 0.05 / Math.LN2)
      const eye = new THREE.Vector3(state.pos.x, state.pos.y + this.displayEye, state.pos.z)
      const local = this.look?.()
      if (local) { this.yaw = local.yaw; this.pitch = local.pitch } else {
        this.yaw += angle(this.serverYaw - this.yaw) * damp(dt, 0.05)
        this.pitch += (this.serverPitch - this.pitch) * damp(dt, 0.05)
      }
      this.camera.rotation.set(this.pitch, this.yaw, 0)
      this.playerEye.copy(eye)
      this.playerDirection.set(0, 0, -1).applyQuaternion(this.camera.quaternion)
      const self = this.entities.entities.get('self')
      if (self) {
        self.group.visible = this.perspective !== 0 && !this.spectator
        self.target.set(state.pos.x, state.pos.y, state.pos.z)
        self.targetYaw = self.targetHeadYaw = this.yaw
        self.targetPitch = this.pitch
        self.sneaking = this.eyeHeight < 1.6
        self.speed = state.velocity ? Math.hypot(state.velocity.x, state.velocity.z) * 20 : 0
      }
      this.hand.root.visible = !this.spectator && this.perspective === 0
      if (this.perspective !== 0) {
        const direction = this.playerDirection.clone().multiplyScalar(this.perspective === 1 ? -1 : 1)
        const meshes = this.world.collisionNear(eye)
        let distance = 4
        // Check the camera's corners so it cannot clip through a wall at an angle.
        for (const x of [-0.1, 0.1]) for (const y of [-0.1, 0.1]) for (const z of [-0.1, 0.1]) {
          this.cameraCollision.set(eye.clone().add(new THREE.Vector3(x, y, z)), direction)
          this.cameraCollision.far = distance + 0.1
          const hit = this.cameraCollision.intersectObjects(meshes, false)[0]
          if (hit) distance = Math.min(distance, Math.max(0, hit.distance - 0.1))
        }
        eye.addScaledVector(direction, distance)
        if (this.perspective === 2) this.camera.rotation.set(-this.pitch, this.yaw + Math.PI, 0)
      }
      const bob = viewBob(state.walk, this.bobbing && this.perspective === 0 ? state.bob : 0)
      this.bobMatrix.makeTranslation(bob.x, bob.y, 0)
        .multiply(this.operation.makeRotationZ(bob.roll))
        .multiply(this.operation.makeRotationX(bob.pitch))
      this.cameraMatrix.compose(eye, this.camera.quaternion, new THREE.Vector3(1, 1, 1))
      this.camera.matrix.copy(this.cameraMatrix).multiply(this.operation.copy(this.bobMatrix).invert())
      this.camera.matrix.decompose(this.camera.position, this.camera.quaternion, this.camera.scale)
      this.camera.updateMatrixWorld(true)
      this.hand.update(dt, this.bobMatrix, this.yaw, this.pitch)
      const p = this.camera.position
      this.sun.position.copy(p).addScaledVector(this.sunDirection, 90)
      this.sun.lookAt(p)
      this.clouds.position.set(p.x, this.cloudHeight, p.z)
      this.clouds.material.map.offset.set((p.x + now / 1000 * 0.6) / 3072, -p.z / 3072)
      const fov = this.baseFov * (this.sprinting ? 1.15 : 1)
      if (Math.abs(this.camera.fov - fov) > 0.01) {
        this.camera.fov += (fov - this.camera.fov) * damp(dt, 0.1)
        this.camera.updateProjectionMatrix()
      }
      this.sky.position.copy(this.camera.position)
      if (now - this.lastPick > 80) { this.lastPick = now; this.pick() }
    }
    this.entities.tick(dt, this.camera)
    this.renderer.render(this.scene, this.camera)
    this.renderer.autoClear = false
    this.renderer.clearDepth()
    this.renderer.render(this.hand.scene, this.hand.camera)
    this.renderer.autoClear = true
    if (this.avatar?.element.offsetWidth && document.getElementById('inventory-panel').dataset.kind === 'inventory') {
      const { renderer, scene, camera, entities } = this.avatar
      entities.tick(dt, camera)
      renderer.render(scene, camera)
    }
  }

  // Outlines the block under the crosshair, like the game.
  pick () {
    this.raycaster.set(this.playerEye, this.playerDirection)
    const hit = this.raycaster.intersectObjects(this.world.collisionNear(this.playerEye), false)[0]
    if (!hit?.face) { this.outline.visible = false; return }
    const p = hit.point.clone().addScaledVector(hit.face.normal, -0.01)
    this.outline.position.set(Math.floor(p.x) + 0.5, Math.floor(p.y) + 0.5, Math.floor(p.z) + 0.5)
    this.outline.visible = true
  }
}
