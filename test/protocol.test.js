const { test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const mc = require('minecraft-protocol')
const { Vec3 } = require('vec3')
const { Manager } = require('../lib/manager')

test('real clients walk off a sky platform, land 36 blocks below and continue their route', { timeout: 20000 }, async t => {
  const version = '1.16.5'
  const server = mc.createServer({ host: '127.0.0.1', port: 0, version, 'online-mode': false })
  await once(server, 'listening')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stayalive-protocol-'))
  const manager = new Manager(directory)
  t.after(() => {
    manager.close()
    for (const client of Object.values(server.clients)) client.end()
    server.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const data = require('minecraft-data')(version)
  const Chunk = require('prismarine-chunk')(version)
  const chunk = new Chunk()
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) chunk.setBlockStateId(new Vec3(x, 64, z), data.blocksByName.stone.defaultState)
  }
  const platformChunk = new Chunk()
  platformChunk.load(chunk.dump(), chunk.getMask(), false, true)
  for (let x = 1; x <= 3; x++) {
    for (let z = 1; z <= 3; z++) platformChunk.setBlockStateId(new Vec3(x, 100, z), data.blocksByName.stone.defaultState)
  }
  const joined = []
  const positions = []
  const declined = []
  const animations = []
  const controls = []
  const slots = []
  const looks = []
  server.on('playerJoin', client => {
    joined.push(client.username)
    client.on('resource_pack_receive', packet => declined.push(packet.result))
    client.on('position', p => positions.push({ name: client.username, ...p }))
    client.on('position_look', p => positions.push({ name: client.username, ...p }))
    client.on('arm_animation', p => animations.push(p))
    client.on('entity_action', p => controls.push(p))
    client.on('held_item_slot', p => slots.push(p.slotId))
    client.on('look', p => looks.push(p))
    client.on('position_look', p => looks.push(p))
    client.write('login', {
      ...data.loginPacket, entityId: client.id, isHardcore: false, gameMode: 0, previousGameMode: 1,
      worldName: 'minecraft:overworld', hashedSeed: [0, 0], maxPlayers: 10, viewDistance: 2,
      reducedDebugInfo: false, enableRespawnScreen: true, isDebug: false, isFlat: true
    })
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        const column = x === 0 && z === 0 ? platformChunk : chunk
        client.write('map_chunk', {
          x, z, groundUp: true, biomes: column.dumpBiomes(),
          heightmaps: { type: 'compound', name: '', value: {} },
          bitMap: column.getMask(), chunkData: column.dump(), blockEntities: []
        })
      }
    }
    client.write('position', { x: 2.5, y: 101, z: 2.5, yaw: 0, pitch: 0, flags: 0, teleportId: 1 })
    client.write('update_health', { health: 20, food: 20, foodSaturation: 5 })
    client.write('resource_pack_send', { url: 'https://example.invalid/never-download.zip', hash: '0123456789012345678901234567890123456789' })
  })
  manager.configure({ host: '127.0.0.1', port: server.socketServer.address().port, version, reconnect: false, joinDelay: 1000 })
  manager.add('WalkerOne\nWalkerTwo', 'offline')
  const ids = [...manager.accounts.keys()]
  manager.setRoute([ids[0]], { mode: 'loop', points: [{ x: 5, y: 65, z: 2 }, { x: 2, y: 65, z: 2 }] })
  manager.joinMany(ids)
  const waitUntil = async predicate => {
    const deadline = Date.now() + 15000
    while (!predicate()) {
      if (Date.now() > deadline) assert.fail(JSON.stringify({ logs: manager.snapshot().logs, animations, controls, slots }))
      await delay(50)
    }
  }
  await waitUntil(() => joined.length === 2 && declined.length === 2 && positions.some(p => p.name === 'WalkerOne' && p.x > 4.7))
  assert.deepEqual(joined, ['WalkerOne', 'WalkerTwo'])
  assert.deepEqual(declined, [1, 1])
  const turn = positions.findIndex(p => p.name === 'WalkerOne' && p.x > 4.7)
  assert.ok(positions.some(p => p.name === 'WalkerOne' && p.y > 100))
  await waitUntil(() => positions.some(p => p.name === 'WalkerOne' && p.y === 65 && p.x > 4.7))
  await waitUntil(() => positions.slice(turn + 1).some(p => p.name === 'WalkerOne' && p.x < 3))
  manager.setRoute([ids[0]], { mode: 'idle', points: [] })
  assert.equal(manager.get(ids[0]).status, 'idle')
  manager.refresh()
  assert.ok(manager.get(ids[0]).position)
  manager.setRoute([ids[0]], { mode: 'goto', points: [{ x: 5, y: 60, z: 2 }] })
  await waitUntil(() => manager.get(ids[0]).status === 'path blocked')
  assert.equal(manager.get(ids[0]).route.mode, 'goto')
  assert.ok(manager.logs.some(l => l.message.includes('to 5 60 2:')))
  assert.equal(manager.get(ids[0]).bot.pathfinder.goal, null)
  manager.setRoute([ids[0]], { mode: 'idle', points: [] })
  const actions = structuredClone(manager.get(ids[0]).actions)
  Object.assign(actions, { yaw: 90, pitch: 30, slot: 9 })
  actions.antiAfk = { enabled: true, interval: 5, jump: true, sneak: true, swing: true, rotate: true, hotbar: true }
  manager.setActions([ids[0]], actions)
  await waitUntil(() => slots.includes(8) && looks.some(p => Math.abs(p.yaw - 90) < 0.5 && Math.abs(p.pitch - 30) < 0.5))
  const before = positions.length
  await waitUntil(() => animations.length > 0 && slots.includes(0) && controls.some(p => p.actionId === 'start_sneaking') && controls.some(p => p.actionId === 'stop_sneaking'))
  await waitUntil(() => positions.slice(before).some(p => p.name === 'WalkerOne' && p.y > 65.1))
  actions.antiAfk.enabled = false
  manager.setActions([ids[0]], actions)
  assert.equal(manager.get(ids[0]).antiTimer, null)
  ids.forEach(id => manager.disconnect(id))
  await waitUntil(() => Object.keys(server.clients).length === 0)
  assert.ok([...manager.accounts.values()].every(a => a.status === 'disconnected'))
})
