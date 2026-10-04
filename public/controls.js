const accountId = new URLSearchParams(location.search).get('id')
const controlSocket = io({ path: '/play/socket.io', auth: { role: 'control', account: accountId } })
const gameElement = id => document.getElementById(id)
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

function gameMessage (message) { gameElement('game-message').textContent = message }
function sendInput () {
  if (!controlling || !controlSocket.connected) return
  controlSocket.volatile.emit('input', { keys: [...new Set([...heldKeys].map(key => bindings[key]).filter(Boolean))], yaw, pitch, slot })
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
  document.body.classList.remove('panel-open')
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
  const canvas = document.querySelector('canvas')
  if (!canvas) { gameMessage('Renderer is still loading.'); return }
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
  sendInput()
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
  if (!controlling) return
  if (event.code === 'Escape') { event.preventDefault(); releaseControl(); return }
  if (event.target.tagName === 'INPUT') return
  if (event.code === 'KeyE' && !event.repeat) {
    event.preventDefault()
    if (!gameElement('inventory-panel').hidden) closeInventory()
    else { gameElement('inventory-panel').hidden = false; unlockForPanel(); drawInventory() }
    return
  }
  if (event.code === 'KeyT' && !event.repeat) { event.preventDefault(); gameElement('chat-form').hidden = false; unlockForPanel(); gameElement('chat-input').focus(); return }
  if (document.body.classList.contains('panel-open')) return
  if (bindings[event.code]) { event.preventDefault(); heldKeys.add(event.code); sendInput() }
  if (/^Digit[1-9]$/.test(event.code)) { slot = Number(event.code.slice(-1)) - 1; sendInput(); drawHotbar() }
})
document.addEventListener('keyup', event => { heldKeys.delete(event.code); if (controlling) sendInput() })
document.addEventListener('wheel', event => {
  if (!controlling || !document.pointerLockElement) return
  event.preventDefault(); slot = (slot + (event.deltaY > 0 ? 1 : 8)) % 9; sendInput(); drawHotbar()
}, { passive: false })
document.addEventListener('contextmenu', event => event.preventDefault())
document.addEventListener('mousedown', event => {
  if (!controlling || !document.pointerLockElement || event.target.tagName !== 'CANVAS') return
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
setInterval(() => { if (controlling && leftHeld && document.pointerLockElement) controlSocket.emit('interact', 'left') }, 180)

function drawHotbar () {
  const bar = gameElement('hotbar')
  bar.replaceChildren()
  for (let i = 0; i < 9; i++) {
    const item = hud?.hotbar[i]
    const cell = document.createElement('div')
    cell.className = 'hotbar-slot' + (i === slot ? ' active' : '')
    const number = document.createElement('b'); number.textContent = i + 1; cell.append(number)
    if (item) { const name = document.createElement('span'); name.textContent = item.name; const count = document.createElement('em'); count.textContent = item.count; cell.append(name, count) }
    bar.append(cell)
  }
}
function drawInventory () {
  if (!hud || gameElement('inventory-panel').hidden) return
  gameElement('inventory-carried').textContent = hud.carried ? `Holding ${hud.carried.name} x${hud.carried.count}` : 'Holding nothing'
  const key = JSON.stringify([hud.inventory, hud.window])
  if (key === inventoryKey) return
  inventoryKey = key
  gameElement('inventory-title').textContent = hud.window ? hud.window.title : 'Inventory'
  const container = gameElement('inventory-slots')
  container.replaceChildren()
  hud.inventory.forEach((item, index) => {
    const button = document.createElement('button')
    button.className = 'inventory-slot'
    button.textContent = item ? `${item.name} ×${item.count}` : String(index)
    button.setAttribute('aria-label', `Slot ${index}: ${item?.name || 'empty'}`)
    button.addEventListener('click', event => controlSocket.emit('inventoryClick', { slot: index, button: 0, mode: event.shiftKey ? 1 : 0 }))
    button.addEventListener('contextmenu', event => { event.preventDefault(); controlSocket.emit('inventoryClick', { slot: index, button: 1, mode: event.shiftKey ? 1 : 0 }) })
    container.append(button)
  })
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
  document.body.classList.remove('panel-open')
  captureMouse()
})
controlSocket.on('hud', next => {
  hud = next
  if (!controlling) { slot = next.slot; yaw = next.yaw; pitch = next.pitch }
  if (controlling && !next.manual) { releaseControl(); gameMessage('Manual control ended. Click Take control to continue.') }
  gameElement('take-control').disabled = fatal || !controlSocket.connected
  gameElement('game-status').textContent = 'Click Take control to capture the mouse. Esc returns to AFK.'
  const p = next.position
  gameElement('game-info').textContent = `${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}${controlling ? ' · controlling' : ' · watching'}`
  gameElement('vitals').textContent = `Health ${next.health ?? '?'} / 20 · Food ${next.food ?? '?'} / 20`
  drawHotbar(); drawInventory()
  if (next.window && next.window.id !== lastWindow && controlling) { gameElement('inventory-panel').hidden = false; inventoryKey = ''; unlockForPanel(); drawInventory() }
  lastWindow = next.window?.id || null
})
controlSocket.on('chat', message => {
  const line = document.createElement('div'); line.textContent = message
  const container = gameElement('chat-messages'); container.append(line)
  while (container.children.length > 5) container.firstChild.remove()
})
controlSocket.on('playError', gameMessage)
controlSocket.on('fatal', message => { fatal = true; releaseControl(); gameElement('game-status').textContent = message; gameMessage(message) })
controlSocket.on('disconnect', () => { releaseControl(); gameElement('take-control').disabled = true; gameElement('game-status').textContent = 'Gameplay disconnected. Reopen after the account rejoins.' })
drawHotbar()
