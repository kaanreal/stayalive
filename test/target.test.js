const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { cursorBlock, cursorEntity } = require('../lib/target')

function player () {
  const entity = { id: 1, position: new Vec3(0, 64, 0), eyeHeight: 1.62, width: 0.6, height: 1.8, yaw: 0, pitch: 0 }
  const near = { id: 2, name: 'player', position: new Vec3(0, 64, -2), width: 0.6, height: 1.8 }
  const far = { id: 3, name: 'player', position: new Vec3(0, 64, -3), width: 0.6, height: 1.8 }
  return { entity, entities: { 1: entity, 2: near, 3: far }, game: { gameMode: 'survival' }, world: { raycast: () => null } }
}

test('entity selection works with zero yaw and pitch and chooses the nearest hit', () => {
  const bot = player()
  assert.equal(cursorEntity(bot).id, 2)
  bot.entities[2].position.x = 2
  assert.equal(cursorEntity(bot).id, 3)
  bot.entities[3].position.z = -4
  assert.equal(cursorEntity(bot), null)
})

test('walls block entity attacks and raycasting starts at the crouched eye height', () => {
  const bot = player()
  bot.entity.eyeHeight = 1.27
  bot.world.raycast = (origin, direction, reach) => {
    assert.equal(origin.y, 65.27)
    assert.equal(direction.z, -1)
    assert.equal(reach, 3)
    return { intersect: origin.offset(0, 0, -1) }
  }
  assert.equal(cursorEntity(bot), null)
})

test('block reach follows game mode without falsy angle checks', () => {
  const bot = player()
  let reach
  bot.world.raycast = (origin, direction, distance) => { reach = distance; return { origin, direction } }
  assert.equal(cursorBlock(bot).origin.y, 65.62)
  assert.equal(reach, 4.5)
  bot.game.gameMode = 'creative'
  cursorBlock(bot)
  assert.equal(reach, 5)
})
