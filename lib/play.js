const path = require('node:path')
const { Server } = require('socket.io')
const { Vec3 } = require('vec3')
const { GameView, itemInfo, formatted, renderVersion } = require('./gameview')
const { cursorBlock, cursorEntity } = require('./target')

const viewerRoot = path.dirname(require.resolve('prismarine-viewer'))
const assets = path.join(viewerRoot, 'public')
const entityModels = path.join(viewerRoot, 'viewer', 'lib', 'entity', 'entities.json')

// The page's own script and styles live under /js and /css, which are never cached.
// Everything here is static data from prismarine-viewer: the meshing worker, textures and models.
function playFile (pathname) {
  if (pathname === '/play/') return [path.join(__dirname, '../public/play.html'), 'text/html']
  if (pathname === '/play/mesher.js') return [path.join(__dirname, '../public/js/play/mesher.js'), 'text/javascript']
  if (pathname === '/play/entities.json') return [entityModels, 'application/json']
  const relative = pathname.slice('/play/'.length)
  if (!/^(worker\.js(\.LICENSE\.txt)?|(textures|blocksStates)\/[a-zA-Z0-9_.\/-]+\.(png|json))$/.test(relative) || relative.includes('..')) return null
  const file = path.resolve(assets, relative)
  if (!file.startsWith(assets + path.sep)) return null
  return [file, file.endsWith('.png') ? 'image/png' : file.endsWith('.json') ? 'application/json' : file.endsWith('.txt') ? 'text/plain' : 'text/javascript']
}

// Player skins come from Mojang's texture server, like in the game. Hashes are content addresses, so cache them.
const skins = new Map()
function skinFile (hash, download = fetch) {
  if (!/^[0-9a-f]{16,80}$/.test(hash)) return Promise.reject(Error('Invalid skin.'))
  if (skins.has(hash)) return skins.get(hash)
  const pending = (async () => {
    const response = await download(`https://textures.minecraft.net/texture/${hash}`, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw Error('Skin not found.')
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length > 65536 || data.length < 8 || data.readUInt32BE(0) !== 0x89504e47) throw Error('Invalid skin.')
    return data
  })()
  skins.set(hash, pending)
  pending.catch(() => skins.delete(hash))
  if (skins.size > 500) skins.delete(skins.keys().next().value)
  return pending
}

// Bots normally ask for two chunks to save memory. While a gameplay page is open, ask for the render distance.
const watchers = new WeakMap()
function setViewDistance (bot, distance) {
  try { if (bot.entity) bot.setSettings({ viewDistance: distance }) } catch {}
}
function widen (bot, radius) {
  const state = watchers.get(bot) || { count: 0, original: bot.settings?.viewDistance ?? 2 }
  state.count++
  watchers.set(bot, state)
  setViewDistance(bot, Math.max(radius, state.original))
}
function narrow (bot) {
  const state = watchers.get(bot)
  if (!state || --state.count > 0) return
  watchers.delete(bot)
  setViewDistance(bot, state.original)
}

// Armor points shown above the health bar, from the vanilla defense values.
const defense = { leather: [1, 3, 2, 1], chainmail: [2, 5, 4, 1], iron: [2, 6, 5, 2], golden: [2, 5, 3, 1], gold: [2, 5, 3, 1], diamond: [3, 8, 6, 3], netherite: [3, 8, 6, 3] }
const pieces = ['helmet', 'chestplate', 'leggings', 'boots']
function armorPoints (bot) {
  let points = 0
  for (const item of bot.inventory?.slots.slice(5, 9) || []) {
    const match = item && /^([a-z]+)_(helmet|chestplate|leggings|boots)$/.exec(item.name)
    if (match && defense[match[1]]) points += defense[match[1]][pieces.indexOf(match[2])]
  }
  return points
}

// Container screens the client knows how to lay out like the game.
function windowInfo (bot, window) {
  if (!window) return null
  const type = String(window.type)
  const kind = /crafting/.test(type) ? 'crafting' : /furnace|smoker|blast/.test(type) ? 'furnace' : /dispenser|dropper|3x3/.test(type) ? 'dispenser' : /hopper/.test(type) ? 'hopper' : 'chest'
  return { id: window.id, title: formatted(bot, window.title) || 'Container', kind, slots: window.inventoryStart ?? Math.max(0, window.slots.length - 36) }
}

// The scoreboard sidebar, highest score first, with team prefixes applied to each line.
function sidebar (bot) {
  const board = bot.scoreboard?.sidebar
  if (!board) return null
  let lines = []
  try { lines = board.items.slice(0, 15).map(item => ({ text: formatted(bot, item.displayName), score: item.value })) } catch {}
  return { title: formatted(bot, board.title), lines }
}

// The player list shown while Tab is held.
function tablist (bot) {
  const players = Object.values(bot.players).map(p => {
    const team = bot.teamMap?.[p.username]
    let name = p.username
    const display = p.displayName ? formatted(bot, p.displayName) : ''
    if (display && display.replace(/§./g, '') !== p.username) name = display
    else if (team) { try { name = team.displayName(p.username).toMotd() } catch {} }
    return { name, ping: p.ping ?? 0, skin: p.skinData?.url ? String(p.skinData.url).split('/').pop() : null, spectator: p.gamemode === 3, team: String(team?.team ?? ''), sort: p.username.toLowerCase() }
  })
  players.sort((a, b) => Number(a.spectator) - Number(b.spectator) || a.team.localeCompare(b.team) || a.sort.localeCompare(b.sort))
  return { header: formatted(bot, bot.tablist?.header), footer: formatted(bot, bot.tablist?.footer), heads: players.some(p => p.skin), players: players.slice(0, 80) }
}

function attachGameplay (server, manager, port) {
  const io = new Server(server, {
    path: '/play/socket.io', maxHttpBufferSize: 32768,
    allowRequest: (req, callback) => {
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
      callback(null, hosts.includes(req.headers.host) && (!req.headers.origin || hosts.some(host => req.headers.origin === `http://${host}`)))
    }
  })
  io.on('connection', socket => {
    let a
    try {
      const referer = new URL(socket.handshake.headers.referer || 'http://localhost')
      a = manager.mapAccount(socket.handshake.auth.account || referer.searchParams.get('id'))
      if (!renderVersion(a.bot)) throw Error(`The 3D renderer does not support Minecraft ${a.bot.version}.`)
    } catch (error) { socket.emit('fatal', error.message); socket.disconnect(true); return }
    const bot = a.bot
    const fail = error => socket.emit('playError', error.message)
    const onEnd = () => { socket.emit('fatal', 'Account disconnected. Rejoin, then reopen gameplay.'); socket.disconnect(true) }
    bot.once('end', onEnd)
    const listeners = []
    const on = (emitter, event, fn) => { emitter.on(event, fn); listeners.push([emitter, event, fn]) }

    // World: chunks, block changes and entities around the player.
    const radius = Math.max(2, Math.min(16, Number.parseInt(socket.handshake.auth.radius, 10) || 8))
    const view = new GameView(bot, socket, radius)
    widen(bot, radius)
    view.start()
    socket.on('viewDistance', distance => {
      if (!Number.isInteger(distance) || distance < 2 || distance > 16) return
      view.setRadius(distance)
      setViewDistance(bot, Math.max(distance, watchers.get(bot)?.original ?? 2))
    })
    let physicsTime = Date.now()
    const position = (teleport = false) => {
      const entity = bot.entity
      socket.emit('position', {
        pos: entity.position, velocity: entity.velocity,
        yaw: entity.yaw, pitch: entity.pitch, onGround: entity.onGround,
        inWater: entity.isInWater, inLava: entity.isInLava,
        sprinting: Boolean(bot.getControlState?.('sprint')),
        time: physicsTime, teleport
      })
    }
    on(bot, 'physicsTick', () => { physicsTime += 50; position() })
    on(bot, 'forcedMove', () => { physicsTime = Date.now(); position(true) })
    on(bot, 'move', () => { if (!bot.physicsEnabled) { physicsTime = Date.now(); position() } })
    position()

    // HUD: health, food, armor, air, experience, hotbar, inventory and open containers.
    const hud = () => {
      if (a.bot !== bot) { onEnd(); return }
      const window = bot.currentWindow || bot.inventory
      socket.emit('hud', {
        position: bot.entity.position,
        yaw: bot.entity.yaw,
        pitch: bot.entity.pitch,
        slot: bot.quickBarSlot || 0,
        health: bot.health,
        food: bot.food,
        armor: armorPoints(bot),
        air: bot.oxygenLevel ?? 20,
        xp: { level: bot.experience?.level ?? 0, progress: bot.experience?.progress ?? 0 },
        gameMode: bot.game?.gameMode || 'survival',
        version: bot.version,
        dimension: bot.game?.dimension || 'overworld',
        time: bot.time?.timeOfDay ?? 6000,
        raining: Boolean(bot.isRaining),
        usingItem: Boolean(bot.usingHeldItem),
        bossbars: (bot.bossBars || []).map(bar => ({ id: bar.entityUUID, title: formatted(bot, bar.title), health: bar.health, color: bar.color })),
        manual: a.manual?.owner === socket.id,
        inventory: window?.slots.map(item => itemInfo(bot, item)) || [],
        carried: itemInfo(bot, window?.selectedItem),
        window: windowInfo(bot, bot.currentWindow),
        hotbar: bot.inventory?.slots.slice(36, 45).map(item => itemInfo(bot, item)) || []
      })
    }
    const timer = setInterval(hud, 100)
    hud()

    // Chat, action bar and titles keep their colors as § codes.
    on(bot, 'message', (message, position) => {
      const text = formatted(bot, message)
      if (position === 'game_info') socket.emit('actionbar', text)
      else socket.emit('chat', text)
    })
    const title = packet => {
      const hasText = packet.text !== undefined && packet.text !== null
      const text = hasText ? formatted(bot, typeof packet.text === 'object' && packet.text.value !== undefined ? packet.text.value : packet.text) : ''
      if (packet.fadeIn !== undefined) socket.emit('title', { type: 'times', fadeIn: packet.fadeIn, stay: packet.stay, fadeOut: packet.fadeOut })
      else if (packet.action === 0) socket.emit('title', { type: 'title', text })
      else if (packet.action === 1) socket.emit('title', { type: 'subtitle', text })
      else if (packet.action === 2 && hasText) socket.emit('actionbar', text)
      else socket.emit('title', { type: 'clear' })
    }
    on(bot._client, 'title', title)
    on(bot._client, 'set_title_text', packet => socket.emit('title', { type: 'title', text: formatted(bot, packet.text) }))
    on(bot._client, 'set_title_subtitle', packet => socket.emit('title', { type: 'subtitle', text: formatted(bot, packet.text) }))
    on(bot._client, 'set_title_time', packet => socket.emit('title', { type: 'times', fadeIn: packet.fadeIn, stay: packet.stay, fadeOut: packet.fadeOut }))
    on(bot._client, 'clear_titles', () => socket.emit('title', { type: 'clear' }))

    // Scoreboard sidebar, resent whenever scores, the objective or teams change.
    let sidebarTimer = null
    const sendSidebar = () => {
      if (sidebarTimer) return
      sidebarTimer = setTimeout(() => { sidebarTimer = null; socket.emit('sidebar', sidebar(bot)) }, 100)
    }
    for (const event of ['scoreboardCreated', 'scoreboardDeleted', 'scoreboardTitleChanged', 'scoreUpdated', 'scoreRemoved', 'scoreboardPosition', 'teamCreated', 'teamUpdated', 'teamMemberAdded', 'teamMemberRemoved', 'teamRemoved']) on(bot, event, sendSidebar)
    socket.emit('sidebar', sidebar(bot))
    socket.on('tablist', callback => { if (typeof callback === 'function') callback(tablist(bot)) })

    // Manual control.
    socket.on('takeControl', callback => {
      try { manager.beginManual(a.id, socket.id); callback?.({ ok: true }) } catch (error) { callback?.({ error: error.message }) }
    })
    socket.on('releaseControl', () => manager.endManual(a.id, socket.id))
    socket.on('input', input => {
      try {
        manager.manualInput(a.id, socket.id, input)
        if (bot.targetDigBlock) {
          const block = cursorBlock(bot)
          if (!block || !block.position.equals(bot.targetDigBlock.position)) bot.stopDigging()
        }
      } catch (error) { fail(error) }
    })
    // Read named packets directly: Mineflayer rewrites dots in legacy sound names.
    on(bot._client, 'named_sound_effect', packet => socket.emit('sound', { name: packet.soundName, position: { x: packet.x / 8, y: packet.y / 8, z: packet.z / 8 }, volume: packet.volume, pitch: Number(bot.version.split('.')[1]) <= 8 ? packet.pitch / 63 : packet.pitch }))
    on(bot._client, 'sound_effect', packet => {
      const name = packet.sound?.data?.soundName || bot.registry.sounds?.[packet.sound?.soundId ?? packet.soundId]?.name
      if (name) socket.emit('sound', { name, position: { x: packet.x / 8, y: packet.y / 8, z: packet.z / 8 }, volume: packet.volume, pitch: packet.pitch })
    })
    for (const event of ['diggingCompleted', 'diggingAborted']) on(bot, event, () => socket.emit('dig', null))
    let clicking = false
    socket.on('interact', async action => {
      if (action === 'stop') { if (a.manual?.owner === socket.id) bot.stopDigging(); return }
      if (!['left', 'right'].includes(action) || clicking) return
      try {
        manager.manualAccount(a.id, socket.id)
        if (bot.usingHeldItem && action === 'right') return
        clicking = true
        if (bot.game?.gameMode === 'spectator') return
        const block = cursorBlock(bot)
        if (action === 'left') {
          const entity = cursorEntity(bot)
          if (entity) bot.attack(entity)
          else if (block && bot.canDigBlock(block) && bot.game?.gameMode !== 'adventure' && bot.game?.gameMode !== 'spectator') {
            socket.emit('dig', { position: block.position, duration: bot.digTime(block) })
            try { await bot.dig(block, 'ignore') } finally { socket.emit('dig', null) }
          }
          else bot.swingArm('right')
        } else if (block && !bot.getControlState('sneak') && /chest|barrel|furnace|crafting_table|door|button|lever|trapdoor|gate|hopper|dispenser|dropper|shulker|smoker|brewing|enchanting|anvil|beacon|loom|stonecutter|grindstone|smithing|cartography/.test(block.name)) {
          await bot.activateBlock(block)
        } else if (block && bot.heldItem && bot.registry.blocksByName[bot.heldItem.name]) {
          const faces = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
          await bot.placeBlock(block, faces[block.face] || new Vec3(0, 1, 0))
        } else {
          const entity = cursorEntity(bot)
          if (entity) await bot.activateEntity(entity)
          else bot.activateItem()
        }
      } catch (error) { if (!/digging aborted/i.test(error.message)) fail(error) } finally { clicking = false }
    })
    socket.on('stopUse', () => { if (a.manual?.owner === socket.id) bot.deactivateItem() })
    // Clicks follow the game's window_click modes: 0 pick/place, 1 shift, 2 number key swap, 4 drop. Slot -999 is outside the window.
    socket.on('inventoryClick', async input => {
      try {
        manager.manualAccount(a.id, socket.id)
        const window = bot.currentWindow || bot.inventory
        const slotOk = input && Number.isInteger(input.slot) && (input.slot === -999 || (input.slot >= 0 && input.slot < window.slots.length))
        const modeOk = input && (([0, 1].includes(input.mode) && [0, 1].includes(input.button)) || (input.mode === 2 && Number.isInteger(input.button) && input.button >= 0 && input.button <= 8) || (input.mode === 4 && [0, 1].includes(input.button)))
        if (!slotOk || !modeOk || (input.slot === -999 && input.mode !== 0)) throw Error('Invalid inventory click.')
        await bot.clickWindow(input.slot, input.button, input.mode)
      } catch (error) { fail(error) }
    })
    socket.on('drop', async all => {
      try {
        manager.manualAccount(a.id, socket.id)
        const item = bot.heldItem
        if (!item) return
        if (all) await bot.tossStack(item)
        else await bot.toss(item.type, item.metadata, 1)
      } catch (error) { fail(error) }
    })
    socket.on('closeInventory', () => { if (a.manual?.owner === socket.id && bot.currentWindow) bot.closeWindow(bot.currentWindow) })
    socket.on('chat', message => {
      try {
        manager.manualAccount(a.id, socket.id)
        if (typeof message !== 'string' || !message.trim() || message.length > 256 || /[\r\n]/.test(message)) throw Error('Chat messages need 1 to 256 characters.')
        bot.chat(message)
      } catch (error) { fail(error) }
    })
    socket.on('disconnect', () => {
      clearInterval(timer)
      clearTimeout(sidebarTimer)
      manager.endManual(a.id, socket.id)
      view.stop()
      narrow(bot)
      for (const [emitter, event, fn] of listeners) emitter.off(event, fn)
      bot.off('end', onEnd)
    })
  })
  return io
}

module.exports = { attachGameplay, playFile, skinFile, sidebar, tablist, windowInfo }
