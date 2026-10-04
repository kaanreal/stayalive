// Live state from the server-sent event stream, plus notifications that need attention.
import { store, update } from './store.js'
import { toast, navigate, syncActiveServer } from './actions.js'
import { ONLINE } from './format.js'

const codes = new Set()
const previous = new Map()

function notify (snapshot) {
  for (const a of snapshot.accounts) {
    const name = a.username || a.label
    if (a.code && !codes.has(a.code.userCode)) {
      codes.add(a.code.userCode)
      toast(`${name} needs Microsoft sign-in. Code ${a.code.userCode}`, 'warn', { label: 'Show', run: () => navigate('accounts') })
    }
    const before = previous.get(a.id)
    if (before && ONLINE.has(before) && a.status === 'disconnected' && a.error) toast(`${name} disconnected: ${a.error}`, 'error')
    if (before && !ONLINE.has(before) && ONLINE.has(a.status)) toast(`${name} joined the server.`, 'success')
    previous.set(a.id, a.status)
  }
}

function receive (snapshot) {
  const ids = new Set(snapshot.accounts.map(a => a.id))
  const selected = [...store.selected].filter(id => ids.has(id))
  const newest = snapshot.logs.at(-1)?.time || ''
  const seen = store.lastSeenLog === null || store.consoleOpen ? newest : store.lastSeenLog
  const unread = store.consoleOpen ? 0 : snapshot.logs.filter(log => log.time > seen).length
  if (store.snapshot) notify(snapshot)
  else snapshot.accounts.forEach(a => { previous.set(a.id, a.status); if (a.code) codes.add(a.code.userCode) })
  update({ snapshot, link: 'online', unread, lastSeenLog: seen, ...(selected.length !== store.selected.size ? { selected: new Set(selected) } : {}) })
  syncActiveServer()
}

export function connectEvents () {
  const source = new EventSource('/api/events')
  source.onmessage = event => receive(JSON.parse(event.data))
  source.onerror = () => update({ link: store.snapshot ? 'offline' : 'connecting' })
}
