const $ = id => document.getElementById(id)
let state = null
let initialized = false
const selected = new Set()
let rowsKey = ''
let logsKey = ''
let noticeTimer

function notice (message) {
  $('notice').textContent = message
  $('notice').hidden = false
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { $('notice').hidden = true }, 8000)
}

async function api (action, body) {
  const response = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw Error(result.error || 'Request failed.')
  return result
}

function run (fn) { Promise.resolve().then(fn).catch(error => notice(error.message)) }
function escapeHtml (value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) }
function ids () { if (!selected.size) throw Error('Select at least one account first.'); return [...selected] }

function selection () {
  $('selected-count').textContent = `${selected.size} selected`
  $('select-all').checked = Boolean(state?.accounts.length) && selected.size === state.accounts.length
  $('select-all').indeterminate = selected.size > 0 && selected.size < state.accounts.length
  for (const button of [$('join-selected'), $('disconnect-selected'), $('stop'), $('disable-anti'), ...document.querySelectorAll('[data-player-action]')]) button.disabled = !selected.size
}

function render (next) {
  state = next
  for (const id of selected) if (!state.accounts.some(a => a.id === id)) selected.delete(id)
  if (!initialized) {
    const s = state.settings
    $('host').value = s.host
    $('port').value = s.port
    $('version').value = s.version
    $('join-delay').value = s.joinDelay
    $('reconnect').checked = s.reconnect
    $('versions').innerHTML = state.versions.map(v => `<option value="${escapeHtml(v)}"></option>`).join('')
    initialized = true
  }
  $('total').textContent = state.accounts.length
  $('online').textContent = state.accounts.filter(a => a.position).length
  $('memory').textContent = `${state.memory} MB`
  const key = JSON.stringify(state.accounts)
  if (key !== rowsKey) {
    rowsKey = key
    $('accounts').innerHTML = state.accounts.map(a => {
      const active = ['idle', 'walking', 'path blocked', 'manual'].includes(a.status)
      const busy = ['queued', 'connecting', 'login required', 'signing in', 'reconnecting', 'respawning'].includes(a.status)
      const position = a.position ? `${a.position.x} / ${a.position.y} / ${a.position.z}` : 'No position yet'
      let code = ''
      if (a.code) {
        const expired = a.code.expiresAt < Date.now()
        const url = /^https:\/\/([a-z0-9-]+\.)?(microsoft\.com|live\.com)\//i.test(a.code.url) ? a.code.url : 'https://www.microsoft.com/link'
        code = `<div class="device-code">${expired ? 'Code expired. Wait for login to finish, then try again.' : `Sign in with the account for this label:<strong>${escapeHtml(a.code.userCode)}</strong><button data-action="copy" data-id="${a.id}">Copy code</button><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open Microsoft ↗</a>`}</div>`
      }
      return `<tr><td><input type="checkbox" data-select="${a.id}" aria-label="Select ${escapeHtml(a.label)}" ${selected.has(a.id) ? 'checked' : ''}></td><td><div class="account-name">${escapeHtml(a.username || a.label)}</div><div class="account-label">${escapeHtml(a.label)} · ${a.auth === 'microsoft' ? 'Microsoft' : 'offline'}</div>${code}${a.error ? `<div class="account-error">${escapeHtml(a.error)}</div>` : ''}</td><td><span class="badge ${active ? 'active' : busy || a.error ? 'warning' : ''}">${escapeHtml(a.status)}</span></td><td><div class="coords">${escapeHtml(position)}</div><div class="route-state">${a.route.mode === 'loop' ? `Loop · ${a.routeIndex + 1}/${a.route.points.length}` : a.route.mode === 'goto' ? 'Walk to position' : 'Stay AFK'}</div></td><td><div class="row-buttons">${a.auth === 'microsoft' ? `<button data-action="login" data-id="${a.id}" ${active || busy ? 'disabled' : ''}>Sign in</button>` : ''}<button data-action="${active || busy ? 'disconnect' : 'join'}" data-id="${a.id}">${active || busy ? 'Leave' : 'Join'}</button><button data-action="route" data-id="${a.id}">Route</button><button class="remove" data-action="remove" data-id="${a.id}" ${active || busy ? 'disabled' : ''} aria-label="Remove ${escapeHtml(a.label)}">×</button></div></td></tr>`
    }).join('')
    for (const a of state.accounts) {
      const cell = document.querySelector(`[data-select="${a.id}"]`).closest('tr').children[3]
      const details = document.createElement('div')
      details.className = 'action-state'
      details.textContent = `${a.slot ? `Slot ${a.slot}` : `Slot ${a.actions?.slot || 1}`} · ${a.rotation ? `Yaw ${a.rotation.yaw} / pitch ${a.rotation.pitch}` : 'No rotation yet'}${a.actions?.antiAfk.enabled ? ` · Anti-AFK ${a.actions.antiAfk.interval}s` : ''}`
      cell.append(details)
    }
    $('empty').hidden = state.accounts.length > 0
    const filter = $('log-filter').value
    $('log-filter').innerHTML = '<option value="">All accounts</option>' + state.accounts.map(a => `<option value="${escapeHtml(a.label)}">${escapeHtml(a.label)}</option>`).join('')
    $('log-filter').value = filter
  }
  selection()
  renderLogs()
  if (typeof updateMapAccounts === 'function') updateMapAccounts()
  const gameAccount = $('game-account')
  const previousGame = gameAccount.value
  gameAccount.innerHTML = '<option value="">Choose an account</option>' + state.accounts.filter(a => a.position).map(a => `<option value="${a.id}">${escapeHtml(a.username || a.label)}</option>`).join('')
  gameAccount.value = state.accounts.some(a => a.id === previousGame && a.position) ? previousGame : state.accounts.find(a => a.position)?.id || ''
  $('open-game').disabled = !gameAccount.value
}

function renderLogs () {
  const filter = $('log-filter').value
  const logs = state.logs.filter(log => !filter || log.account === filter)
  const key = JSON.stringify(logs)
  if (key === logsKey) return
  logsKey = key
  const container = $('logs')
  const bottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40
  container.innerHTML = logs.length ? logs.map(log => `<div class="log-entry"><time>${escapeHtml(new Date(log.time).toLocaleTimeString([], { hour12: false }))}</time><span class="log-account">${escapeHtml(log.account)}</span><span class="log-message">${escapeHtml(log.message)}</span></div>`).join('') : '<p class="hint">Quiet for now.</p>'
  if (bottom) container.scrollTop = container.scrollHeight
}

function settings () {
  return { host: $('host').value, port: Number($('port').value), version: $('version').value, joinDelay: Number($('join-delay').value), reconnect: $('reconnect').checked }
}

$('server-form').addEventListener('submit', event => { event.preventDefault(); run(async () => { await api('settings', settings()); notice('Server saved. Changes apply to the next connection.') }) })
$('import-form').addEventListener('submit', event => { event.preventDefault(); run(async () => { const auth = $('auth').value; await api('accounts', { text: $('account-input').value, auth }); $('account-input').value = ''; notice(auth === 'microsoft' ? 'Accounts added. Sign in to each Microsoft account before joining.' : 'Offline accounts added. Select them to join your offline server.') }) })
$('account-file').addEventListener('change', () => run(async () => {
  const file = $('account-file').files[0]
  if (!file) return
  if (file.size > 65536) throw Error('Account files must be smaller than 64 KB.')
  $('account-input').value = await file.text()
  $('account-file').value = ''
}))
$('auth').addEventListener('change', () => {
  $('auth-hint').textContent = $('auth').value === 'microsoft' ? 'Each account signs in through Microsoft in your browser. Never paste passwords here.' : 'Only for servers with online-mode disabled. This does not sign in to a Microsoft account.'
})
$('select-all').addEventListener('change', () => {
  selected.clear()
  if ($('select-all').checked) state.accounts.forEach(a => selected.add(a.id))
  document.querySelectorAll('[data-select]').forEach(input => { input.checked = selected.has(input.dataset.select) })
  loadSelectedActions()
  selection()
})
$('accounts').addEventListener('change', event => {
  const id = event.target.dataset.select
  if (!id) return
  if (event.target.checked) selected.add(id)
  else selected.delete(id)
  loadSelectedActions()
  selection()
})
$('accounts').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]')
  if (!button) return
  const { action, id } = button.dataset
  run(async () => {
    if (action === 'copy') { await navigator.clipboard.writeText(state.accounts.find(a => a.id === id).code.userCode); notice('Login code copied.'); return }
    if (action === 'route') {
      const a = state.accounts.find(a => a.id === id)
      selected.clear(); selected.add(id)
      document.querySelectorAll('[data-select]').forEach(input => { input.checked = input.dataset.select === id })
      $('mode').value = a.route.mode
      $('points').value = a.route.points.map(p => `${p.x} ${p.y} ${p.z}`).join('\n')
      loadActions(a.actions)
      movementHint(); selection(); $('mode').focus(); return
    }
    if (action === 'remove' && !window.confirm('Remove this account and its saved Microsoft session?')) return
    if (action === 'join') await api('settings', settings())
    await api(action, ['join', 'disconnect'].includes(action) ? { ids: [id] } : { id })
  })
})
$('join-selected').addEventListener('click', () => run(async () => { const accounts = ids(); await api('settings', settings()); await api('join', { ids: accounts }) }))
$('disconnect-selected').addEventListener('click', () => run(() => api('disconnect', { ids: ids() })))
$('stop').addEventListener('click', () => run(() => api('route', { ids: ids(), route: { mode: 'idle', points: [] } })))
$('route-form').addEventListener('submit', event => {
  event.preventDefault()
  run(async () => {
    const mode = $('mode').value
    const points = mode === 'idle' ? [] : $('points').value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const parts = line.split(/[\s,]+/)
      if (parts.length !== 3 || !parts.every(p => /^-?\d+$/.test(p))) throw Error('Use three whole numbers per waypoint: X Y Z.')
      const [x, y, z] = parts.map(Number)
      return { x, y, z }
    })
    await api('route', { ids: ids(), route: { mode, points } })
    notice('Movement saved. Disconnected accounts will use it when they spawn.')
  })
})
function movementHint () {
  const mode = $('mode').value
  $('points').disabled = mode === 'idle'
  $('route-hint').textContent = mode === 'loop' ? 'Add at least two different waypoints. Bots walk between them on repeat.' : mode === 'goto' ? 'Add one waypoint. Bots stop and stay AFK after reaching it.' : 'Bots stop moving and stay connected.'
}
$('mode').addEventListener('change', movementHint)
$('log-filter').addEventListener('change', renderLogs)

function loadActions (actions) {
  if (!actions) return
  $('yaw').value = actions.yaw
  $('pitch').value = actions.pitch
  $('hotbar').value = actions.slot
  $('hold-sneak').checked = actions.sneak
  $('anti-interval').value = actions.antiAfk.interval
  for (const key of ['enabled', 'jump', 'sneak', 'swing', 'rotate', 'hotbar']) $('anti-' + key).checked = actions.antiAfk[key]
}

function loadSelectedActions () {
  if (selected.size === 1) loadActions(state.accounts.find(a => selected.has(a.id)).actions)
}

function actionSettings () {
  const antiAfk = { interval: Number($('anti-interval').value) }
  for (const key of ['enabled', 'jump', 'sneak', 'swing', 'rotate', 'hotbar']) antiAfk[key] = $('anti-' + key).checked
  return { yaw: Number($('yaw').value), pitch: Number($('pitch').value), slot: Number($('hotbar').value), sneak: $('hold-sneak').checked, antiAfk }
}

$('actions-form').addEventListener('submit', event => {
  event.preventDefault()
  run(async () => { await api('actions', { ids: ids(), actions: actionSettings() }); notice('Actions saved. Idle rotation and sneaking apply when walking stops.') })
})
document.querySelectorAll('[data-player-action]').forEach(button => {
  button.addEventListener('click', () => run(() => api('action', { ids: ids(), action: button.dataset.playerAction })))
})
$('disable-anti').addEventListener('click', () => run(async () => {
  const accounts = ids().map(id => state.accounts.find(a => a.id === id))
  for (const a of accounts) await api('actions', { ids: [a.id], actions: { ...a.actions, antiAfk: { ...a.actions.antiAfk, enabled: false } } })
  $('anti-enabled').checked = false
  notice('Anti-AFK disabled for the selected accounts.')
}))
const events = new EventSource('/api/events')
$('open-game').addEventListener('click', () => {
  if (!$('game-account').value) return
  window.open('/play/?id=' + encodeURIComponent($('game-account').value), '_blank', 'noopener')
})
events.onmessage = event => { $('connection').textContent = '● Dashboard connected'; render(JSON.parse(event.data)) }
events.onerror = () => { $('connection').textContent = 'Dashboard disconnected. Reconnecting...'; }
