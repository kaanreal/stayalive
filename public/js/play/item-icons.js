import * as THREE from '/vendor/three.js'

// Block slots use the same model and atlas as the hand, rendered with the GUI pose.
export class ItemIcons {
  constructor (hand) { this.hand = hand; this.cache = new Map() }

  async block (item) {
    const key = `${this.hand.version}|${item.block}|${item.tint}`
    if (this.cache.has(key)) return this.cache.get(key)
    const pending = this.render(item)
    this.cache.set(key, pending)
    pending.catch(() => this.cache.delete(key))
    return pending
  }

  async render (item) {
    const model = await this.hand.loadItem(item)
    if (!model.block) return '/play/' + item.icon
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true })
      this.renderer.outputEncoding = THREE.sRGBEncoding
      this.renderer.setSize(32, 32)
      this.scene = new THREE.Scene()
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.6))
      const light = new THREE.DirectionalLight(0xffffff, 0.6)
      light.position.set(-1, 2, 3)
      this.scene.add(light)
      this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10)
      this.camera.position.z = 3
      this.mesh = new THREE.Mesh(undefined, new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.1 }))
      this.mesh.rotation.set(Math.PI / 6, Math.PI * 1.25, 0)
      this.mesh.scale.setScalar(0.625)
      this.scene.add(this.mesh)
    }
    this.mesh.geometry = model.geometry
    this.mesh.material.map = model.texture
    this.mesh.material.needsUpdate = true
    this.renderer.render(this.scene, this.camera)
    return this.renderer.domElement.toDataURL('image/png')
  }
}
