// The 3D view: sky, fog, lighting, world meshes, entities and a first-person camera.
// The camera turns locally with the mouse while you control the player, so looking has no network delay.
import * as THREE from '/vendor/three.js'
import { WorldMeshes } from './world.js'
import { EntityManager } from './entities.js'
import { Hand } from './hand.js'

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
    document.body.prepend(this.renderer.domElement)
    this.canvas = this.renderer.domElement

    this.scene = new THREE.Scene()
    this.scene.background = SKY_HORIZON.clone()
    this.scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 80, 128)
    this.sky = skyDome()
    this.scene.add(this.sky)

    // Face shading like the game: top 100%, north/south 80%, east/west 60%, bottom 50%.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    for (const [x, y, z, intensity] of [[0, 1, 0, 0.5], [0, 0, 1, 0.3], [0, 0, -1, 0.3], [1, 0, 0, 0.1], [-1, 0, 0, 0.1]]) {
      const light = new THREE.DirectionalLight(0xffffff, intensity)
      light.position.set(x, y, z)
      this.scene.add(light)
    }

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1000)
    this.camera.rotation.order = 'YXZ'
    this.scene.add(this.camera)
    this.hand = new Hand(this.camera)
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
    this.speed = 0
    this.entities = new EntityManager(this.scene)

    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }))
    this.outline.visible = false
    this.scene.add(this.outline)
    this.raycaster = new THREE.Raycaster()
    this.raycaster.far = 5

    this.target = null
    this.yaw = 0
    this.pitch = 0
    this.serverYaw = 0
    this.serverPitch = 0
    this.look = null // () => { yaw, pitch } while controlling
    this.eyeHeight = 1.62
    this.ready = false
    this.last = performance.now()
    this.lastPick = 0

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })
    const loop = now => {
      requestAnimationFrame(loop)
      this.frame(now)
    }
    requestAnimationFrame(loop)
  }

  setWorld ({ version, radius, minY, height, keep, cloudHeight, self }) {
    if (!keep) { this.world.reset(); this.entities.clear() }
    this.world.setVersion(version, minY, height)
    if (cloudHeight) this.cloudHeight = cloudHeight
    if (self) this.hand.setSkin(self)
    const distance = radius * 16
    this.scene.fog.near = distance * 0.55
    this.scene.fog.far = distance * 0.95
    this.camera.far = distance + 64
    this.camera.updateProjectionMatrix()
  }

  setPosition ({ pos, yaw, pitch }) {
    if (!this.target) {
      this.target = new THREE.Vector3(pos.x, pos.y, pos.z)
      this.camera.position.set(pos.x, pos.y + this.eyeHeight, pos.z)
      this.yaw = yaw
      this.pitch = pitch
    }
    this.target.set(pos.x, pos.y, pos.z)
    this.serverYaw = yaw
    this.serverPitch = pitch
    this.ready = true
  }

  frame (now) {
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    if (this.target) {
      const eye = new THREE.Vector3(this.target.x, this.target.y + this.eyeHeight, this.target.z)
      const before = this.camera.position.clone()
      this.camera.position.lerp(eye, damp(dt, 0.045))
      if (dt > 0) this.speed += (Math.hypot(this.camera.position.x - before.x, this.camera.position.z - before.z) / dt - this.speed) * damp(dt, 0.15)
      this.hand.update(dt, this.speed)
      const p = this.camera.position
      this.sun.position.copy(p).addScaledVector(this.sunDirection, 90)
      this.sun.lookAt(p)
      this.clouds.position.set(p.x, this.cloudHeight, p.z)
      this.clouds.material.map.offset.set((p.x + now / 1000 * 0.6) / 3072, -p.z / 3072)
      const local = this.look?.()
      if (local) { this.yaw = local.yaw; this.pitch = local.pitch } else {
        this.yaw += angle(this.serverYaw - this.yaw) * damp(dt, 0.05)
        this.pitch += (this.serverPitch - this.pitch) * damp(dt, 0.05)
      }
      this.camera.rotation.set(this.pitch, this.yaw, 0)
      this.sky.position.copy(this.camera.position)
      if (now - this.lastPick > 80) { this.lastPick = now; this.pick() }
    }
    this.entities.tick(dt, this.camera)
    this.renderer.render(this.scene, this.camera)
  }

  // Outlines the block under the crosshair, like the game.
  pick () {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this.raycaster.intersectObjects(this.world.near(this.camera.position), false)[0]
    if (!hit?.face) { this.outline.visible = false; return }
    const p = hit.point.clone().addScaledVector(hit.face.normal, -0.01)
    this.outline.position.set(Math.floor(p.x) + 0.5, Math.floor(p.y) + 0.5, Math.floor(p.z) + 0.5)
    this.outline.visible = true
  }
}
