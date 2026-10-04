// Shared vocabulary for account states, coordinates and servers.
export const ONLINE = new Set(['idle', 'walking', 'path blocked', 'manual', 'respawning'])
export const MAPPABLE = new Set(['idle', 'walking', 'path blocked', 'manual'])
export const BUSY = new Set(['queued', 'connecting', 'login required', 'signing in', 'reconnecting', 'respawning'])

// tone drives color: online, walking, control, busy, attention, warn, error, offline
const statuses = {
  idle: ['online', 'Online'],
  walking: ['walking', 'Walking'],
  manual: ['control', 'In gameplay'],
  'path blocked': ['warn', 'Path blocked'],
  respawning: ['warn', 'Respawning'],
  queued: ['busy', 'Queued'],
  connecting: ['busy', 'Connecting'],
  reconnecting: ['busy', 'Reconnecting'],
  'signing in': ['busy', 'Signing in'],
  'login required': ['attention', 'Sign-in needed'],
  'login failed': ['error', 'Login failed'],
  ready: ['offline', 'Offline'],
  disconnected: ['offline', 'Offline']
}

export function statusOf (a) {
  if (a.status === 'disconnected' && a.error) return { tone: 'error', label: 'Disconnected' }
  const [tone, label] = statuses[a.status] || ['offline', a.status]
  return { tone, label }
}

export const isOnline = a => ONLINE.has(a.status)
export const isMappable = a => MAPPABLE.has(a.status)
// Connected, connecting or signing in: the account cannot join, sign in or be removed.
export const isActive = a => ONLINE.has(a.status) || BUSY.has(a.status)
export const displayName = a => a.username || a.label

export function authOf (a) {
  if (a.auth === 'offline') return { tone: 'offline', label: 'Offline mode' }
  return a.username ? { tone: 'ok', label: 'Microsoft' } : { tone: 'attention', label: 'Not signed in' }
}

export const serverKey = (host, port) => `${String(host || '').toLowerCase()}:${port || 25565}`
export const serverLabel = s => !s?.host ? '' : Number(s.port) === 25565 ? s.host : `${s.host}:${s.port}`
export const sameServer = (a, b) => Boolean(a?.host && b?.host) && serverKey(a.host, a.port) === serverKey(b.host, b.port)

// "play.example.net", "play.example.net:25570", "[::1]:25565" or a bare IPv6 address.
export function parseAddress (text) {
  const value = String(text || '').trim()
  const bracket = /^\[(.+)\](?::(\d+))?$/.exec(value)
  if (bracket) return { host: bracket[1], port: bracket[2] ? Number(bracket[2]) : 25565 }
  const parts = value.split(':')
  if (parts.length === 2) return { host: parts[0].trim(), port: parts[1] === '' ? 25565 : Number(parts[1]) }
  return { host: value, port: 25565 }
}

const number = v => Number.isInteger(v) ? String(v) : v.toFixed(1)
export const coords = p => p ? `${number(p.x)} ${number(p.y)} ${number(p.z)}` : '—'
export const blockCoords = p => p ? `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}` : '—'
export const flatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

// Pathfinder walks and sprints; this stays a little under vanilla walking speed.
export const WALK_SPEED = 4.3
export function duration (seconds) {
  if (!Number.isFinite(seconds)) return '—'
  const s = Math.max(1, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}
export const eta = blocks => duration(blocks / WALK_SPEED)

// Minecraft yaw: 0 south, 90 west, 180 north, -90 east.
const compass = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
export const facing = yaw => compass[Math.round((((yaw % 360) + 360) % 360) / 45) % 8]

export function routeOf (a) {
  const { mode, points } = a.route
  if (mode === 'loop') return { mode, label: 'Patrol', detail: `Waypoint ${a.routeIndex + 1} of ${points.length}`, target: points[a.routeIndex] || points[0] }
  if (mode === 'goto') return { mode, label: 'Walk to', detail: coords(points[0]), target: points[0] }
  return { mode, label: 'Stay AFK', detail: a.actions?.antiAfk?.enabled ? `Anti-AFK every ${a.actions.antiAfk.interval}s` : 'Standing still', target: null }
}

export const time = iso => new Date(iso).toLocaleTimeString([], { hour12: false })
export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`
export const blockName = name => String(name || '').replaceAll('_', ' ')
