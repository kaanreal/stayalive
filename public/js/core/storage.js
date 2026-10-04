// Browser storage for per-browser conveniences (server list, waypoints, layout).
// Storage can be unavailable, so every access falls back quietly.
const prefix = 'stayalive.'

export function load (key, fallback) {
  try {
    const value = localStorage.getItem(prefix + key)
    return value === null ? fallback : JSON.parse(value)
  } catch { return fallback }
}

export function save (key, value) {
  try { localStorage.setItem(prefix + key, JSON.stringify(value)) } catch {}
}

export function forget (key) {
  try { localStorage.removeItem(prefix + key) } catch {}
}
