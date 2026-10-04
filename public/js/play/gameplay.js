// Gameplay page (public/play.html): 3D view, HUD, manual control and inventory for one account.
// Socket messages match lib/play.js. World: world, chunk, unloadChunk, block, entity, move, position.
// Control: takeControl, releaseControl, input, interact, stopUse, inventoryClick, closeInventory, chat, viewDistance.
import { paintHead } from '/js/ui/head-art.js'
import { GameRenderer } from './renderer.js'
import { inventoryLayout } from './mechanics.js'
import { minecraftText, survivalHud, sidebar, playerList, serverTitle } from './hud.js'
import { GameSounds } from './sounds.js'
import { ItemIcons } from './item-icons.js'

const accountId = new URLSearchParams(location.search).get('id')
const embedded = window.parent !== window
const storedDistance = (() => { try { return Number(localStorage.getItem('stayalive.renderDistance')) || 8 } catch { return 8 } })()
const controlSocket = io({ path: '/play/socket.io', auth: { role: 'control', account: accountId, radius: storedDistance } })
const gameElement = id => document.getElementById(id)
const view = new GameRenderer()
const itemIcons = new ItemIcons(view.hand)
const sounds = new GameSounds(gameMessage)
view.createInventoryPreview(gameElement('inventory-avatar'))
const viewerCanvas = () => view.canvas
const heldKeys = new Set()
const bindings = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump', ControlLeft: 'sprint', ControlRight: 'sprint', ShiftLeft: 'sneak', ShiftRight: 'sneak' }
let hud = null
let controlling = false
let acquiring = false
let yaw = 0
let pitch = 0
let slot = 0
let leftHeld = false
let rightHeld = false
let inventoryKey = ''
let lastWindow = null
let fatal = false
let account = null
let messageTimer
let chunks = 0
let sensitivity = 0.0025
let lastForward = 0
let sprinting = false
let hoveredSlot = null
let tabHeld = false
let actionTimer
let panelMouse = false
let sentYaw = null
let sentPitch = null

// While you control the player, the camera follows your mouse directly instead of waiting for the server.
view.look = () => controlling ? { yaw, pitch } : null
view.beforeFrame = () => { if (controlling && (yaw !== sentYaw || pitch !== sentPitch)) sendInput() }

function gameMessage (message) {
  const element = gameElement('game-message')
  element.textContent = message
  element.classList.toggle('is-visible', Boolean(message))
  clearTimeout(messageTimer)
  if (message) messageTimer = setTimeout(() => element.classList.remove('is-visible'), 7000)
}
function sendInput (reliable = false) {
  if (!controlling || !controlSocket.connected) return
  const keys = [...new Set([...heldKeys].map(key => bindings[key]).filter(Boolean))]
  const canSprint = keys.includes('forward') && !keys.includes('sneak') && !hud?.usingItem && (hud?.food > 6 || hud?.gameMode === 'creative')
  if (!canSprint) { sprinting = false; const index = keys.indexOf('sprint'); if (index >= 0) keys.splice(index, 1) }
  else if (keys.includes('sprint')) sprinting = true
  if (sprinting && !keys.includes('sprint')) keys.push('sprint')
  ;(reliable ? controlSocket : controlSocket.volatile).emit('input', { keys, yaw, pitch, slot })
  sentYaw = yaw; sentPitch = pitch
  view.sprinting = canSprint && sprinting
  const minor = Number((hud?.version || account?.version || '1.16').split('.')[1])
  view.eyeHeight = keys.includes('sneak') ? (minor < 14 ? 1.54 : 1.27) : 1.62
}
function setMode () {
  gameElement('hud-mode').textContent = controlling ? 'Controlling' : 'Watching'
  document.body.classList.toggle('is-controlling', controlling)
}
function releaseControl () {
  panelMouse = false
  sounds.stop()
  view.setDig(null)
  heldKeys.clear()
  leftHeld = false
  view.hand.mining = false
  rightHeld = false
  sprinting = false
  view.sprinting = false
  view.eyeHeight = 1.62
  tabHeld = false
  gameElement('player-list').hidden = true
  controlSocket.emit('interact', 'stop')
  controlSocket.emit('stopUse')
  controlSocket.emit('releaseControl')
  controlling = false
  acquiring = false
  gameElement('game-overlay').hidden = false
  gameElement('take-control').disabled = fatal || !hud || !controlSocket.connected
  document.exitPointerLock?.()
  gameElement('inventory-panel').hidden = true
  gameElement('chat-form').hidden = true
  document.body.classList.remove('panel-open', 'chat-open')
  gameElement('carried-item').hidden = true
  gameElement('item-tooltip').hidden = true
  setMode()
}
function unlockForPanel () {
  heldKeys.clear()
  sprinting = false
  leftHeld = false
  view.hand.mining = false
  rightHeld = false
  sendInput()
  controlSocket.emit('interact', 'stop')
  controlSocket.emit('stopUse')
  document.body.classList.add('panel-open')
  panelMouse = true
  document.exitPointerLock?.()
}
async function captureMouse () {
  const canvas = viewerCanvas()
  if (!canvas) { gameMessage('The renderer is still loading.'); return }
  try { await canvas.requestPointerLock() } catch (error) { releaseControl(); gameMessage(`Mouse capture failed: ${error.message}`) }
}
gameElement('take-control').addEventListener('click', async () => {
  if (!hud || acquiring) return
  acquiring = true
  yaw = hud.yaw; pitch = hud.pitch; slot = hud.slot
  const [result] = await Promise.all([new Promise(resolve => controlSocket.emit('takeControl', resolve)), captureMouse()])
  acquiring = false
  if (result.error) { releaseControl(); gameMessage(result.error); return }
  if (!document.pointerLockElement) { releaseControl(); return }
  controlling = true
  if (hud.version) sounds.start(hud.version).catch(error => gameMessage(error.message))
  gameElement('game-overlay').hidden = true
  gameMessage('')
  setMode()
  sendInput()
})

// Leaving: tell the client when embedded, otherwise close this window.
gameElement('back').addEventListener('click', () => {
  releaseControl()
  if (embedded) window.parent.postMessage({ type: 'stayalive:exit' }, location.origin)
  else { window.close(); setTimeout(() => { location.href = '/' }, 200) }
})
gameElement('pop-out').hidden = !embedded
gameElement('pop-out').addEventListener('click', () => {
  releaseControl()
  window.open(location.href, '_blank', 'noopener')
  window.parent.postMessage({ type: 'stayalive:exit' }, location.origin)
})

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) panelMouse = false
  else if (!panelMouse && !document.body.classList.contains('panel-open') && !acquiring) releaseControl()
})
document.addEventListener('mousemove', event => {
  if (document.body.classList.contains('panel-open')) {
    for (const id of ['carried-item', 'item-tooltip']) {
      const element = gameElement(id)
      element.style.left = Math.min(event.clientX + 12, innerWidth - element.offsetWidth - 8) + 'px'
      element.style.top = Math.min(event.clientY - 12, innerHeight - element.offsetHeight - 8) + 'px'
    }
  }
  if (!controlling || !document.pointerLockElement) return
  yaw = ((yaw - event.movementX * sensitivity) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
  pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch - event.movementY * sensitivity))
})
document.addEventListener('keydown', event => {
  if (!controlling) return
  if (event.code === 'Escape') {
    event.preventDefault()
    if (!gameElement('inventory-panel').hidden) closeInventory(event)
    else if (!gameElement('chat-form').hidden) closeChat(event)
    else releaseControl()
    return
  }
  if (event.target.tagName === 'INPUT') return
  if (event.code === 'F1' && !event.repeat) { event.preventDefault(); document.body.classList.toggle('hide-hud'); return }
  if (event.code === 'F3' && !event.repeat) { event.preventDefault(); document.body.classList.toggle('debug'); return }
  if (event.code === 'Tab') { event.preventDefault(); tabHeld = true; gameElement('player-list').hidden = false; controlSocket.emit('tablist', playerList); return }
  if (!gameElement('inventory-panel').hidden && hoveredSlot !== null) {
    if (/^Digit[1-9]$/.test(event.code)) { event.preventDefault(); controlSocket.emit('inventoryClick', { slot: hoveredSlot, button: Number(event.code.slice(-1)) - 1, mode: 2 }); return }
    if (event.code === 'KeyQ' && !event.repeat) { event.preventDefault(); controlSocket.emit('inventoryClick', { slot: hoveredSlot, button: event.ctrlKey ? 1 : 0, mode: 4 }); return }
  }
  if (event.code === 'KeyE' && !event.repeat) {
    event.preventDefault()
    if (!gameElement('inventory-panel').hidden) closeInventory()
    else { gameElement('inventory-panel').hidden = false; unlockForPanel(); drawInventory() }
    return
  }
  if ((event.code === 'KeyT' || event.code === 'Slash') && !event.repeat && gameElement('inventory-panel').hidden) {
    event.preventDefault()
    gameElement('chat-form').hidden = false
    document.body.classList.add('chat-open')
    unlockForPanel()
    gameElement('chat-input').focus()
    gameElement('chat-input').value = event.code === 'Slash' ? '/' : ''
    return
  }
  if (document.body.classList.contains('panel-open')) return
  if (['KeyF', 'F5'].includes(event.code) && !event.repeat) { event.preventDefault(); view.perspective = (view.perspective + 1) % 3; return }
  if (event.code === 'KeyQ' && !event.repeat) { event.preventDefault(); controlSocket.emit('drop', event.ctrlKey); return }
  if (event.code === 'KeyW' && !event.repeat) { const now = performance.now(); if (now - lastForward < 350) sprinting = true; lastForward = now }
  if (bindings[event.code]) { event.preventDefault(); heldKeys.add(event.code); sendInput(true) }
  if (/^Digit[1-9]$/.test(event.code)) { slot = Number(event.code.slice(-1)) - 1; sendInput(true); drawHotbar(true) }
})
document.addEventListener('keyup', event => {
  heldKeys.delete(event.code)
  if (event.code === 'KeyW') sprinting = false
  if (event.code === 'Tab') { tabHeld = false; gameElement('player-list').hidden = true }
  if (controlling) sendInput(true)
})
document.addEventListener('wheel', event => {
  if (!controlling || !document.pointerLockElement) return
  event.preventDefault(); slot = (slot + (event.deltaY > 0 ? 1 : 8)) % 9; sendInput(); drawHotbar(true)
}, { passive: false })
document.addEventListener('contextmenu', event => event.preventDefault())
document.addEventListener('mousedown', event => {
  if (controlling && !document.pointerLockElement && !document.body.classList.contains('panel-open') && event.target === viewerCanvas()) {
    captureMouse()
    gameMessage('')
    return
  }
  if (!controlling || !document.pointerLockElement || event.target !== viewerCanvas()) return
  if (![0, 2].includes(event.button)) return
  sendInput()
  view.hand.swing()
  if (event.button === 0) { leftHeld = true; view.hand.mining = true }
  if (event.button === 2) rightHeld = true
  controlSocket.emit('interact', event.button === 2 ? 'right' : 'left')
})
document.addEventListener('mouseup', event => {
  if (!controlling) return
  if (event.button === 0) { leftHeld = false; view.hand.mining = false; controlSocket.emit('interact', 'stop') }
  if (event.button === 2) { rightHeld = false; controlSocket.emit('stopUse') }
})
window.addEventListener('blur', releaseControl)
window.addEventListener('pagehide', releaseControl)
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseControl() })
setInterval(sendInput, 50)
setInterval(() => { if (controlling && leftHeld && document.pointerLockElement) controlSocket.emit('interact', 'left') }, 180)
setInterval(() => { if (controlling && rightHeld && !hud?.usingItem && document.pointerLockElement) controlSocket.emit('interact', 'right') }, 200)

// Item tiles: the item's own texture, or its initials when the renderer has no icon for it.
function itemTile (item) {
  const tile = document.createElement('span')
  tile.className = 'item'
  if (item.enchanted) tile.classList.add('enchanted')
  const initials = () => {
    let h = 0
    for (const c of item.name) h = (h * 31 + c.charCodeAt(0)) >>> 0
    tile.classList.add('item--text')
    tile.style.setProperty('--item-hue', h % 360)
    const label = document.createElement('b')
    label.textContent = item.name.split(/[\s_]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    tile.prepend(label)
  }
  if (item.icon) {
    const icon = document.createElement('img')
    icon.alt = ''
    icon.src = '/play/' + item.icon
    tile.style.setProperty('--item-mask', `url("${icon.src}")`)
    if (item.block) itemIcons.block(item).then(src => { icon.src = src; tile.style.setProperty('--item-mask', `url("${src}")`) }).catch(error => console.error('Item icon:', error))
    icon.onerror = () => { icon.remove(); initials() }
    tile.append(icon)
  } else initials()
  if (item.durability !== null && item.durability !== undefined) {
    const bar = document.createElement('span')
    bar.className = 'item-durability'
    const fill = document.createElement('i')
    fill.style.width = `${Math.max(0, Math.min(1, item.durability)) * 100}%`
    fill.style.background = `hsl(${item.durability * 120} 100% 50%)`
    bar.append(fill)
    tile.append(bar)
  }
  if (item.count > 1) { const count = document.createElement('em'); count.textContent = item.count; tile.append(count) }
  return tile
}

let itemNameTimer
let hotbarKey = ''
function drawHotbar (changed) {
  view.hand.setItem(hud?.hotbar[slot])
  const bar = gameElement('hotbar')
  const key = JSON.stringify([slot, hud?.hotbar])
  if (key !== hotbarKey) {
    hotbarKey = key
    bar.replaceChildren()
    for (let i = 0; i < 9; i++) {
      const item = hud?.hotbar[i]
      const cell = document.createElement('div')
      cell.className = 'hotbar-slot' + (i === slot ? ' active' : '')
      if (item) { cell.append(itemTile(item)); cell.title = item.name }
      bar.append(cell)
    }
  }
  if (changed) {
    const name = gameElement('item-name')
    minecraftText(name, hud?.hotbar[slot]?.name || '')
    name.classList.add('is-visible')
    clearTimeout(itemNameTimer)
    itemNameTimer = setTimeout(() => name.classList.remove('is-visible'), 1800)
  }
}

function drawInventory () {
  if (!hud || gameElement('inventory-panel').hidden) return
  const carried = gameElement('carried-item')
  carried.replaceChildren()
  carried.hidden = !hud.carried
  if (hud.carried) carried.append(itemTile(hud.carried))
  gameElement('inventory-carried').textContent = hud.carried ? `Holding ${hud.carried.name} ×${hud.carried.count}` : 'Holding nothing'
  const key = JSON.stringify([hud.inventory, hud.window])
  if (key === inventoryKey) return
  inventoryKey = key
  minecraftText(gameElement('inventory-title'), hud.window ? hud.window.title : 'Crafting')
  const container = gameElement('inventory-slots')
  container.replaceChildren()
  hoveredSlot = null
  gameElement('item-tooltip').hidden = true
  const layout = inventoryLayout(hud.inventory.length, hud.window)
  const panel = gameElement('inventory-panel')
  panel.dataset.kind = hud.window?.kind || 'inventory'
  panel.style.width = layout.width * 2 + 'px'
  panel.style.height = layout.height * 2 + 'px'
  panel.style.backgroundImage = `url('/play/textures/1.16.4/gui/container/${layout.texture}.png')`
  if (layout.texture === 'generic_54') {
    // Chest textures contain six rows. Stitch the bottom half after the actual rows.
    panel.style.backgroundImage = 'none'
    for (const [top, height, offset] of [[0, layout.inventoryY - 13, 0], [layout.inventoryY - 13, 96, 126]]) {
      const background = document.createElement('div')
      background.className = 'inventory-background'
      background.style.top = top * 2 + 'px'
      background.style.height = height * 2 + 'px'
      background.style.backgroundPositionY = -offset * 2 + 'px'
      container.append(background)
    }
  }
  for (const { slot: index, x, y } of layout.slots) {
      const item = hud.inventory[index]
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'inventory-slot'
      button.style.left = x * 2 + 'px'
      button.style.top = y * 2 + 'px'
      button.title = item ? `${item.name} ×${item.count}` : ''
      button.setAttribute('aria-label', `Slot ${index}: ${item ? `${item.name} ×${item.count}` : 'empty'}`)
      if (item) button.append(itemTile(item))
      button.addEventListener('click', event => controlSocket.emit('inventoryClick', { slot: index, button: 0, mode: event.shiftKey ? 1 : 0 }))
      button.addEventListener('contextmenu', event => { event.preventDefault(); controlSocket.emit('inventoryClick', { slot: index, button: 1, mode: event.shiftKey ? 1 : 0 }) })
      button.addEventListener('mouseenter', () => {
        hoveredSlot = index
        const tooltip = gameElement('item-tooltip')
        tooltip.hidden = !item || Boolean(hud.carried)
        minecraftText(tooltip, [item?.name, ...(item?.lore || [])].filter(Boolean).join('\n'))
      })
      button.addEventListener('mouseleave', () => { hoveredSlot = null; gameElement('item-tooltip').hidden = true })
      container.append(button)
  }
}
function closeInventory (event) {
  controlSocket.emit('closeInventory')
  gameElement('inventory-panel').hidden = true
  gameElement('carried-item').hidden = true
  gameElement('item-tooltip').hidden = true
  document.body.classList.remove('panel-open')
  resumeMouse(event)
}
gameElement('close-inventory').addEventListener('click', closeInventory)
document.addEventListener('mousedown', event => {
  if (!controlling || gameElement('inventory-panel').hidden || event.target.closest('#inventory-panel') || ![0, 2].includes(event.button)) return
  controlSocket.emit('inventoryClick', { slot: -999, button: event.button === 2 ? 1 : 0, mode: 0 })
})

function resumeMouse (event) {
  // Browsers block pointer lock immediately after Escape until another gesture.
  if (event?.code === 'Escape') gameMessage('Click to return to the game.')
  else captureMouse()
}
function closeChat (event) {
  gameElement('chat-form').hidden = true
  document.body.classList.remove('panel-open', 'chat-open')
  resumeMouse(event)
}
gameElement('chat-form').addEventListener('submit', event => {
  event.preventDefault()
  controlSocket.emit('chat', gameElement('chat-input').value)
  gameElement('chat-input').value = ''
  closeChat()
})

const facings = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
function drawHud () {
  if (!hud) return
  const p = hud.position
  const degrees = ((180 - hud.yaw * 180 / Math.PI) % 360 + 360) % 360
  gameElement('hud-xyz').textContent = `XYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)} · ${facings[Math.round(degrees / 45) % 8]}`
  survivalHud(hud)
  const bosses = gameElement('bossbars')
  bosses.replaceChildren()
  for (const bar of hud.bossbars || []) {
    const row = document.createElement('div')
    const label = document.createElement('span')
    minecraftText(label, bar.title)
    const track = document.createElement('div')
    const fill = document.createElement('i')
    fill.style.width = Math.max(0, Math.min(1, bar.health)) * 100 + '%'
    fill.style.backgroundColor = { pink: '#ff55ff', blue: '#5555ff', red: '#ff5555', green: '#55ff55', yellow: '#ffff55', purple: '#aa00aa', white: '#fff' }[bar.color] || '#ff55ff'
    track.append(fill)
    row.append(label, track)
    bosses.append(row)
  }
  view.setEnvironment(hud)
}

// Account name, server and ping come from the client state; FPS from this page.
let frames = 0
let fps = 0
const countFrame = () => { frames++; requestAnimationFrame(countFrame) }
requestAnimationFrame(countFrame)
setInterval(() => { fps = frames; frames = 0; drawServer() }, 1000)
function drawServer () {
  const ping = account?.ping
  const level = ping == null ? 0 : ping < 80 ? 5 : ping < 150 ? 4 : ping < 300 ? 3 : ping < 600 ? 2 : 1
  const signal = gameElement('hud-signal')
  signal.className = `signal signal--${level}`
  ;[...signal.children].forEach((bar, i) => bar.classList.toggle('on', level > i))
  const server = account?.server
  gameElement('hud-host').textContent = server ? (server.port === 25565 ? server.host : `${server.host}:${server.port}`) : '—'
  gameElement('hud-meta').textContent = `${ping == null ? '—' : ping} ms · ${fps} FPS · ${chunks} chunks${account?.version ? ` · ${account.version}` : ''}`
}
async function loadAccount () {
  try {
    const state = await (await fetch('/api/state')).json()
    const next = state.accounts.find(a => a.id === accountId)
    if (next && next.username !== account?.username) {
      paintHead(gameElement('hud-head'), next.username || next.label)
      gameElement('hud-name').textContent = next.username || next.label
      document.title = `${next.username || next.label} · Gameplay · StayAlive`
      gameElement('pause-title').textContent = next.username || next.label
    }
    account = next || account
    drawServer()
  } catch {}
}
loadAccount()
setInterval(loadAccount, 2000)

// World stream.
controlSocket.on('world', world => { view.setWorld(world); if (!world.keep) chunks = 0 })
controlSocket.on('chunk', ({ x, z, chunk }) => { view.world.addColumn(x, z, chunk); chunks++ })
controlSocket.on('unloadChunk', ({ x, z }) => { view.world.removeColumn(x, z); chunks = Math.max(0, chunks - 1) })
controlSocket.on('block', ({ x, y, z, stateId }) => view.world.setBlock(x, y, z, stateId))
controlSocket.on('entity', data => view.entities.update(data))
controlSocket.on('entityEvent', data => view.entities.event(data))
controlSocket.on('move', data => view.entities.move(data))
controlSocket.on('position', data => view.setPosition(data))
controlSocket.on('dig', data => view.setDig(data))
controlSocket.on('sound', data => { if (controlling && hud) sounds.play(data, { ...hud.position, yaw }) })

// Render distance, in chunks. More chunks load more of the world and use more memory.
const distance = gameElement('render-distance')
distance.value = storedDistance
gameElement('render-distance-value').textContent = storedDistance
distance.addEventListener('input', () => { gameElement('render-distance-value').textContent = distance.value })
distance.addEventListener('change', () => {
  const value = Number(distance.value)
  try { localStorage.setItem('stayalive.renderDistance', value) } catch {}
  controlSocket.emit('viewDistance', value)
})

controlSocket.on('hud', next => {
  hud = next
  if (!controlling) { slot = next.slot; yaw = next.yaw; pitch = next.pitch }
  if (controlling && !next.manual) { releaseControl(); gameMessage('Manual control ended. Take control to continue.') }
  gameElement('take-control').disabled = fatal || !controlSocket.connected
  gameElement('game-status').textContent = 'Take control to capture the mouse. Esc gives it back.'
  drawHud(); drawHotbar(); drawInventory()
  if (next.window && next.window.id !== lastWindow && controlling) { gameElement('inventory-panel').hidden = false; inventoryKey = ''; unlockForPanel(); drawInventory() }
  lastWindow = next.window?.id || null
})
controlSocket.on('chat', message => {
  const line = document.createElement('div')
  minecraftText(line, message)
  const container = gameElement('chat-messages')
  container.append(line)
  setTimeout(() => line.classList.add('is-old'), 10000)
  while (container.children.length > 8) container.firstChild.remove()
})
controlSocket.on('sidebar', sidebar)
controlSocket.on('title', serverTitle)
controlSocket.on('actionbar', text => {
  minecraftText(gameElement('actionbar'), text)
  clearTimeout(actionTimer)
  actionTimer = setTimeout(() => gameElement('actionbar').replaceChildren(), 3000)
})
setInterval(() => { if (tabHeld) controlSocket.emit('tablist', playerList) }, 1000)
for (const [id, fallback, apply] of [
  ['field-of-view', 70, value => { view.baseFov = value }],
  ['sensitivity', 50, value => { sensitivity = Math.pow(value / 100 * 0.6 + 0.2, 3) * 8 * 0.15 * Math.PI / 180 }]
]) {
  const input = gameElement(id)
  let value = fallback
  try { value = Number(localStorage.getItem('stayalive.' + id) ?? fallback) } catch {}
  input.value = value
  const update = () => { gameElement(id + '-value').textContent = input.value; apply(Number(input.value)) }
  update()
  input.addEventListener('input', update)
  input.addEventListener('change', () => { try { localStorage.setItem('stayalive.' + id, input.value) } catch {} })
}
const bobbing = gameElement('view-bobbing')
try { bobbing.checked = localStorage.getItem('stayalive.viewBobbing') !== 'false' } catch {}
view.bobbing = bobbing.checked
bobbing.addEventListener('change', () => { view.bobbing = bobbing.checked; try { localStorage.setItem('stayalive.viewBobbing', bobbing.checked) } catch {} })
controlSocket.on('playError', gameMessage)
controlSocket.on('fatal', message => { fatal = true; releaseControl(); gameElement('game-status').textContent = message; gameMessage(message) })
controlSocket.on('disconnect', () => { releaseControl(); gameElement('take-control').disabled = true; gameElement('game-status').textContent = 'Gameplay disconnected. Reopen it after the account rejoins.' })
setMode()
drawHotbar()
