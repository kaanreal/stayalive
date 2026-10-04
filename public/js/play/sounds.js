export class GameSounds {
  constructor (message) {
    this.message = message
    this.buffers = new Map()
    this.active = 0
    this.volume = 0.7
  }

  async start (version) {
    this.context ||= new AudioContext()
    await this.context.resume()
    if (this.version === version) return
    this.version = version
    this.events = null
    try {
      const response = await fetch(`/play/sounds/${version}.json`)
      if (!response.ok) throw Error('Minecraft sounds could not be loaded.')
      this.events = await response.json()
    } catch (error) { this.version = null; this.message(error.message) }
  }

  stop () { this.context?.suspend().catch(error => this.message(error.message)) }

  async play ({ name, position, volume, pitch }, listener) {
    if (!this.context || this.context.state !== 'running' || this.active >= 24 || !this.volume) return
    const options = this.events?.[name.replace(/^minecraft:/, '')]
    if (!options?.length) return
    const distance = Math.hypot(position.x - listener.x, position.y - listener.y, position.z - listener.z)
    const range = Math.max(16, volume * 16)
    if (distance >= range) return
    let pick = Math.random() * options.reduce((sum, sound) => sum + sound.weight, 0)
    const sound = options.find(sound => { pick -= sound.weight; return pick <= 0 }) || options[0]
    this.active++
    try {
      if (!this.buffers.has(sound.hash)) {
        const pending = fetch(`/play/sound/${sound.hash}.ogg`).then(async response => {
          if (!response.ok) throw Error('Minecraft sound could not be downloaded.')
          return this.context.decodeAudioData(await response.arrayBuffer())
        })
        this.buffers.set(sound.hash, pending)
        pending.catch(() => this.buffers.delete(sound.hash))
        if (this.buffers.size > 64) this.buffers.delete(this.buffers.keys().next().value)
      }
      const buffer = await this.buffers.get(sound.hash)
      if (this.context.state !== 'running') return
      const source = this.context.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = Math.max(0.01, pitch * sound.pitch)
      const gain = this.context.createGain()
      gain.gain.value = Math.min(1, volume) * sound.volume * this.volume * (1 - distance / range)
      const panner = this.context.createStereoPanner()
      const bearing = Math.atan2(-(position.x - listener.x), -(position.z - listener.z))
      panner.pan.value = -Math.sin(bearing - (listener.yaw || 0)) * Math.min(1, distance / 2)
      source.connect(gain).connect(panner).connect(this.context.destination)
      source.start()
      await new Promise(resolve => { source.onended = resolve })
    } catch (error) { this.message(error.message) } finally { this.active-- }
  }
}
