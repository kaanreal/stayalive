const path = require('node:path')
const { Server } = require('socket.io')
const { Vec3 } = require('vec3')
const { GameView, itemIcon, renderVersion } = require('./gameview')

const viewerRoot = path.dirname(require.resolve('prismarine-viewer'))
const assets = path.join(viewerRoot, 'public')
const entityModels = path.join(viewerRoot, 'viewer', 'lib', 'entity', 'entities.json')

// The page's own script and styles live under /js and /css, which are never cached.
// Everything here is static data from prismarine-viewer: the meshing worker, textures and models.
function playFile (pathname) {
  if (pathname === '/play/') return [path.join(__dirname, '../public/play.html'), 'text/html']
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

const itemData = (bot, item) => item ? { name: item.displayName || item.name, count: item.count, icon: itemIcon(bot, item) } : null

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
    let lastPosition = 0
    const position = () => {
      if (Date.now() - lastPosition < 30) return
      lastPosition = Date.now()
      socket.volatile.emit('position', { pos: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch })
    }
    bot.on('move', position)
    position()

    // HUD and manual control.
    const hud = () => {
      if (a.bot !== bot) { onEnd(); return }
      const window = bot.currentWindow || bot.inventory
      const items = window?.slots.map(item => itemData(bot, item)) || []
      socket.emit('hud', { position: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch, slot: bot.quickBarSlot || 0, health: bot.health, food: bot.food, manual: a.manual?.owner === socket.id, inventory: items, carried: itemData(bot, window?.selectedItem), window: bot.currentWindow ? { id: bot.currentWindow.id, title: String(bot.currentWindow.title || 'Container') } : null, hotbar: bot.inventory?.slots.slice(36, 45).map(item => itemData(bot, item)) || [] })
    }
    const timer = setInterval(hud, 100)
    hud()
    socket.on('takeControl', callback => {
      try { manager.beginManual(a.id, socket.id); callback?.({ ok: true }) } catch (error) { callback?.({ error: error.message }) }
    })
    socket.on('releaseControl', () => manager.endManual(a.id, socket.id))
    socket.on('input', input => { try { manager.manualInput(a.id, socket.id, input) } catch (error) { fail(error) } })
    let clicking = false
    socket.on('interact', async action => {
      if (action === 'stop') { if (a.manual?.owner === socket.id) bot.stopDigging(); return }
      if (!['left', 'right'].includes(action) || clicking) return
      try {
        manager.manualAccount(a.id, socket.id)
        clicking = true
        const { yaw, pitch, position, eyeHeight } = bot.entity
        // Mineflayer's cursor helper rejects an exactly zero yaw or pitch.
        const direction = new Vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
        const block = bot.world.raycast(position.offset(0, eyeHeight, 0), direction, 5)
        if (action === 'left') {
          const entity = bot.entityAtCursor(3)
          if (entity) bot.attack(entity)
          else if (block && bot.canDigBlock(block)) await bot.dig(block, 'ignore')
          else bot.swingArm('right')
        } else if (block && /chest|barrel|furnace|crafting_table|door|button|lever|trapdoor|gate/.test(block.name)) {
          await bot.activateBlock(block)
        } else if (block && bot.heldItem && bot.registry.blocksByName[bot.heldItem.name]) {
          const faces = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
          await bot.placeBlock(block, faces[block.face] || new Vec3(0, 1, 0))
        } else bot.activateItem()
      } catch (error) { if (error.message !== 'Digging aborted') fail(error) } finally { clicking = false }
    })
    socket.on('stopUse', () => { if (a.manual?.owner === socket.id) bot.deactivateItem() })
    socket.on('inventoryClick', async input => {
      try {
        manager.manualAccount(a.id, socket.id)
        const window = bot.currentWindow || bot.inventory
        if (!input || !Number.isInteger(input.slot) || input.slot < 0 || input.slot >= window.slots.length || ![0, 1].includes(input.button) || ![0, 1].includes(input.mode)) throw Error('Invalid inventory click.')
        await bot.clickWindow(input.slot, input.button, input.mode)
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
    const chat = message => socket.emit('chat', message)
    bot.on('messagestr', chat)
    socket.on('disconnect', () => {
      clearInterval(timer)
      manager.endManual(a.id, socket.id)
      view.stop()
      narrow(bot)
      bot.off('move', position)
      bot.off('messagestr', chat)
      bot.off('end', onEnd)
    })
  })
  return io
}

module.exports = { attachGameplay, playFile, skinFile }
