const lerp = (a, b, t) => a + (b - a) * t
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

// Render between physics ticks. Never predict a position through an unseen collision.
export class PlayerMotion {
  constructor () { this.reset() }

  reset () { this.samples = []; this.renderTime = null; this.lastFrame = null }

  push (state, received = performance.now()) {
    const previous = this.samples.at(-1)
    const time = state.time ?? received
    const distance = previous ? Math.hypot(state.pos.x - previous.pos.x, state.pos.z - previous.pos.z) : 0
    if (state.teleport || (previous && Math.hypot(distance, state.pos.y - previous.pos.y) > 8)) this.reset()
    const last = this.samples.at(-1)
    if (last && time <= last.time) return
    const walking = state.onGround && !state.inWater && !state.inLava
    const speed = state.velocity ? Math.hypot(state.velocity.x, state.velocity.z) : distance
    const amplitude = walking ? Math.min(0.1, speed) : 0
    this.samples.push({
      ...state, pos: { ...state.pos }, time, received,
      walk: (last?.walk || 0) + (last ? distance * 0.6 : 0),
      bob: lerp(last?.bob || 0, amplitude, 0.4)
    })
    if (this.samples.length > 12) this.samples.shift()
  }

  sample (now = performance.now()) {
    if (!this.samples.length) return null
    const latest = this.samples.at(-1)
    // Keep two ticks buffered for timer/network jitter. Follow the stream clock
    // gently, since its phase can change when physics waits for a missing chunk.
    const target = latest.time + now - latest.received - 100
    if (this.renderTime === null) this.renderTime = target
    const elapsed = this.lastFrame === null ? 0 : Math.max(0, now - this.lastFrame)
    this.lastFrame = now
    const predicted = this.renderTime + elapsed
    const rate = clamp(1 + (target - predicted) / 300, 0.85, 1.1)
    const time = Math.min(latest.time, Math.max(this.samples[0].time - 100, this.renderTime + elapsed * rate))
    this.renderTime = time
    while (this.samples.length > 2 && this.samples[1].time <= time) this.samples.shift()
    const a = this.samples[0]
    const b = this.samples[1] || a
    const alpha = a === b ? 1 : clamp((time - a.time) / (b.time - a.time), 0, 1)
    return {
      ...b,
      pos: { x: lerp(a.pos.x, b.pos.x, alpha), y: lerp(a.pos.y, b.pos.y, alpha), z: lerp(a.pos.z, b.pos.z, alpha) },
      walk: lerp(a.walk, b.walk, alpha), bob: lerp(a.bob, b.bob, alpha)
    }
  }
}

export function viewBob (walk, amplitude) {
  const phase = -walk * Math.PI
  return {
    x: Math.sin(phase) * amplitude * 0.5,
    y: -Math.abs(Math.cos(phase) * amplitude),
    roll: Math.sin(phase) * amplitude * 3 * Math.PI / 180,
    pitch: Math.abs(Math.cos(phase - 0.2) * amplitude) * 5 * Math.PI / 180
  }
}
