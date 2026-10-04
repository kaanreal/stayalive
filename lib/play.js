const path = require('node:path')
const { Server } = require('socket.io')
const { WorldView } = require('prismarine-viewer/viewer/lib/worldView')
const { getVersion } = require('prismarine-viewer/viewer/lib/version')
const { Vec3 } = require('vec3')

const assets = path.join(path.dirname(require.resolve('prismarine-viewer')), 'public')

function playFile (pathname) {
  if (pathname === '/play/') return [path.join(__dirname, '../public/play.html'), 'text/html']
  if (pathname === '/play/controls.js') return [path.join(__dirname, '../public/controls.js'), 'text/javascript']
  if (pathname === '/play/play.css') return [path.join(__dirname, '../public/play.css'), 'text/css']
  const relative = pathname.slice('/play/'.length)
  if (!/^(index\.js(\.LICENSE\.txt)?|worker\.js(\.LICENSE\.txt)?|(textures|blocksStates)\/[a-zA-Z0-9_.\/-]+\.(png|json))$/.test(relative) || relative.includes('..')) return null
  const file = path.resolve(assets, relative)
  if (!file.startsWith(assets + path.sep)) return null
  return [file, file.endsWith('.png') ? 'image/png' : file.endsWith('.json') ? 'application/json' : file.endsWith('.txt') ? 'text/plain' : 'text/javascript']
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
      const id = socket.handshake.auth.account || referer.searchParams.get('id')
      a = manager.mapAccount(id)
      if (!getVersion(a.bot.version)) throw Error(`The 3D renderer does not support Minecraft ${a.bot.version}.`)
    } catch (error) { socket.emit('fatal', error.message); socket.disconnect(true); return }
    const bot = a.bot
    const fail = error => socket.emit('playError', error.message)
    const onEnd = () => { socket.emit('fatal', 'Account disconnected. Rejoin, then reopen gameplay.'); socket.disconnect(true) }
    bot.once('end', onEnd)
    if (socket.handshake.auth.role === 'control') {
      const hud = () => {
        if (a.bot !== bot) { onEnd(); return }
        const window = bot.currentWindow || bot.inventory
        const items = window?.slots.map(item => item ? { name: item.displayName || item.name, count: item.count } : null) || []
        const carried = window?.selectedItem
        socket.emit('hud', { position: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch, slot: bot.quickBarSlot || 0, health: bot.health, food: bot.food, manual: a.manual?.owner === socket.id, inventory: items, carried: carried ? { name: carried.displayName || carried.name, count: carried.count } : null, window: bot.currentWindow ? { id: bot.currentWindow.id, title: String(bot.currentWindow.title || 'Container') } : null, hotbar: bot.inventory?.slots.slice(36, 45).map(item => item ? { name: item.displayName || item.name, count: item.count } : null) || [] })
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
      socket.on('disconnect', () => { clearInterval(timer); manager.endManual(a.id, socket.id); bot.off('messagestr', chat); bot.off('end', onEnd) })
    } else {
      socket.emit('version', bot.version)
      const view = new WorldView(bot.world, 3, bot.entity.position, socket)
      let lastPosition = 0
      const position = () => {
        if (Date.now() - lastPosition < 40) return
        lastPosition = Date.now()
        socket.emit('position', { pos: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch })
        view.updatePosition(bot.entity.position).catch(fail)
      }
      view.listenToBot(bot)
      view.init(bot.entity.position).catch(fail)
      position()
      bot.on('move', position)
      socket.on('disconnect', () => { view.removeListenersFromBot(bot); bot.off('move', position); bot.off('end', onEnd) })
    }
  })
  return io
}

module.exports = { attachGameplay, playFile }
