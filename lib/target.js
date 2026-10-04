const { Vec3 } = require('vec3')
const { RaycastIterator } = require('prismarine-world').iterators

function aim (bot) {
  const { position, eyeHeight, yaw, pitch } = bot.entity
  return {
    origin: position.offset(0, eyeHeight ?? 1.62, 0),
    direction: new Vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  }
}

function cursorBlock (bot) {
  const { origin, direction } = aim(bot)
  return bot.world.raycast(origin, direction, bot.game?.gameMode === 'creative' ? 5 : 4.5)
}

function cursorEntity (bot, reach = 3) {
  const { origin, direction } = aim(bot)
  const block = bot.world.raycast(origin, direction, reach)
  let distance = block?.intersect ? origin.distanceTo(block.intersect) : reach
  const ray = new RaycastIterator(origin, direction, reach)
  let target = null
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || entity.id === bot.entity.id || !entity.position || !entity.width || !entity.height || ['item', 'experience_orb'].includes(entity.name)) continue
    const half = entity.width / 2
    const hit = ray.intersect([[-half, 0, -half, half, entity.height, half]], entity.position)
    if (!hit || hit.pos.minus(origin).dot(direction) < 0) continue
    const next = origin.distanceTo(hit.pos)
    if (next < distance) { target = entity; distance = next }
  }
  return target
}

module.exports = { cursorBlock, cursorEntity }
