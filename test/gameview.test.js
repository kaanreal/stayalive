const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const { GameView, legacyTable, itemIcon, itemInfo, modelName, renderVersion } = require('../lib/gameview')
const { skinFile } = require('../lib/play')

const Block13 = require('prismarine-block')('1.13.2')
const block = id => Block13.fromStateId(legacyTable()[id])

test('legacy blocks keep their variants, colors and orientation in 1.13 states', () => {
  assert.equal(block((5 << 4) | 5).name, 'dark_oak_planks')
  assert.equal(block((159 << 4) | 1).name, 'orange_terracotta')
  assert.equal(block((35 << 4) | 14).name, 'red_wool')
  assert.equal(block((44 << 4) | 13).name, 'stone_brick_slab')
  assert.equal(block((44 << 4) | 13).getProperties().type, 'top')
  const stairs = block((53 << 4) | 3)
  assert.equal(stairs.name, 'oak_stairs')
  assert.equal(stairs.getProperties().facing, 'north')
  // Unlisted properties keep their defaults; stairs must not come out waterlogged.
  assert.equal(stairs.getProperties().waterlogged, false)
  assert.equal(block((17 << 4) | 4).getProperties().axis, 'x')
})

function fakeBot ({ flattening = false, version = '1.8.8' } = {}) {
  const bot = new EventEmitter()
  const columns = new Map()
  const Chunk = require('prismarine-chunk')(version)
  bot.version = version
  bot.supportFeature = feature => feature === 'theFlattening' ? flattening : false
  bot.game = {}
  bot._client = new EventEmitter()
  bot.registry = require('minecraft-data')(version)
  bot.players = {}
  bot.entities = {}
  bot.username = 'Me'
  bot.entity = { position: new Vec3(8, 64, 8) }
  bot.world = { getColumn: (x, z) => columns.get(`${x},${z}`) }
  bot.addColumn = (x, z) => {
    const column = new Chunk()
    column.setBlockType(new Vec3(1, 63, 1), 5)
    column.setBlockData(new Vec3(1, 63, 1), 5)
    columns.set(`${x},${z}`, column)
  }
  return bot
}

function fakeSocket () {
  const sent = []
  const socket = { sent, emit: (event, data) => sent.push([event, data]) }
  socket.volatile = socket
  return socket
}

test('the game view streams nearby chunks nearest first, converted for the renderer, and unloads far ones', async t => {
  const bot = fakeBot()
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) bot.addColumn(x, z)
  const socket = fakeSocket()
  const view = new GameView(bot, socket, 2)
  view.start()
  t.after(() => view.stop())
  assert.deepEqual(socket.sent[0], ['world', { version: '1.13.2', legacy: true, radius: 2, minY: 0, height: 256, cloudHeight: 128, self: { skin: null, cape: null, slim: false, name: 'Me', label: 'Me' } }])
  const deadline = Date.now() + 2000
  while (socket.sent.filter(([event]) => event === 'chunk').length < 25 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const chunks = socket.sent.filter(([event]) => event === 'chunk').map(([, data]) => data)
  assert.equal(chunks.length, 25)
  assert.deepEqual([chunks[0].x, chunks[0].z], [0, 0])
  const World = require('prismarine-viewer/viewer/lib/world').World
  const world = new World('1.13.2')
  world.addColumn(0, 0, chunks[0].chunk)
  assert.equal(world.getBlock(new Vec3(1, 63, 1)).name, 'dark_oak_planks')
  // Walking two chunks east drops the two western columns of five chunks each.
  bot.entity.position = new Vec3(40, 64, 8)
  bot.emit('move')
  const unloaded = socket.sent.filter(([event]) => event === 'unloadChunk').map(([, data]) => data.x)
  assert.equal(unloaded.length, 10)
  assert.deepEqual([...new Set(unloaded)].sort((a, b) => a - b), [-32, -16])
  // Block changes are translated too.
  bot.emit('blockUpdate', null, { position: new Vec3(17, 64, 1), type: 35, metadata: 14 })
  const update = socket.sent.find(([event]) => event === 'block')[1]
  assert.equal(Block13.fromStateId(update.stateId).name, 'red_wool')
})

test('entities carry skins, slim models, hologram names and sneaking; far ones are dropped', t => {
  const bot = fakeBot()
  bot.players.Alex = { username: 'Alex', uuid: '0000-1', skinData: { url: 'http://textures.minecraft.net/texture/abcdef0123456789abcdef', model: 'slim', capeUrl: 'http://textures.minecraft.net/texture/1234567890abcdef1234567890abcdef' } }
  const socket = fakeSocket()
  const view = new GameView(bot, socket, 4)
  view.start()
  t.after(() => view.stop())
  bot.emit('entitySpawn', { id: 1, type: 'player', name: 'player', username: 'Alex', position: new Vec3(10, 64, 10), yaw: 1, pitch: 0, height: 1.8, metadata: { 0: 0x02 } })
  bot.emit('entitySpawn', { id: 2, type: 'object', name: 'ArmorStand', position: new Vec3(12, 66, 10), yaw: 0, pitch: 0, metadata: { 0: 0x20, 2: '§aWelcome', 3: 1 } })
  bot.emit('entitySpawn', { id: 3, type: 'mob', name: 'Zombie', position: new Vec3(500, 64, 10), yaw: 0, pitch: 0, metadata: {} })
  const entities = socket.sent.filter(([event]) => event === 'entity').map(([, data]) => data)
  const alex = entities.find(e => e.id === 1)
  assert.equal(alex.model, 'player')
  assert.equal(alex.skin, 'abcdef0123456789abcdef')
  assert.equal(alex.cape, '1234567890abcdef1234567890abcdef')
  assert.equal(alex.slim, true)
  assert.equal(alex.sneaking, true)
  assert.equal(alex.label, 'Alex')
  const stand = entities.find(e => e.id === 2)
  assert.equal(stand.model, 'armor_stand')
  assert.equal(stand.invisible, true)
  assert.equal(stand.label, '\u00a7aWelcome')
  assert.ok(!entities.some(e => e.id === 3))
  // Moves stream as small volatile updates; leaving the area deletes the entity.
  bot.emit('entityMoved', { id: 1, type: 'player', username: 'Alex', position: new Vec3(11, 64, 10), yaw: 1, pitch: 0 })
  assert.deepEqual(socket.sent.at(-1)[0], 'move')
  bot.emit('entityMoved', { id: 1, type: 'player', username: 'Alex', position: new Vec3(900, 64, 10), yaw: 1, pitch: 0 })
  assert.deepEqual(socket.sent.at(-1), ['entity', { id: 1, delete: true }])
})

test('legacy and modern names resolve to models and item icons', () => {
  assert.equal(modelName('PigZombie'), 'zombified_piglin')
  assert.equal(modelName('ArmorStand'), 'armor_stand')
  assert.equal(modelName('zombie'), 'zombie')
  const legacy = fakeBot()
  assert.equal(itemIcon(legacy, { type: 282, metadata: 0, name: 'mushroom_stew' }), 'textures/1.13.2/items/mushroom_stew.png')
  assert.equal(itemIcon(legacy, { type: 276, metadata: 0, name: 'diamond_sword' }), 'textures/1.13.2/items/diamond_sword.png')
  assert.equal(itemIcon(legacy, { type: 322, metadata: 1, name: 'golden_apple' }), 'textures/1.13.2/items/golden_apple.png')
  assert.equal(renderVersion(fakeBot({ flattening: true, version: '1.20.4' })), '1.20.1')
})

test('skins are fetched only by texture hash, validated and cached', async () => {
  await assert.rejects(skinFile('../../etc/passwd'), /Invalid/)
  let calls = 0
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
  const download = async url => {
    calls++
    assert.match(url, /^https:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+$/)
    return { ok: true, arrayBuffer: async () => png }
  }
  const hash = '0123456789abcdef0123456789abcdef'
  assert.deepEqual(await skinFile(hash, download), png)
  assert.deepEqual(await skinFile(hash, download), png)
  assert.equal(calls, 1)
  await assert.rejects(skinFile('fedcba9876543210fedcba9876543210', async () => ({ ok: true, arrayBuffer: async () => Buffer.from('<html>') })), /Invalid skin/)
})

test('held block metadata keeps non-cube models and foliage tint colors', () => {
  const bot = fakeBot({ flattening: true, version: '1.16.5' })
  const item = name => ({ ...bot.registry.itemsByName[name], name, type: bot.registry.itemsByName[name].id, count: 1 })
  assert.equal(itemInfo(bot, item('oak_stairs')).block, 'oak_stairs')
  assert.equal(itemInfo(bot, item('grass_block')).tint, bot.registry.tints.grass.default)
  assert.equal(itemInfo(bot, item('oak_leaves')).tint, bot.registry.tints.foliage.default)
  assert.equal(itemInfo(bot, item('spruce_leaves')).tint, 6396257)
  assert.equal(itemInfo(bot, item('diamond_sword')).block, null)
})

test('gameplay widens view distance, cancels mining on aim changes and restores the account after', async t => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { io } = require('socket.io-client')
  const { Manager } = require('../lib/manager')
  const { createServer } = require('../server')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stayalive-play-'))
  const settings = []
  let aimedBlock = { name: 'stone', position: new Vec3(8, 65, 6), face: 3 }
  let digging = null
  let stopped = 0
  const manager = new Manager(directory, {
    createBot: options => {
      const bot = fakeBot()
      bot.settings = { viewDistance: options.viewDistance }
      bot.setSettings = next => { Object.assign(bot.settings, next); settings.push(next.viewDistance) }
      bot.loadPlugin = () => {}
      bot.pathfinder = { setGoal () {}, setMovements () {} }
      bot.clearControlStates = () => {}
      bot.setQuickBarSlot = () => {}
      bot.setControlState = () => {}
      bot.look = async () => {}
      bot.entity.yaw = 0
      bot.entity.pitch = 0
      bot.world.raycast = () => aimedBlock
      bot.canDigBlock = () => true
      bot.digTime = () => 500
      bot.stopDigging = () => {
        if (!bot.targetDigBlock) return
        stopped++
        bot.targetDigBlock = null
        bot.emit('diggingAborted')
        digging?.(Error('Digging aborted'))
      }
      bot.dig = async block => {
        bot.targetDigBlock = block
        await new Promise((resolve, reject) => { digging = reject })
      }
      bot.end = () => bot.emit('end')
      return bot
    },
    makeMovements: () => ({})
  })
  const probe = require('node:net').createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const server = createServer(manager, port)
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  t.after(async () => {
    manager.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  manager.configure({ host: 'localhost', port: 25565, version: '', reconnect: false, joinDelay: 1000 })
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  manager.join(id)
  await new Promise(resolve => setTimeout(resolve, 20))
  manager.get(id).bot.emit('spawn')
  const socket = io(`http://127.0.0.1:${port}`, { path: '/play/socket.io', auth: { account: id, radius: 6 }, transports: ['websocket'], extraHeaders: { Host: `127.0.0.1:${port}` } })
  t.after(() => socket.disconnect())
  const world = await new Promise((resolve, reject) => { socket.on('world', resolve); socket.on('fatal', reject) })
  assert.equal(world.radius, 6)
  assert.deepEqual(settings, [6])
  const control = await new Promise(resolve => socket.emit('takeControl', resolve))
  assert.deepEqual(control, { ok: true })
  const bot = manager.get(id).bot
  bot.physicsEnabled = true
  bot.entity.velocity = new Vec3(0, 0, 0)
  bot.entity.onGround = true
  const tickPosition = async () => {
    const update = new Promise(resolve => socket.once('position', resolve))
    bot.emit('physicsTick')
    return update
  }
  const first = await tickPosition()
  const second = await tickPosition()
  assert.equal(second.time - first.time, 50)
  assert.deepEqual(second.pos, first.pos)
  assert.deepEqual(second.velocity, { x: 0, y: 0, z: 0 })
  const teleport = new Promise(resolve => socket.once('position', resolve))
  bot.entity.position = new Vec3(9, 64, 8)
  bot.emit('forcedMove')
  assert.equal((await teleport).teleport, true)
  const started = new Promise(resolve => socket.once('dig', resolve))
  socket.emit('interact', 'left')
  assert.deepEqual(await started, { position: { x: 8, y: 65, z: 6 }, duration: 500 })
  const cancelled = new Promise(resolve => socket.once('dig', resolve))
  aimedBlock = null
  socket.emit('input', { keys: [], yaw: 1, pitch: 0, slot: 0 })
  assert.equal(await cancelled, null)
  assert.equal(stopped, 1)
  socket.disconnect()
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.deepEqual(settings, [6, 2])
})
