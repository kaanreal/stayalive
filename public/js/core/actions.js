// Everything that changes state goes through here: API calls, selection, navigation and local lists.
import { post } from './api.js'
import { save } from './storage.js'
import { store, update, accounts, accountById, settings, activeServer } from './store.js'
import { isMappable, serverKey, serverLabel, sameServer } from './format.js'

// Toasts --------------------------------------------------------------------------------------

let toastId = 0
export function toast (message, kind = 'info', action = null) {
  const id = ++toastId
  update(s => ({ toasts: [...s.toasts.slice(-3), { id, message, kind, action }] }))
  setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 5500)
}
export const dismiss = id => update(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))

// Runs an async action and turns failures into an error toast.
export function run (fn) { return Promise.resolve().then(fn).catch(error => { toast(error.message, 'error'); return null }) }

// Navigation, modals, panels ------------------------------------------------------------------

export function navigate (page) {
  if (location.hash !== `#/${page}`) location.hash = `#/${page}`
  update({ page })
}
export const openModal = (type, props = {}) => update({ modal: { type, props } })
export const closeModal = () => update({ modal: null })
export function confirm (props) { openModal('confirm', props) }

export function toggleConsole (open = !store.consoleOpen) {
  update({ consoleOpen: open, unread: 0, lastSeenLog: store.snapshot?.logs.at(-1)?.time || '' })
}

export function setPref (key, value) {
  const prefs = { ...store.prefs, [key]: value }
  update({ prefs })
  save('prefs', prefs)
}

// Selection and focus -------------------------------------------------------------------------

export function focus (id) {
  update({ focusId: id })
  save('focus', id)
}

export function setSelection (ids) { update({ selected: new Set(ids) }) }
export function toggleSelected (id, on = !store.selected.has(id)) {
  const next = new Set(store.selected)
  if (on) next.add(id)
  else next.delete(id)
  update({ selected: next })
}
export const clearSelection = () => setSelection([])

// Accounts ------------------------------------------------------------------------------------

function requireServer () {
  if (settings().host) return
  navigate('multiplayer')
  throw Error('Choose a server in Multiplayer first.')
}

export async function join (ids) {
  requireServer()
  if (!ids.length) throw Error('Choose at least one account to join.')
  await post('join', { ids })
  const delay = settings().joinDelay / 1000
  toast(ids.length > 1 ? `Joining ${ids.length} accounts, ${delay}s apart.` : 'Joining server…', 'info')
}

export async function leave (ids) {
  if (!ids.length) throw Error('Choose at least one account.')
  await post('disconnect', { ids })
}

export async function login (id) {
  await post('login', { id })
  toast('Microsoft sign-in started. Use the code shown on the account.', 'info')
}

export async function addAccounts (text, auth) {
  await post('accounts', { text, auth })
  toast(auth === 'microsoft' ? 'Accounts added. Sign in to each one, or join and sign in when asked.' : 'Offline accounts added.', 'success')
}

export function removeAccount (account) {
  confirm({
    title: 'Remove account?',
    message: `${account.username || account.label} and its saved Microsoft session will be deleted from this computer.`,
    confirmLabel: 'Remove',
    danger: true,
    onConfirm: async () => {
      await post('remove', { id: account.id })
      toggleSelected(account.id, false)
      toast('Account removed.', 'success')
    }
  })
}

// Routes and movement -------------------------------------------------------------------------

export const setRoute = (ids, route) => post('route', { ids, route })
export async function stopRoute (ids) {
  if (!ids.length) throw Error('Choose at least one account.')
  await setRoute(ids, { mode: 'idle', points: [] })
  toast(ids.length > 1 ? `${ids.length} accounts stopped. They stay connected.` : 'Stopped. The account stays connected.', 'success')
}

// Sends each account to its own spot (or all to the same one).
export async function sendTo (list, spots) {
  const results = await Promise.allSettled(list.map((a, i) => setRoute([a.id], { mode: 'goto', points: [spots[i] || spots[0]] })))
  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length) throw Error(failed[0].reason.message)
  const p = spots[0]
  toast(list.length > 1 ? `${list.length} accounts walking to ${p.x} ${p.y} ${p.z}.` : `Walking to ${p.x} ${p.y} ${p.z}.`, 'success')
}

export async function walkOnMap (id, x, z, layer) {
  const { point } = await post('map-walk', { id, x, z, layer })
  toast(`Walking to ${point.x} ${point.y} ${point.z}.`, 'success')
  return point
}

export async function applyActions (ids, actions) {
  if (!ids.length) throw Error('Choose at least one account.')
  await post('actions', { ids, actions })
}

export async function playerAction (ids, action) {
  if (!ids.length) throw Error('Choose at least one account.')
  await post('action', { ids, action })
}

export function setDestination (point) { update({ destination: point }) }

export function setDraft (draft) {
  update({ draft })
  save('draft', draft)
}
export function addDraftPoint (point) {
  const p = { x: point.x, y: point.y, z: point.z, ...(point.name ? { name: point.name } : {}) }
  setDraft({ ...store.draft, points: [...store.draft.points, p].slice(0, 100) })
}

export function addWaypoint (point, name) {
  const server = activeServer()
  const waypoint = { id: crypto.randomUUID(), name: name.trim().slice(0, 40) || `Waypoint ${store.waypoints.length + 1}`, x: point.x, y: point.y, z: point.z, server: server ? serverKey(server.host, server.port) : null }
  const waypoints = [...store.waypoints, waypoint]
  update({ waypoints })
  save('waypoints', waypoints)
  toast(`Saved waypoint “${waypoint.name}”.`, 'success')
}
export function removeWaypoint (id) {
  const waypoints = store.waypoints.filter(w => w.id !== id)
  update({ waypoints })
  save('waypoints', waypoints)
}
// Waypoints belong to the server they were saved on.
export function visibleWaypoints () {
  const server = activeServer()
  const key = server ? serverKey(server.host, server.port) : null
  return store.waypoints.filter(w => !w.server || w.server === key)
}

// Gameplay ------------------------------------------------------------------------------------

export function openGameplay (id) {
  const a = accountById(id)
  if (!a) throw Error('Choose an account first.')
  if (!isMappable(a)) throw Error(`${a.username || a.label} needs to be on a server before gameplay opens.`)
  focus(id)
  if (store.prefs.gameplayWindow === 'window') popOutGameplay(id)
  else update({ gameplay: id })
}
export function popOutGameplay (id) {
  window.open('/play/?id=' + encodeURIComponent(id), '_blank', 'noopener')
  update({ gameplay: null })
}
export const closeGameplay = () => update({ gameplay: null })

// Servers -------------------------------------------------------------------------------------
// The saved list lives in this browser. The backend has one active server: the one accounts join.

function saveServers (servers) {
  update({ servers })
  save('servers', servers)
}

export function upsertServer (entry) {
  const server = { id: entry.id || crypto.randomUUID(), name: entry.name.trim().slice(0, 48) || entry.host, host: entry.host.trim(), port: Number(entry.port), version: entry.version || '' }
  const exists = store.servers.some(s => s.id === server.id)
  saveServers(exists ? store.servers.map(s => s.id === server.id ? server : s) : [...store.servers, server])
  return server
}

export function deleteServer (server) {
  confirm({
    title: 'Delete server?',
    message: `“${server.name}” will be removed from your server list. Accounts already on it stay connected.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => saveServers(store.servers.filter(s => s.id !== server.id))
  })
}

export function moveServer (id, step) {
  const list = [...store.servers]
  const index = list.findIndex(s => s.id === id)
  const target = index + step
  if (index < 0 || target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target], list[index]]
  saveServers(list)
}

// Keep the server that accounts join visible in the list, without re-adding deleted ones each update.
let listedActive = null
export function syncActiveServer () {
  const active = activeServer()
  if (!active) return
  const key = serverKey(active.host, active.port)
  if (key === listedActive) return
  listedActive = key
  if (!store.servers.some(s => sameServer(s, active))) saveServers([{ id: crypto.randomUUID(), name: active.host, ...active }, ...store.servers])
}

// Makes this server the one accounts join next. Accounts already connected stay where they are.
export async function useServer (server) {
  const s = settings()
  await post('settings', { host: server.host, port: Number(server.port), version: server.version || '', reconnect: s.reconnect ?? false, joinDelay: s.joinDelay ?? 3000 })
}

export async function joinServer (server, ids) {
  if (!ids.length) throw Error('Choose which accounts should join.')
  const elsewhere = accounts().filter(a => ids.includes(a.id) && a.server && !sameServer(a.server, server))
  if (elsewhere.length) throw Error(`${elsewhere[0].username || elsewhere[0].label} is still on ${serverLabel(elsewhere[0].server)}. Disconnect it first.`)
  await useServer(server)
  await join(ids)
}

export async function saveConnection (patch) {
  const s = settings()
  if (!s.host) throw Error('Choose a server first.')
  await post('settings', { host: s.host, port: s.port, version: s.version, reconnect: s.reconnect, joinDelay: s.joinDelay, ...patch })
}

export async function pingServer (server) {
  const key = serverKey(server.host, server.port)
  const previous = store.pings[key]
  if (previous?.state === 'loading') return
  update(s => ({ pings: { ...s.pings, [key]: { ...previous, state: 'loading' } } }))
  try {
    const data = await post('ping', { host: server.host, port: Number(server.port) })
    const result = data.online ? { state: 'ok', data } : { state: 'error', error: data.error }
    update(s => ({ pings: { ...s.pings, [key]: { ...result, at: Date.now() } } }))
  } catch (error) {
    update(s => ({ pings: { ...s.pings, [key]: { state: 'error', error: error.message, at: Date.now() } } }))
  }
}

// Pings a server unless a recent result exists.
export function pingIfStale (server, age = 30000) {
  const ping = store.pings[serverKey(server.host, server.port)]
  if (!ping || (ping.state !== 'loading' && Date.now() - ping.at > age)) pingServer(server)
}
