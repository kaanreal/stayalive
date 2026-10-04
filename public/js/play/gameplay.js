// Gameplay page (public/play.html): 3D view, HUD, manual control and inventory for one account.
// Socket messages match lib/play.js. World: world, chunk, unloadChunk, block, entity, move, position.
// Control: takeControl, releaseControl, input, interact, stopUse, inventoryClick, closeInventory, chat, viewDistance.
import { paintHead } from '/js/ui/head-art.js'
import { GameRenderer } from './renderer.js'

const accountId = new URLSearchParams(location.search).get('id')
const embedded = window.parent !== window
const storedDistance = (() => { try { return Number(localStorage.getItem('stayalive.renderDistance')) || 8 } catch { return 8 } })()
const controlSocket = io({ path: '/play/socket.io', auth: { role: 'control', account: accountId, radius: storedDistance } })
const gameElement = id => document.getElementById(id)
const view = new GameRenderer()
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
let inventoryKey = ''
let lastWindow = null
let fatal = false
let account = null
let messageTimer
let chunks = 0

// While you control the player, the camera follows your mouse directly instead of waiting for the server.
view.look = () => controlling ? { yaw, pitch } : null

function gameMessage (message) {
  const element = gameElement('game-message')
  element.textContent = message
  element.classList.toggle('is-visible', Boolean(message))
  clearTimeout(messageTimer)
  if (message) messageTimer = setTimeout(() => element.classList.remove('is-visible'), 7000)
}
function sendInput () {
  if (!controlling || !controlSocket.connected) return
  controlSocket.volatile.emit('input', { keys: [...new Set([...heldKeys].map(key => bindings[key]).filter(Boolean))], yaw, pitch, slot })
}
function setMode () {
  gameElement('hud-mode').textContent = controlling ? 'Controlling' : 'Watching'
  document.body.classList.toggle('is-controlling', controlling)
}
function releaseControl () {
  heldKeys.clear()
  leftHeld = false
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
  setMode()
}
function unlockForPanel () {
  heldKeys.clear()
  leftHeld = false
  sendInput()
  controlSocket.emit('interact', 'stop')
  controlSocket.emit('stopUse')
  document.body.classList.add('panel-open')
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
  if (!document.pointerLockElement && !document.body.classList.contains('panel-open') && !acquiring) releaseControl()
})
document.addEventListener('mousemove', event => {
  if (!controlling || !document.pointerLockElement) return
  yaw = ((yaw - event.movementX * 0.0025) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
  pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch - event.movementY * 0.0025))
})
document.addEventListener('keydown', event => {
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') view.eyeHeight = controlling ? 1.54 : 1.62
  if (!controlling) return
  if (event.code === 'Escape') { event.preventDefault(); releaseControl(); return }
  if (event.target.tagName === 'INPUT') return
  if (event.code === 'KeyE' && !event.repeat) {
    event.preventDefault()
    if (!gameElement('inventory-panel').hidden) closeInventory()
    else { gameElement('inventory-panel').hidden = false; unlockForPanel(); drawInventory() }
    return
  }
  if (event.code === 'KeyT' && !event.repeat) {
    event.preventDefault()
    gameElement('chat-form').hidden = false
    document.body.classList.add('chat-open')
    unlockForPanel()
    gameElement('chat-input').focus()
    return
  }
  if (document.body.classList.contains('panel-open')) return
  if (bindings[event.code]) { event.preventDefault(); heldKeys.add(event.code); sendInput() }
  if (/^Digit[1-9]$/.test(event.code)) { slot = Number(event.code.slice(-1)) - 1; sendInput(); drawHotbar(true) }
})
document.addEventListener('keyup', event => {
  heldKeys.delete(event.code)
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') view.eyeHeight = 1.62
  if (controlling) sendInput()
})
document.addEventListener('wheel', event => {
  if (!controlling || !document.pointerLockElement) return
  event.preventDefault(); slot = (slot + (event.deltaY > 0 ? 1 : 8)) % 9; sendInput(); drawHotbar(true)
}, { passive: false })
document.addEventListener('contextmenu', event => event.preventDefault())
document.addEventListener('mousedown', event => {
  if (!controlling || !document.pointerLockElement || event.target !== viewerCanvas()) return
  view.hand.swing()
  if (event.button === 0) leftHeld = true
  controlSocket.emit('interact', event.button === 2 ? 'right' : 'left')
})
document.addEventListener('mouseup', event => {
  if (!controlling) return
  if (event.button === 0) { leftHeld = false; controlSocket.emit('interact', 'stop') }
  if (event.button === 2) controlSocket.emit('stopUse')
})
window.addEventListener('blur', releaseControl)
window.addEventListener('pagehide', releaseControl)
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseControl() })
setInterval(sendInput, 50)
setInterval(() => { if (controlling && leftHeld && document.pointerLockElement) { controlSocket.emit('interact', 'left'); view.hand.swing() } }, 180)

// Item tiles: the item's own texture, or its initials when the renderer has no icon for it.
function itemTile (item) {
  const tile = document.createElement('span')
  tile.className = 'item'
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
    icon.onerror = () => { icon.remove(); initials() }
    tile.append(icon)
  } else initials()
  if (item.count > 1) { const count = document.createElement('em'); count.textContent = item.count; tile.append(count) }
  return tile
}

let itemNameTimer
function drawHotbar (changed) {
  view.hand.setItem(hud?.hotbar[slot])
  const bar = gameElement('hotbar')
  bar.replaceChildren()
  for (let i = 0; i < 9; i++) {
    const item = hud?.hotbar[i]
    const cell = document.createElement('div')
    cell.className = 'hotbar-slot' + (i === slot ? ' active' : '')
    if (item) { cell.append(itemTile(item)); cell.title = item.name }
    bar.append(cell)
  }
  if (changed) {
    const name = gameElement('item-name')
    name.textContent = hud?.hotbar[slot]?.name || ''
    name.classList.add('is-visible')
    clearTimeout(itemNameTimer)
    itemNameTimer = setTimeout(() => name.classList.remove('is-visible'), 1800)
  }
}

// Inventory sections follow the vanilla slot layout; containers put their own slots first.
function sections (count, isContainer) {
  if (isContainer) return [['Container', 0, count - 36], ['Inventory', count - 36, count - 9], ['Hotbar', count - 9, count]]
  return [['Armor', 5, 9], ['Crafting', 1, 5], ['Result', 0, 1], ['Offhand', 45, 46], ['Inventory', 9, 36], ['Hotbar', 36, 45]].filter(([, from]) => from < count)
}
function drawInventory () {
  if (!hud || gameElement('inventory-panel').hidden) return
  gameElement('inventory-carried').textContent = hud.carried ? `Holding ${hud.carried.name} ×${hud.carried.count}` : 'Holding nothing'
  const key = JSON.stringify([hud.inventory, hud.window])
  if (key === inventoryKey) return
  inventoryKey = key
  gameElement('inventory-title').textContent = hud.window ? hud.window.title : 'Inventory'
  const container = gameElement('inventory-slots')
  container.replaceChildren()
  for (const [label, from, to] of sections(hud.inventory.length, Boolean(hud.window))) {
    const group = document.createElement('div')
    group.className = 'inv-group inv-group--' + label.toLowerCase()
    const title = document.createElement('h3')
    title.textContent = label
    const grid = document.createElement('div')
    grid.className = 'inv-grid'
    for (let index = from; index < to; index++) {
      const item = hud.inventory[index]
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'inventory-slot'
      button.title = item ? `${item.name} ×${item.count}` : ''
      button.setAttribute('aria-label', `Slot ${index}: ${item ? `${item.name} ×${item.count}` : 'empty'}`)
      if (item) button.append(itemTile(item))
      button.addEventListener('click', event => controlSocket.emit('inventoryClick', { slot: index, button: 0, mode: event.shiftKey ? 1 : 0 }))
      button.addEventListener('contextmenu', event => { event.preventDefault(); controlSocket.emit('inventoryClick', { slot: index, button: 1, mode: event.shiftKey ? 1 : 0 }) })
      grid.append(button)
    }
    group.append(title, grid)
    container.append(group)
  }
}
function closeInventory () {
  controlSocket.emit('closeInventory')
  gameElement('inventory-panel').hidden = true
  document.body.classList.remove('panel-open')
  captureMouse()
}
gameElement('close-inventory').addEventListener('click', closeInventory)
gameElement('chat-form').addEventListener('submit', event => {
  event.preventDefault()
  controlSocket.emit('chat', gameElement('chat-input').value)
  gameElement('chat-input').value = ''
  gameElement('chat-form').hidden = true
  document.body.classList.remove('panel-open', 'chat-open')
  captureMouse()
})

// Hearts and drumsticks, drawn like the vanilla HUD: 10 icons, half steps.
const heart = ['.##...##.', '####.####', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....']
const drumstick = ['....###..', '...#####.', '..######.', '..######.', '..#####..', '.#.###...', '.##......', '#..#.....', '.##......']
function drawBar (canvas, art, value, colors) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < 10; i++) {
    const points = Math.max(0, Math.min(2, (value ?? 0) - i * 2))
    art.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== '#') return
      ctx.fillStyle = points === 2 || (points === 1 && x < 5) ? colors[0] : colors[1]
      ctx.fillRect(i * 20 + x * 2, y * 2, 2, 2)
    }))
  }
  canvas.setAttribute('aria-label', `${canvas.getAttribute('aria-label').split(' ')[0]} ${value ?? '?'} of 20`)
}

const facings = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
function drawHud () {
  if (!hud) return
  const p = hud.position
  const degrees = ((180 - hud.yaw * 180 / Math.PI) % 360 + 360) % 360
  gameElement('hud-xyz').textContent = `XYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)} · ${facings[Math.round(degrees / 45) % 8]}`
  drawBar(gameElement('hud-health'), heart, hud.health == null ? null : Math.round(hud.health), ['#e0453a', '#3a1e1c'])
  drawBar(gameElement('hud-food'), drumstick, hud.food, ['#d08a4c', '#3a2a1c'])
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
controlSocket.on('move', data => view.entities.move(data))
controlSocket.on('position', data => view.setPosition(data))

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
  line.textContent = message
  const container = gameElement('chat-messages')
  container.append(line)
  setTimeout(() => line.classList.add('is-old'), 10000)
  while (container.children.length > 8) container.firstChild.remove()
})
controlSocket.on('playError', gameMessage)
controlSocket.on('fatal', message => { fatal = true; releaseControl(); gameElement('game-status').textContent = message; gameMessage(message) })
controlSocket.on('disconnect', () => { releaseControl(); gameElement('take-control').disabled = true; gameElement('game-status').textContent = 'Gameplay disconnected. Reopen it after the account rejoins.' })
setMode()
drawHotbar()
