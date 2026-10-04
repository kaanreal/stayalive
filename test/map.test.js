const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { surface, buildMap } = require('../lib/map')

function terrain () {
  const registry = require('minecraft-data')('1.16.5')
  const Chunk = require('prismarine-chunk')('1.16.5')
  const column = new Chunk()
  const put = (x, y, z, name) => column.setBlockStateId(new Vec3(x, y, z), registry.blocksByName[name].defaultState)
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) put(x, 64, z, 'stone')
  put(2, 100, 2, 'stone')
  put(4, 65, 4, 'water')
  put(5, 65, 5, 'lava')
  put(6, 65, 6, 'stone_slab')
  const bot = { registry, game: { minY: 0, height: 256 }, entity: { position: new Vec3(8.5, 65, 8.5), yaw: Math.PI }, world: { getColumn: (x, z) => x === 0 && z === 0 ? column : null } }
  return { bot, column }
}

test('map samples real surfaces and standing heights, including a sky platform and slabs', () => {
  const { bot } = terrain()
  assert.equal(surface(bot, 2, 2, 'surface').y, 101)
  assert.equal(surface(bot, 2, 2, 'player').y, 65)
  assert.equal(surface(bot, 3, 3, 'surface').walkable, true)
  assert.equal(surface(bot, 4, 4, 'surface').walkable, false)
  assert.equal(surface(bot, 5, 5, 'surface').block, 'lava')
  assert.equal(surface(bot, 6, 6, 'surface').height, 65.5)
  assert.equal(surface(bot, 6, 6, 'surface').y, 65)
  assert.equal(surface(bot, -1, 0, 'surface'), null)
})

test('player-height view rejects slabs with low ceilings', () => {
  const { bot, column } = terrain()
  column.setBlockStateId(new Vec3(6, 66, 6), bot.registry.blocksByName.stone.defaultState)
  assert.equal(surface(bot, 6, 6, 'player').walkable, false)
})

test('map layout preserves world coordinates and unloaded cells', () => {
  const { bot } = terrain()
  const map = buildMap(bot, { mode: 'idle', points: [] }, 16, 'surface')
  assert.deepEqual(map.origin, { x: -8, z: -8 })
  assert.equal(map.tiles.length, 33 * 33)
  assert.equal(map.tiles[0], null)
  assert.equal(map.tiles[(2 - map.origin.z) * map.size + (2 - map.origin.x)].y, 101)
  assert.equal(map.player.x, 8.5)
})
