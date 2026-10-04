const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { Manager, validateRoute, validateSettings, validateActions, resourcePacks } = require('../lib/manager')
const { createServer } = require('../server')

function setup (t, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stayalive-test-'))
  const bots = []
  const manager = new Manager(directory, {
    createBot: options => {
      const bot = new EventEmitter()
      bot.options = options
      bot.world = {}
      bot.version = '1.16.5'
      bot.username = options.username
      bot.entity = { position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 }
      bot.loadPlugin = () => {}
      bot.controlState = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false }
      bot.setControlState = (key, value) => { bot.controlState[key] = value }
      bot.clearControlStates = () => { bot.cleared = true; for (const key in bot.controlState) bot.controlState[key] = false }
      bot.setQuickBarSlot = slot => { bot.quickBarSlot = slot }
      bot.look = async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch }
      bot.swingArm = () => { bot.swings = (bot.swings || 0) + 1 }
      bot.end = () => { bot.ended = true; bot.emit('end') }
      bot.moves = []
      bot.pathfinder = { setGoal: goal => { bot.goal = goal }, setMovements: m => { bot.movements = m }, goto: goal => { bot.moves.push(goal); bot.entity.position = { x: goal.x, y: goal.y, z: goal.z }; return Promise.resolve() } }
      bots.push(bot)
      return bot
    },
    makeMovements: () => ({}),
    ...extra
  })
  t.after(() => { manager.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  manager.configure({ host: 'localhost', port: 25565, version: '', reconnect: false, joinDelay: 1000 })
  return { manager, bots, directory }
}

test('bulk import deduplicates labels and persists accounts without runtime or tokens', t => {
  const { manager, directory } = setup(t)
  manager.add('main@example.com\nbackup\nMAIN@example.com')
  assert.equal(manager.accounts.size, 2)
  const loaded = new Manager(directory)
  assert.equal(loaded.accounts.size, 2)
  assert.equal([...loaded.accounts.values()][0].status, 'disconnected')
  const saved = fs.readFileSync(path.join(directory, 'settings.json'), 'utf8')
  assert.ok(!saved.includes('accessToken'))
  assert.throws(() => manager.add('email:password'), /without passwords/)
})

test('rejects invalid coordinates, identical loops and invalid server settings', () => {
  assert.throws(() => validateRoute({ mode: 'loop', points: [{ x: 1, y: 64, z: 1 }, { x: 1, y: 64, z: 1 }] }), /different/)
  assert.throws(() => validateRoute({ mode: 'goto', points: [{ x: 0.2, y: 64, z: 1 }] }), /integer/)
  assert.throws(() => validateRoute({ mode: 'goto', points: [{ x: 1, y: NaN, z: 1 }] }), /integer/)
  assert.throws(() => validateSettings({ host: 'https://example.com', port: 25565, joinDelay: 1000 }), /hostname/)
  assert.throws(() => validateSettings({ host: 'localhost', port: -1, joinDelay: 1000 }), /Port/)
})

test('Microsoft device code becomes visible, profile is saved and overlapping logins are rejected', async t => {
  let resolve
  const { manager } = setup(t, { createAuth: (id, directory, options, callback) => {
    assert.equal(options.flow, 'live')
    callback({ user_code: 'ABCD-EFGH', verification_uri: 'https://www.microsoft.com/link', expires_in: 900 })
    return { getMinecraftJavaToken: () => new Promise(done => { resolve = done }) }
  } })
  manager.add('main')
  const a = [...manager.accounts.values()][0]
  const login = manager.login(a.id)
  assert.equal(a.code.userCode, 'ABCD-EFGH')
  assert.equal(a.status, 'login required')
  await assert.rejects(manager.login(a.id), /Disconnect/)
  assert.throws(() => manager.remove(a.id), /pending login/)
  resolve({ profile: { name: 'RealPlayer' } })
  await login
  assert.equal(a.username, 'RealPlayer')
  assert.equal(a.code, null)
  assert.equal(a.status, 'ready')
})

test('disconnect cancels queued bulk joins', async t => {
  const { manager, bots } = setup(t)
  manager.add('One\nTwo', 'offline')
  const ids = [...manager.accounts.keys()]
  manager.joinMany(ids)
  ids.forEach(id => manager.disconnect(id))
  await delay(25)
  assert.equal(bots.length, 0)
  assert.ok([...manager.accounts.values()].every(a => !a.desired && a.status === 'disconnected'))
})

test('goto stops at destination and disables destructive movement', async t => {
  const { manager, bots } = setup(t)
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  manager.setRoute([id], { mode: 'goto', points: [{ x: 12, y: 64, z: 8 }] })
  manager.join(id)
  await delay(10)
  const bot = bots[0]
  bot.emit('spawn')
  await delay(10)
  assert.equal(bot.options.viewDistance, 2)
  assert.equal(bot.options.plugins.resource_pack, resourcePacks)
  assert.equal(bot.movements.canDig, false)
  assert.deepEqual(bot.movements.scafoldingBlocks, [])
  assert.equal(bot.moves[0].x, 12)
  assert.equal(manager.get(id).status, 'idle')
  assert.equal(manager.get(id).route.mode, 'idle')
})

test('route loops and stop prevents further waypoint dispatch', async t => {
  const { manager, bots } = setup(t)
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  manager.setRoute([id], { mode: 'loop', points: [{ x: 1, y: 64, z: 1 }, { x: 3, y: 64, z: 1 }] })
  manager.join(id)
  await delay(10)
  bots[0].emit('spawn')
  await delay(330)
  assert.equal(bots[0].moves.length, 2)
  assert.equal(bots[0].moves[1].x, 3)
  manager.setRoute([id], { mode: 'idle', points: [] })
  await delay(330)
  assert.equal(bots[0].moves.length, 2)
  assert.equal(manager.get(id).status, 'idle')
})

test('stopping an in-flight path cannot restart its loop after resolution', async t => {
  let finish
  const { manager, bots } = setup(t)
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  manager.join(id)
  await delay(10)
  bots[0].emit('spawn')
  bots[0].pathfinder.goto = () => new Promise(resolve => { finish = resolve })
  manager.setRoute([id], { mode: 'loop', points: [{ x: 1, y: 64, z: 1 }, { x: 3, y: 64, z: 1 }] })
  manager.setRoute([id], { mode: 'idle', points: [] })
  finish()
  await delay(10)
  assert.equal(manager.get(id).status, 'idle')
  assert.equal(manager.get(id).walkTimer, undefined)
})

test('disconnect cancels reconnect timers and ignores old connection callbacks', async t => {
  const { manager, bots } = setup(t)
  manager.settings.reconnect = true
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  manager.join(id)
  await delay(10)
  bots[0].emit('end')
  assert.equal(manager.get(id).status, 'reconnecting')
  assert.ok(manager.get(id).timer)
  manager.disconnect(id)
  assert.equal(manager.get(id).timer, null)
  assert.equal(manager.get(id).desired, false)
  bots[0].emit('spawn')
  assert.equal(manager.get(id).status, 'disconnected')
})

test('unreachable paths report failure and stop clears retry timer', async t => {
  const { manager, bots } = setup(t)
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  manager.join(id)
  await delay(10)
  bots[0].emit('spawn')
  bots[0].pathfinder.goto = () => Promise.reject(Error('No path'))
  manager.setRoute([id], { mode: 'goto', points: [{ x: 1, y: 64, z: 1 }] })
  await delay(10)
  assert.equal(manager.get(id).status, 'path blocked')
  assert.ok(manager.logs.some(l => l.message.includes('No path')))
  assert.equal(bots[0].goal, null)
  assert.ok(bots[0].cleared)
  manager.disconnect(id)
  assert.equal(manager.get(id).status, 'disconnected')
})

test('an empty failed path cannot be mistaken for arrival or advance a loop', async t => {
  const { manager, bots } = setup(t)
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  manager.join(id)
  await delay(10)
  bots[0].emit('spawn')
  bots[0].pathfinder.goto = () => Promise.resolve()
  manager.setRoute([id], { mode: 'loop', points: [{ x: -19, y: 65, z: 31 }, { x: -10, y: 65, z: 10 }] })
  await delay(10)
  assert.equal(manager.get(id).status, 'path blocked')
  assert.equal(manager.get(id).routeIndex, 0)
  assert.equal(manager.get(id).route.mode, 'loop')
  assert.ok(manager.logs.some(l => l.message.includes('from 0 64 0 to -19 65 31')))
  assert.equal(bots[0].goal, null)
  manager.setRoute([id], { mode: 'goto', points: [{ x: -19, y: 65, z: 31 }] })
  await delay(10)
  assert.equal(manager.get(id).status, 'path blocked')
  assert.equal(manager.get(id).route.mode, 'goto')
  assert.ok(!manager.logs.some(l => l.message.startsWith('Reached ')))
})

test('player settings validate ranges and persist per account', t => {
  const { manager, directory } = setup(t)
  manager.add('One\nTwo', 'offline')
  const ids = [...manager.accounts.keys()]
  const actions = structuredClone(manager.get(ids[0]).actions)
  actions.yaw = -90
  actions.pitch = 30
  actions.slot = 9
  actions.sneak = true
  actions.antiAfk.enabled = true
  manager.setActions(ids, actions)
  const loaded = new Manager(directory)
  assert.deepEqual(loaded.get(ids[1]).actions, actions)
  assert.equal(loaded.get(ids[0]).antiTimer, null)
  assert.throws(() => validateActions({ ...actions, slot: 10 }), /Hotbar/)
  assert.throws(() => validateActions({ ...actions, yaw: NaN }), /Yaw/)
  assert.throws(() => validateActions({ ...actions, pitch: 91 }), /Pitch/)
  assert.throws(() => validateActions({ ...actions, antiAfk: { ...actions.antiAfk, interval: 0 } }), /interval/)
  assert.throws(() => manager.action(ids, 'jump'), /Join the server/)
})

test('rotation uses Minecraft degrees, hotbar uses slots 1 to 9 and sneak gestures restore held state', async t => {
  const { manager, bots } = setup(t)
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  manager.join(id)
  await delay(10)
  bots[0].emit('spawn')
  const actions = structuredClone(manager.get(id).actions)
  Object.assign(actions, { yaw: 90, pitch: -45, slot: 9, sneak: true })
  manager.setActions([id], actions)
  assert.equal(bots[0].entity.yaw, Math.PI / 2)
  assert.equal(bots[0].entity.pitch, Math.PI / 4)
  assert.equal(bots[0].quickBarSlot, 8)
  assert.equal(bots[0].controlState.sneak, true)
  manager.action([id], 'sneak')
  assert.equal(bots[0].controlState.sneak, false)
  await delay(730)
  assert.equal(bots[0].controlState.sneak, true)
  manager.action([id], 'jump')
  assert.equal(bots[0].controlState.jump, true)
  await delay(430)
  assert.equal(bots[0].controlState.jump, false)
  manager.action([id], 'swing')
  assert.equal(bots[0].swings, 1)
})

test('anti-AFK yields controls to walking and cancels its timers when disabled or disconnected', async t => {
  const { manager, bots } = setup(t)
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  const a = manager.get(id)
  manager.join(id)
  await delay(10)
  bots[0].emit('spawn')
  const actions = structuredClone(a.actions)
  actions.antiAfk = { enabled: true, interval: 5, jump: true, sneak: true, swing: true, rotate: true, hotbar: true }
  manager.setActions([id], actions)
  assert.ok(a.antiTimer)
  manager.antiAfk(a)
  assert.equal(bots[0].swings, 1)
  assert.equal(bots[0].quickBarSlot, 1)
  assert.equal(bots[0].controlState.jump, true)
  assert.equal(bots[0].controlState.sneak, true)
  bots[0].pathfinder.goto = () => new Promise(() => {})
  manager.setRoute([id], { mode: 'goto', points: [{ x: 5, y: 64, z: 0 }] })
  const yaw = bots[0].entity.yaw
  assert.deepEqual(a.actionTimers, {})
  manager.antiAfk(a)
  assert.equal(bots[0].swings, 2)
  assert.equal(bots[0].controlState.jump, false)
  assert.equal(bots[0].controlState.sneak, false)
  assert.equal(bots[0].entity.yaw, yaw)
  assert.throws(() => manager.action([id], 'jump'), /Stop walking/)
  actions.antiAfk.enabled = false
  manager.setActions([id], actions)
  assert.equal(a.antiTimer, null)
  actions.antiAfk.enabled = true
  manager.setActions([id], actions)
  manager.disconnect(id)
  assert.equal(a.antiTimer, null)
  assert.deepEqual(a.actionTimers, {})
})

test('manual control pauses routes, enforces one owner and resumes on release', async t => {
  const { manager, bots } = setup(t)
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  manager.join(id)
  await delay(10)
  bots[0].emit('spawn')
  bots[0].pathfinder.goto = () => new Promise(() => {})
  manager.setRoute([id], { mode: 'loop', points: [{ x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }] })
  manager.beginManual(id, 'window-one')
  assert.equal(manager.get(id).status, 'manual')
  assert.equal(bots[0].goal, null)
  assert.equal(manager.get(id).antiTimer, null)
  assert.throws(() => manager.beginManual(id, 'window-two'), /another gameplay/)
  manager.manualInput(id, 'window-one', { keys: ['forward', 'jump'], yaw: 1, pitch: .2, slot: 4 })
  assert.equal(bots[0].controlState.forward, true)
  assert.equal(bots[0].controlState.jump, true)
  assert.equal(bots[0].quickBarSlot, 4)
  assert.equal(bots[0].entity.yaw, 1)
  assert.throws(() => manager.manualInput(id, 'window-two', { keys: [], yaw: 0, pitch: 0, slot: 0 }), /Take control/)
  assert.throws(() => manager.manualInput(id, 'window-one', { keys: ['fly'], yaw: 0, pitch: 0, slot: 0 }), /Invalid/)
  manager.endManual(id, 'window-one')
  assert.equal(manager.get(id).manual, null)
  assert.equal(manager.get(id).status, 'walking')
  assert.equal(manager.get(id).route.mode, 'loop')
  assert.equal(bots[0].controlState.forward, false)
})

test('lost manual heartbeats release movement and disconnect cancels the lease', t => {
  const { manager } = setup(t)
  manager.add('PlayerOne', 'offline')
  const [id] = manager.accounts.keys()
  const a = manager.get(id)
  a.desired = true
  manager.connect(a)
  a.bot.emit('spawn')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  manager.beginManual(id, 'window')
  manager.manualInput(id, 'window', { keys: ['forward', 'sneak'], yaw: 0, pitch: 0, slot: 0 })
  t.mock.timers.tick(1501)
  assert.equal(a.manual, null)
  assert.equal(a.bot.controlState.forward, false)
  assert.equal(a.bot.controlState.sneak, false)
  assert.equal(a.status, 'idle')
  manager.beginManual(id, 'window')
  manager.disconnect(id)
  assert.equal(a.manual, null)
  assert.equal(a.status, 'disconnected')
  manager.remove(id)
  assert.doesNotThrow(() => manager.endManual(id, 'window'))
})

test('resource packs are declined once with the correct protocol identifier', () => {
  for (const packet of [{ uuid: 'test-uuid', url: 'https://example.com' }, { hash: 'test-hash' }, {}]) {
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    const writes = []
    bot._client.write = (type, value) => writes.push({ type, value })
    bot.supportFeature = feature => feature === 'resourcePackUsesHash' && !!packet.hash
    resourcePacks(bot)
    bot._client.emit(packet.uuid ? 'add_resource_pack' : 'resource_pack_send', packet)
    assert.equal(writes.length, 1)
    assert.equal(writes[0].value.result, 1)
    if (packet.uuid) assert.equal(writes[0].value.uuid, packet.uuid)
    if (packet.hash) assert.equal(writes[0].value.hash, packet.hash)
  }
})

test('HTTP API imports accounts, serves dashboard, rejects invalid origins and unknown actions', async t => {
  const { manager } = setup(t)
  // Find an unused port before creating the local Host allowlist.
  const probe = require('node:net').createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const server = createServer(manager, port)
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const base = `http://127.0.0.1:${port}`
  const response = await fetch(base)
  assert.match(await response.text(), /Keep your spot/)
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal((await fetch(base + '/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'AccountOne', auth: 'offline' }) })).status, 200)
  const state = await (await fetch(base + '/api/state')).json()
  assert.equal(state.accounts[0].label, 'AccountOne')
  assert.equal((await fetch(base + '/api/state', { headers: { Origin: 'https://example.com' } })).status, 403)
  assert.equal((await fetch(base + '/api/accounts', { method: 'POST', body: 'csrf' })).status, 400)
  assert.equal((await fetch(base + '/api/unknown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404)
})
