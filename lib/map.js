const { Vec3 } = require('vec3')

function surface (bot, x, z, layer) {
  const column = bot.world.getColumn(x >> 4, z >> 4)
  if (!column) return null
  const minY = bot.game.minY ?? 0
  const top = minY + (bot.game.height ?? 256) - 1
  const limit = layer === 'player' ? Math.min(top, Math.floor(bot.entity.position.y)) : top
  const local = new Vec3(x & 15, limit, z & 15)
  for (; local.y >= minY; local.y--) {
    const id = column.getBlockStateId(local)
    const type = bot.registry.blocksByStateId[id]
    if (!type || ['air', 'cave_air', 'void_air'].includes(type.name)) continue
    const block = column.getBlock(local)
    const liquid = /^(water|lava)$/.test(type.name)
    if (!block.shapes.length && !liquid) continue
    const height = liquid ? 1 : Math.max(...block.shapes.map(shape => shape[4]))
    const feet = local.y + height
    let headroom = true
    for (let y = Math.floor(feet + 0.01); y < feet + 1.8; y++) {
      if (y === local.y || y > top) continue
      const space = column.getBlock(new Vec3(local.x, y, local.z))
      if (!space || space.shapes.length || /lava|fire/.test(space.name)) { headroom = false; break }
    }
    return { y: Math.floor(feet), height: feet, block: type.name, walkable: !liquid && headroom && !/cactus|magma|campfire/.test(type.name) }
  }
  return null
}

function buildMap (bot, route, radius, layer) {
  const centerX = Math.floor(bot.entity.position.x)
  const centerZ = Math.floor(bot.entity.position.z)
  const size = radius * 2 + 1
  const origin = { x: centerX - radius, z: centerZ - radius }
  const tiles = []
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) tiles.push(surface(bot, origin.x + x, origin.z + z, layer))
  }
  return { size, origin, tiles, player: { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z, yaw: bot.entity.yaw }, route }
}

module.exports = { surface, buildMap }
