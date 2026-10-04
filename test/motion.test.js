const { test } = require('node:test')
const assert = require('node:assert/strict')

const state = (x, time, extra = {}) => ({ pos: { x, y: 64, z: 0 }, yaw: 0, pitch: 0, onGround: true, velocity: { x: 0.12, y: 0, z: 0 }, time, ...extra })

test('camera interpolates physics ticks consistently at different render frame rates', async () => {
  const { PlayerMotion } = await import('../public/js/play/motion.js')
  for (const frameTime of [1000 / 30, 1000 / 60, 1000 / 144]) {
    const motion = new PlayerMotion()
    let tick = 0
    const frame = now => {
      while (tick <= 20 && tick * 50 + 10 <= now) {
        motion.push(state(tick * 0.215, tick * 50), tick * 50 + 10)
        tick++
      }
      return motion.sample(now)
    }
    for (let now = 0; now < 1010; now += frameTime) frame(now)
    assert.ok(Math.abs(frame(1010).pos.x - 3.87) < 0.0001)
  }
})

test('camera stops at the last known position instead of drifting into walls', async () => {
  const { PlayerMotion } = await import('../public/js/play/motion.js')
  const motion = new PlayerMotion()
  motion.push(state(0, 0), 10)
  motion.push(state(0.215, 50), 60)
  assert.equal(motion.sample(135).pos.x, 0.1075)
  assert.equal(motion.sample(200).pos.x, 0.215)
  assert.equal(motion.sample(5000).pos.x, 0.215)
})

test('teleports snap immediately and clear walking bob', async () => {
  const { PlayerMotion } = await import('../public/js/play/motion.js')
  const motion = new PlayerMotion()
  motion.push(state(0, 0), 10)
  motion.push(state(0.2, 50), 60)
  motion.push(state(1, 75, { teleport: true, velocity: { x: 0, y: 0, z: 0 } }), 85)
  assert.equal(motion.sample(85).pos.x, 1)
  assert.equal(motion.sample(85).walk, 0)
  assert.equal(motion.sample(85).bob, 0)
})

test('bobbing fades in the air and disabled bobbing has an identity transform', async () => {
  const { PlayerMotion, viewBob } = await import('../public/js/play/motion.js')
  const motion = new PlayerMotion()
  motion.push(state(0, 0), 10)
  motion.push(state(0.2, 50), 60)
  const walking = motion.sample(160).bob
  motion.push(state(0.4, 100, { onGround: false }), 160)
  assert.ok(motion.sample(260).bob < walking)
  const bob = viewBob(10, 0)
  assert.ok(Object.values(bob).every(value => value === 0))
})

test('walking recovers from a physics pause without permanently stepping between updates', async () => {
  const { PlayerMotion } = await import('../public/js/play/motion.js')
  for (const fps of [30, 60, 144]) {
    const motion = new PlayerMotion()
    const updates = Array.from({ length: 60 }, (_, tick) => ({
      time: tick * 50,
      received: tick * 50 + (tick >= 12 ? 300 : 0) + [0, 20, 0, 30][tick % 4]
    }))
    let next = 0; let previous = null
    for (let now = 0; now < 3200; now += 1000 / fps) {
      while (updates[next]?.received <= now) {
        const update = updates[next++]
        motion.push(state(update.time / 50 * 0.215, update.time), update.received)
      }
      const sample = motion.sample(now)
      if (now <= 1200 || !sample) continue
      if (previous !== null) {
        const distance = sample.pos.x - previous
        assert.ok(distance > 0.001, `frozen frame after recovery at ${fps} FPS`)
        assert.ok(distance < 4.3 * 1.11 / fps, `position jump at ${fps} FPS`)
      }
      previous = sample.pos.x
    }
  }
})
