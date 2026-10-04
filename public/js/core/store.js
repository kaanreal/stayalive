// One small observable store. The App root subscribes; everything below reads `store` directly.
import { useEffect, useState } from '../lib/preact.js'
import { load } from './storage.js'
import { isOnline } from './format.js'

export const pages = ['play', 'multiplayer', 'accounts', 'map', 'routes', 'settings']
export const pageFromHash = () => {
  const page = location.hash.replace(/^#\/?/, '').split('/')[0]
  return pages.includes(page) ? page : 'play'
}

export const defaultPrefs = {
  reduceMotion: false,
  chunkGrid: true,
  mapPlayers: true,
  mapRoutes: true,
  mapWaypoints: true,
  mapLayer: 'surface',
  mapRadius: 24,
  spread: true,
  gameplayWindow: 'overlay',
  accountFilter: 'all',
  accountSort: 'status'
}

export const store = {
  snapshot: null, // latest server state: settings, versions, accounts, logs, memory
  link: 'connecting', // event stream: connecting, online, offline
  page: pageFromHash(),
  focusId: load('focus', null), // the account being controlled: map, gameplay, home
  selected: new Set(), // accounts that bulk commands apply to
  servers: load('servers', []),
  pings: {}, // serverKey -> { state, data, error, at }
  prefs: { ...defaultPrefs, ...load('prefs', {}) },
  waypoints: load('waypoints', []),
  draft: load('draft', { mode: 'loop', points: [] }),
  destination: null, // tile picked on the map
  mapData: null, // latest map response for the focused account
  picking: false, // map clicks send the selection somewhere
  toasts: [],
  modal: null, // { type, props }
  consoleOpen: false,
  unread: 0,
  lastSeenLog: null, // newest log time the console has shown
  gameplay: null // account id shown in the gameplay overlay
}

const listeners = new Set()
let frame = 0

export function update (patch) {
  Object.assign(store, typeof patch === 'function' ? patch(store) : patch)
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; for (const listener of listeners) listener() })
}

export function useStore () {
  const [, force] = useState(0)
  useEffect(() => {
    const listener = () => force(n => n + 1)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, [])
  return store
}

export const accounts = () => store.snapshot?.accounts || []
export const accountById = id => accounts().find(a => a.id === id) || null
export const settings = () => store.snapshot?.settings || {}
export const selectedAccounts = () => accounts().filter(a => store.selected.has(a.id))

export function focused () {
  const list = accounts()
  return list.find(a => a.id === store.focusId) || list.find(isOnline) || list[0] || null
}

// Bulk commands use the selection, or the controlled account when nothing is selected.
export function targets () {
  const chosen = selectedAccounts()
  if (chosen.length) return chosen
  const account = focused()
  return account ? [account] : []
}

export function activeServer () {
  const s = settings()
  return s.host ? { host: s.host, port: s.port, version: s.version } : null
}
