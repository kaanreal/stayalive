const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const mineflayer = require('mineflayer')
const { Authflow, Titles } = require('prismarine-auth')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { surface, buildMap } = require('./map')

const authOptions = { authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo', flow: 'live' }
const defaults = { host: '', port: 25565, version: '', reconnect: false, joinDelay: 3000 }
const actionDefaults = { yaw: 0, pitch: 0, slot: 1, sneak: false, antiAfk: { enabled: false, interval: 30, jump: true, sneak: false, swing: true, rotate: false, hotbar: false } }

function validateActions (input) {
  if (!input || !Number.isFinite(input.yaw) || input.yaw < -180 || input.yaw > 180) throw Error('Yaw must be between -180 and 180 degrees.')
  if (!Number.isFinite(input.pitch) || input.pitch < -90 || input.pitch > 90) throw Error('Pitch must be between -90 and 90 degrees.')
  if (!Number.isInteger(input.slot) || input.slot < 1 || input.slot > 9) throw Error('Hotbar slot must be between 1 and 9.')
  const anti = input.antiAfk
  if (!anti || !Number.isInteger(anti.interval) || anti.interval < 5 || anti.interval > 3600) throw Error('Anti-AFK interval must be between 5 and 3600 seconds.')
  const antiAfk = { interval: anti.interval }
  for (const key of ['enabled', 'jump', 'sneak', 'swing', 'rotate', 'hotbar']) {
    if (typeof anti[key] !== 'boolean') throw Error('Invalid anti-AFK option.')
    antiAfk[key] = anti[key]
  }
  if (typeof input.sneak !== 'boolean') throw Error('Invalid sneak option.')
  if (antiAfk.enabled && !['jump', 'sneak', 'swing', 'rotate', 'hotbar'].some(key => antiAfk[key])) throw Error('Choose at least one anti-AFK action.')
  return { yaw: input.yaw, pitch: input.pitch, slot: input.slot, sneak: input.sneak, antiAfk }
}

function validateSettings (input) {
  const host = String(input.host || '').trim()
  const port = Number(input.port)
  const joinDelay = Number(input.joinDelay)
  const version = String(input.version || '').trim()
  if (!host || host.length > 253 || /[\s/\\]/.test(host)) throw Error('Enter a server hostname or IP, without a port or URL.')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Port must be between 1 and 65535.')
  if (!Number.isInteger(joinDelay) || joinDelay < 1000 || joinDelay > 60000) throw Error('Join delay must be between 1000 and 60000 ms.')
  if (version && !/^\d+\.\d+(\.\d+)?$/.test(version)) throw Error('Enter a version like 1.21.4, or leave it empty for automatic detection.')
  return { host, port, version, reconnect: input.reconnect === true, joinDelay }
}

function validateRoute (input) {
  if (!['idle', 'goto', 'loop'].includes(input.mode)) throw Error('Unknown movement mode.')
  if (!Array.isArray(input.points) || input.points.length > 100) throw Error('Use up to 100 waypoints.')
  const points = input.points.map(p => {
    if (!p || !['x', 'y', 'z'].every(k => Number.isInteger(p[k]))) throw Error('Waypoints need integer X, Y and Z coordinates.')
    if (Math.abs(p.x) > 30000000 || Math.abs(p.z) > 30000000 || p.y < -2048 || p.y > 2048) throw Error('Waypoint is outside the supported world bounds.')
    return { x: p.x, y: p.y, z: p.z }
  })
  if (input.mode === 'goto' && points.length !== 1) throw Error('Walk to needs exactly one waypoint.')
  if (input.mode === 'loop' && (points.length < 2 || new Set(points.map(p => JSON.stringify(p))).size < 2)) throw Error('Repeated walking needs at least two different waypoints.')
  return { mode: input.mode, points: input.mode === 'idle' ? [] : points }
}

// Answer in both configuration and play without downloading a pack.
function resourcePacks (bot) {
  const decline = packet => {
    const response = { result: 1 }
    if (packet.uuid !== undefined) response.uuid = packet.uuid
    else if (bot.supportFeature('resourcePackUsesHash')) response.hash = packet.hash
    bot._client.write('resource_pack_receive', response)
    bot.emit('packDeclined')
  }
  bot._client.on('add_resource_pack', decline)
  bot._client.on('resource_pack_send', decline)
}

class Manager extends EventEmitter {
  constructor (directory, dependencies = {}) {
    super()
    this.directory = directory
    this.createBot = dependencies.createBot || mineflayer.createBot
    this.createAuth = dependencies.createAuth || ((...args) => new Authflow(...args))
    this.makeMovements = dependencies.makeMovements || (bot => new Movements(bot))
    this.accounts = new Map()
    this.logs = []
    fs.mkdirSync(directory, { recursive: true })
    const file = path.join(directory, 'settings.json')
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
    this.settings = { ...defaults, ...saved.settings }
    for (const account of saved.accounts || []) this.accounts.set(account.id, this.runtime(account))
  }

  runtime (account) {
    return { ...account, actions: account.actions || structuredClone(actionDefaults), status: 'disconnected', desired: false, bot: null, code: null, error: '', position: null, route: account.route || { mode: 'idle', points: [] }, timer: null, retry: 0, movement: 0, routeIndex: 0, authPending: false, actionTimers: {}, antiTimer: null, antiStep: 0, manual: null, server: null, path: [] }
  }

  snapshot () {
    return {
      settings: this.settings,
      versions: mineflayer.testedVersions,
      accounts: [...this.accounts.values()].map(a => ({ id: a.id, label: a.label, auth: a.auth, username: a.username, status: a.status, code: a.code, error: a.error, position: a.position, route: a.route, routeIndex: a.routeIndex, actions: a.actions, rotation: a.bot?.entity ? { yaw: Math.round(((180 - a.bot.entity.yaw * 180 / Math.PI + 540) % 360) - 180), pitch: Math.round(-a.bot.entity.pitch * 180 / Math.PI) } : null, slot: a.bot?.quickBarSlot === undefined ? null : a.bot.quickBarSlot + 1, server: a.bot || a.desired ? a.server : null, version: a.bot?.version || null, ping: a.bot?.player?.ping ?? null, health: a.bot?.health ?? null, food: a.bot?.food ?? null, dimension: a.bot?.game?.dimension ?? null })),
      logs: this.logs,
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024)
    }
  }

  publish () { this.emit('change', this.snapshot()) }

  log (account, message) {
    this.logs.push({ time: new Date().toISOString(), account: account?.label || 'stayalive', message: String(message).slice(0, 1200) })
    this.logs = this.logs.slice(-150)
    this.publish()
  }

  save () {
    const accounts = [...this.accounts.values()].map(({ id, label, auth, username, route, actions }) => ({ id, label, auth, username, route, actions }))
    const file = path.join(this.directory, 'settings.json')
    fs.writeFileSync(file + '.tmp', JSON.stringify({ settings: this.settings, accounts }, null, 2))
    fs.renameSync(file + '.tmp', file)
    this.publish()
  }

  get (id) {
    const account = this.accounts.get(id)
    if (!account) throw Error('Account not found.')
    return account
  }

  add (text, auth = 'microsoft') {
    if (typeof text !== 'string' || !['microsoft', 'offline'].includes(auth)) throw Error('Invalid account import.')
    const labels = [...new Set(text.split(/[\n,]/).map(s => s.trim()).filter(Boolean))]
    if (!labels.length) throw Error('Enter an account label or email, one per line.')
    if (labels.length + this.accounts.size > 100) throw Error('Use up to 100 accounts in this dashboard.')
    for (const label of labels) {
      if (label.length > 120 || /[\s:;]/.test(label)) throw Error('Use labels or emails only, without passwords, spaces or separators.')
      if (auth === 'offline' && !/^[a-zA-Z0-9_]{3,16}$/.test(label)) throw Error('Offline usernames need 3 to 16 letters, digits or underscores.')
    }
    for (const label of labels) {
      if ([...this.accounts.values()].some(a => a.label.toLowerCase() === label.toLowerCase() && a.auth === auth)) continue
      const id = randomUUID()
      this.accounts.set(id, this.runtime({ id, label, auth, username: auth === 'offline' ? label : '' }))
    }
    this.save()
  }

  configure (input) { this.settings = validateSettings(input); this.save() }

  codeCallback (account) {
    return code => {
      account.code = { userCode: code.user_code, url: code.verification_uri || 'https://www.microsoft.com/link', expiresAt: Date.now() + (code.expires_in || 900) * 1000 }
      account.status = 'login required'
      this.log(account, 'Complete Microsoft login using the code shown on this account.')
    }
  }

  async login (id) {
    const a = this.get(id)
    if (a.auth === 'offline') throw Error('Offline accounts do not use Microsoft login.')
    if (a.bot || a.desired || a.authPending) throw Error('Disconnect this account before starting a separate login.')
    a.authPending = true
    a.status = 'signing in'
    a.error = ''
    this.publish()
    try {
      const flow = this.createAuth(a.id, path.join(this.directory, 'tokens', a.id), authOptions, this.codeCallback(a))
      const { profile } = await flow.getMinecraftJavaToken({ fetchProfile: true })
      if (!profile?.name) throw Error('This Microsoft account has no Minecraft Java profile.')
      if ([...this.accounts.values()].some(other => other !== a && other.auth === 'microsoft' && other.username === profile.name)) throw Error('This Minecraft profile is already saved under another account. Sign in with a different Microsoft account.')
      a.username = profile.name
      a.status = 'ready'
      this.save()
      this.log(a, `Signed in as ${profile.name}.`)
    } catch (error) {
      a.error = error.message
      a.status = 'login failed'
      this.log(a, error.message)
    } finally {
      a.authPending = false
      a.code = null
      this.publish()
    }
  }

  join (id, delay = 0) {
    const a = this.get(id)
    validateSettings(this.settings)
    if (a.authPending) throw Error('Finish the current Microsoft login first.')
    if (a.desired || a.bot) return
    a.desired = true
    a.retry = 0
    a.error = ''
    a.status = 'queued'
    a.server = { host: this.settings.host, port: this.settings.port }
    a.timer = setTimeout(() => { a.timer = null; this.connect(a) }, delay)
    this.publish()
  }

  joinMany (ids) {
    for (const id of ids) if (this.get(id).authPending) throw Error('Finish all pending Microsoft logins first.')
    ids.forEach((id, index) => this.join(id, index * this.settings.joinDelay))
  }

  connect (a) {
    if (!a.desired) return
    a.status = 'connecting'
    a.server = { host: this.settings.host, port: this.settings.port }
    this.publish()
    try {
      const bot = this.createBot({
        host: this.settings.host, port: this.settings.port, version: this.settings.version || false,
        username: a.auth === 'microsoft' ? a.id : a.label, auth: a.auth,
        profilesFolder: path.join(this.directory, 'tokens', a.id), ...authOptions,
        onMsaCode: this.codeCallback(a), viewDistance: 2, logErrors: false,
        plugins: { resource_pack: resourcePacks }
      })
      a.bot = bot
      bot.loadPlugin(pathfinder)
      // Keep the latest computed path so the map can draw where the bot is heading.
      bot.on('path_update', result => {
        if (a.bot === bot) a.path = (result.path || []).slice(0, 512).map(p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }))
      })
      bot.on('connect', () => { if (a.bot !== bot || !a.desired) bot.end() })
      bot.on('spawn', () => {
        if (a.bot !== bot || !a.desired) { bot.end(); return }
        a.code = null
        a.username = bot.username
        a.retry = 0
        a.error = ''
        const movements = this.makeMovements(bot)
        movements.canDig = false
        movements.allow1by1towers = false
        movements.canOpenDoors = false
        movements.scafoldingBlocks = []
        // Some servers spawn players on sky platforms above the route.
        movements.maxDropDown = Infinity
        bot.pathfinder.setMovements(movements)
        bot.pathfinder.thinkTimeout = 3000
        bot.pathfinder.tickTimeout = 15
        this.save()
        this.log(a, `Joined ${this.settings.host} as ${bot.username}.`)
        this.move(a)
      })
      bot.on('death', () => {
        if (a.bot !== bot) return
        this.endManual(a.id, null, false)
        this.stopActions(a)
        a.movement++
        a.status = 'respawning'
        this.log(a, 'Died. Waiting for respawn.')
      })
      bot.on('packDeclined', () => this.log(a, 'Declined a resource pack.'))
      bot.on('messagestr', message => this.log(a, message))
      bot.on('kicked', reason => {
        if (a.bot !== bot) return
        a.error = typeof reason === 'string' ? reason : JSON.stringify(reason)
        this.log(a, `Kicked: ${a.error}`)
      })
      bot.on('error', error => {
        if (a.bot !== bot) return
        a.error = error.message
        this.log(a, error.message)
        bot.end()
        this.ended(a, bot)
      })
      bot.on('end', () => this.ended(a, bot))
    } catch (error) {
      a.error = error.message
      this.log(a, error.message)
      this.ended(a, a.bot)
    }
  }

  ended (a, bot) {
    if (a.bot !== bot) return
    this.endManual(a.id, null, false)
    this.stopActions(a)
    a.bot = null
    a.position = null
    a.code = null
    a.path = []
    a.movement++
    clearTimeout(a.walkTimer)
    if (a.desired && this.settings.reconnect && !this.closing) {
      const delay = Math.min(120000, 15000 * 2 ** Math.min(a.retry++, 3)) + Math.floor(Math.random() * 3000)
      a.status = 'reconnecting'
      a.timer = setTimeout(() => { a.timer = null; this.connect(a) }, delay)
      this.log(a, `Disconnected. Retrying in ${Math.ceil(delay / 1000)} seconds.`)
    } else {
      a.desired = false
      a.status = 'disconnected'
      this.publish()
    }
  }

  disconnect (id) {
    const a = this.get(id)
    this.endManual(id, null, false)
    this.stopActions(a)
    a.desired = false
    clearTimeout(a.timer)
    clearTimeout(a.walkTimer)
    a.timer = null
    a.movement++
    const bot = a.bot
    a.bot = null
    if (bot) { bot.pathfinder?.setGoal(null); bot.clearControlStates?.(); bot.end() }
    a.position = null
    a.path = []
    if (!a.authPending) { a.code = null; a.status = 'disconnected' }
    this.publish()
  }

  setRoute (ids, input) {
    const route = validateRoute(input)
    const accounts = ids.map(id => this.get(id))
    for (const a of accounts) {
      this.endManual(a.id, null, false)
      a.route = structuredClone(route)
      a.routeIndex = 0
      if (a.bot?.entity && a.status !== 'respawning') this.move(a)
    }
    this.save()
  }

  mapAccount (id) {
    const a = this.get(id)
    if (!a.bot?.world || !a.bot.entity || !['idle', 'walking', 'path blocked', 'manual'].includes(a.status)) throw Error('Join the server to view this account’s map.')
    return a
  }

  map (id, radius, layer) {
    if (![16, 24, 32].includes(radius) || !['surface', 'player'].includes(layer)) throw Error('Invalid map view.')
    const a = this.mapAccount(id)
    const spawn = a.bot.spawnPoint
    return { ...buildMap(a.bot, a.route, radius, layer), path: a.status === 'walking' ? a.path : [], spawn: spawn ? { x: spawn.x, y: spawn.y, z: spawn.z } : null }
  }

  walkOnMap (id, x, z, layer) {
    const a = this.mapAccount(id)
    if (!Number.isInteger(x) || !Number.isInteger(z) || !['surface', 'player'].includes(layer)) throw Error('Invalid map position.')
    if (Math.abs(x - Math.floor(a.bot.entity.position.x)) > 32 || Math.abs(z - Math.floor(a.bot.entity.position.z)) > 32) throw Error('Choose a position within the current map.')
    const tile = surface(a.bot, x, z, layer)
    if (!tile?.walkable) throw Error('Choose a loaded surface with space to stand.')
    this.setRoute([id], { mode: 'goto', points: [{ x, y: tile.y, z }] })
    return { x, y: tile.y, z }
  }

  move (a) {
    this.stopActions(a)
    const generation = ++a.movement
    clearTimeout(a.walkTimer)
    a.path = []
    const bot = a.bot
    bot.pathfinder.setGoal(null)
    bot.clearControlStates()
    if (a.route.mode === 'idle') { a.status = 'idle'; this.startActions(a); this.publish(); return }
    const step = async () => {
      if (a.bot !== bot || a.movement !== generation) return
      const point = a.route.points[a.routeIndex]
      if (a.status !== 'walking') {
        this.stopActions(a)
        bot.clearControlStates()
        a.status = 'walking'
        this.startActions(a)
      }
      this.publish()
      try {
        const goal = new goals.GoalBlock(point.x, point.y, point.z)
        await bot.pathfinder.goto(goal)
        if (a.bot !== bot || a.movement !== generation) return
        // goto also resolves for an empty failed path. Check actual arrival.
        const position = bot.entity.position
        if (!goal.isEnd({ x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) })) {
          throw Error('No walkable path to the goal.')
        }
        if (a.route.mode === 'goto') {
          a.status = 'idle'
          a.route = { mode: 'idle', points: [] }
          this.startActions(a)
          this.log(a, `Reached ${point.x}, ${point.y}, ${point.z}.`)
          this.save()
        } else {
          a.routeIndex = (a.routeIndex + 1) % a.route.points.length
          a.walkTimer = setTimeout(step, 300)
        }
      } catch (error) {
        if (a.bot !== bot || a.movement !== generation) return
        bot.pathfinder.setGoal(null)
        bot.clearControlStates()
        a.status = 'path blocked'
        this.startActions(a)
        const p = bot.entity.position
        const current = `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`
        const target = `${point.x} ${point.y} ${point.z}`
        this.log(a, `Cannot walk from ${current} to ${target}: ${error.message} Check feet-level Y and a walkable route. Retrying in 10 seconds.`)
        a.walkTimer = setTimeout(step, 10000)
      }
    }
    step()
  }

  beginManual (id, owner) {
    const a = this.mapAccount(id)
    if (a.manual && a.manual.owner !== owner) throw Error('This account is already controlled in another gameplay window.')
    if (a.manual) return
    this.stopActions(a)
    a.movement++
    clearTimeout(a.walkTimer)
    a.bot.pathfinder.setGoal(null)
    a.bot.clearControlStates()
    a.manual = { owner, timer: setTimeout(() => this.endManual(id, owner), 1500) }
    a.status = 'manual'
    this.publish()
  }

  manualAccount (id, owner) {
    const a = this.get(id)
    if (!a.bot?.entity || !a.manual || a.manual.owner !== owner) throw Error('Take control of this account first.')
    return a
  }

  manualInput (id, owner, input) {
    const controls = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']
    if (!input || !Array.isArray(input.keys) || input.keys.length > 7 || input.keys.some(key => !controls.includes(key))) throw Error('Invalid movement controls.')
    if (!Number.isFinite(input.yaw) || Math.abs(input.yaw) > Math.PI * 2 || !Number.isFinite(input.pitch) || Math.abs(input.pitch) > Math.PI / 2) throw Error('Invalid mouse rotation.')
    if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot > 8) throw Error('Invalid hotbar slot.')
    const a = this.manualAccount(id, owner)
    clearTimeout(a.manual.timer)
    a.manual.timer = setTimeout(() => this.endManual(id, owner), 1500)
    for (const control of controls) a.bot.setControlState(control, input.keys.includes(control))
    a.bot.setQuickBarSlot(input.slot)
    a.bot.look(input.yaw, input.pitch, true).catch(error => this.log(a, `Mouse look: ${error.message}`))
  }

  endManual (id, owner, resume = true) {
    const a = this.accounts.get(id)
    if (!a?.manual || (owner && a.manual.owner !== owner)) return
    clearTimeout(a.manual.timer)
    a.manual = null
    a.bot?.stopDigging?.()
    a.bot?.deactivateItem?.()
    a.bot?.clearControlStates?.()
    if (resume && a.bot?.entity && a.status === 'manual') this.move(a)
    this.publish()
  }

  setActions (ids, input) {
    const actions = validateActions(input)
    const accounts = ids.map(id => this.get(id))
    for (const a of accounts) {
      a.actions = structuredClone(actions)
      this.startActions(a)
    }
    this.save()
  }

  stopActions (a) {
    clearInterval(a.antiTimer)
    a.antiTimer = null
    for (const timer of Object.values(a.actionTimers)) clearTimeout(timer)
    a.actionTimers = {}
  }

  startActions (a) {
    this.stopActions(a)
    const bot = a.bot
    if (!bot?.entity || !['idle', 'walking', 'path blocked'].includes(a.status)) return
    bot.setQuickBarSlot(a.actions.slot - 1)
    if (a.status !== 'walking') {
      bot.setControlState('jump', false)
      bot.setControlState('sneak', a.actions.sneak)
      this.rotate(a, a.actions.yaw)
    }
    if (a.actions.antiAfk.enabled) {
      a.antiTimer = setInterval(() => {
        try { this.antiAfk(a) } catch (error) { this.log(a, `Anti-AFK: ${error.message}`) }
      }, a.actions.antiAfk.interval * 1000)
    }
  }

  rotate (a, yaw) {
    const radians = ((180 - yaw) * Math.PI / 180 + 2 * Math.PI) % (2 * Math.PI)
    a.bot.look(radians, -a.actions.pitch * Math.PI / 180, true).catch(error => {
      if (a.bot) this.log(a, `Rotation: ${error.message}`)
    })
  }

  pulse (a, control) {
    const bot = a.bot
    clearTimeout(a.actionTimers[control])
    bot.setControlState(control, control === 'sneak' ? !a.actions.sneak : true)
    a.actionTimers[control] = setTimeout(() => {
      delete a.actionTimers[control]
      if (a.bot !== bot || a.status === 'walking' || a.status === 'respawning') return
      bot.setControlState(control, control === 'sneak' ? a.actions.sneak : false)
    }, control === 'jump' ? 400 : 700)
  }

  action (ids, action) {
    if (!['jump', 'sneak', 'swing'].includes(action)) throw Error('Unknown player action.')
    const accounts = ids.map(id => this.get(id))
    for (const a of accounts) {
      if (!a.bot?.entity || !['idle', 'walking', 'path blocked'].includes(a.status)) throw Error('Join the server before using player actions.')
      if (action !== 'swing' && a.status === 'walking') throw Error('Stop walking before using jump or sneak actions.')
    }
    for (const a of accounts) {
      if (action === 'swing') a.bot.swingArm('right')
      else this.pulse(a, action)
    }
    this.publish()
  }

  antiAfk (a) {
    if (!a.bot?.entity || !['idle', 'walking', 'path blocked'].includes(a.status)) return
    const anti = a.actions.antiAfk
    if (!anti.enabled) return
    if (anti.swing) a.bot.swingArm('right')
    if (anti.hotbar) a.bot.setQuickBarSlot(((a.bot.quickBarSlot ?? 0) + 1) % 9)
    // Pathfinder owns jumping and looking while it follows a route.
    if (a.status !== 'walking') {
      if (anti.jump) this.pulse(a, 'jump')
      if (anti.sneak) this.pulse(a, 'sneak')
      if (anti.rotate) this.rotate(a, a.actions.yaw + (++a.antiStep % 2 ? 45 : -45))
    }
    this.publish()
  }

  remove (id) {
    const a = this.get(id)
    if (a.authPending || a.bot || a.desired) throw Error('Disconnect and finish any pending login before removing this account.')
    this.disconnect(id)
    this.accounts.delete(id)
    // Only internally generated UUID directories can be removed from tokens/.
    if (/^[0-9a-f-]{36}$/.test(id)) {
      const root = path.resolve(this.directory, 'tokens')
      const target = path.resolve(root, id)
      if (path.dirname(target) !== root) throw Error('Invalid token directory.')
      fs.rmSync(target, { recursive: true, force: true })
    }
    this.save()
  }

  refresh () {
    for (const a of this.accounts.values()) {
      const p = a.bot?.entity?.position
      a.position = p ? { x: Number(p.x.toFixed(1)), y: Number(p.y.toFixed(1)), z: Number(p.z.toFixed(1)) } : null
    }
    this.publish()
  }

  close () {
    this.closing = true
    for (const id of this.accounts.keys()) this.disconnect(id)
  }
}

module.exports = { Manager, validateSettings, validateRoute, validateActions, resourcePacks }
