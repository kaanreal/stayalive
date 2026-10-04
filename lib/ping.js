const mc = require('minecraft-protocol')

// Chat color names in the order of their legacy § codes 0-f.
const colors = { black: '#000000', dark_blue: '#0000aa', dark_green: '#00aa00', dark_aqua: '#00aaaa', dark_red: '#aa0000', dark_purple: '#aa00aa', gold: '#ffaa00', gray: '#aaaaaa', dark_gray: '#555555', blue: '#5555ff', green: '#55ff55', aqua: '#55ffff', red: '#ff5555', light_purple: '#ff55ff', yellow: '#ffff55', white: '#ffffff' }
const codes = Object.values(colors)

function validateTarget (input) {
  const host = String(input?.host || '').trim()
  const port = Number(input?.port)
  if (!host || host.length > 253 || /[\s/\\]/.test(host)) throw Error('Enter a server hostname or IP, without a port or URL.')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Port must be between 1 and 65535.')
  return { host, port }
}

// Flattens a status description (legacy § codes or chat components) into styled text runs.
function motd (description) {
  const runs = []
  let length = 0
  const push = (text, style) => {
    if (!text || length >= 300) return
    text = text.slice(0, 300 - length)
    length += text.length
    const last = runs[runs.length - 1]
    if (last && last.color === style.color && last.bold === style.bold && last.italic === style.italic) last.text += text
    else runs.push({ text, ...style })
  }
  const legacy = (text, base) => {
    const parts = String(text).split('§')
    let style = { ...base }
    push(parts[0], style)
    for (const part of parts.slice(1)) {
      const code = part.charAt(0).toLowerCase()
      const index = '0123456789abcdef'.indexOf(code)
      if (index >= 0) style = { color: codes[index], bold: false, italic: false }
      else if (code === 'l') style = { ...style, bold: true }
      else if (code === 'o') style = { ...style, italic: true }
      else if (code === 'r') style = { ...base }
      push(part.slice(1), style)
    }
  }
  const flag = (value, fallback) => value === undefined ? fallback : value === true || value === 'true'
  const walk = (node, base, depth) => {
    if (depth > 8) return
    if (typeof node === 'string') return legacy(node, base)
    if (Array.isArray(node)) return node.forEach(child => walk(child, base, depth + 1))
    if (!node || typeof node !== 'object') return
    const color = colors[node.color] || (/^#[0-9a-f]{6}$/i.test(node.color) ? node.color.toLowerCase() : base.color)
    const style = { color, bold: flag(node.bold, base.bold), italic: flag(node.italic, base.italic) }
    if (typeof node.text === 'string') legacy(node.text, style)
    if (Array.isArray(node.extra)) node.extra.forEach(child => walk(child, style, depth + 1))
  }
  walk(description, { color: null, bold: false, italic: false }, 0)
  return runs
}

function reason (error) {
  const code = `${error.code || ''} ${error.message || ''}`
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'Unknown host.'
  if (/ECONNREFUSED/.test(code)) return 'Connection refused.'
  if (/ETIMEDOUT|timed? ?out/i.test(code)) return 'The server did not answer in time.'
  if (/ECONNRESET|closed/i.test(code)) return 'The server closed the connection.'
  return error.message || 'Ping failed.'
}

// Reads a server's status (version, players, MOTD, icon) without logging in.
// An unreachable server is a normal answer, so it resolves with online: false.
async function pingServer (input, ping = mc.ping) {
  const { host, port } = validateTarget(input)
  let data
  try {
    data = await ping({ host, port, closeTimeout: 6000, noPongTimeout: 3000 })
  } catch (error) { return { host, port, online: false, error: reason(error) } }
  const count = value => Number.isInteger(value) && value >= 0 ? value : null
  const favicon = typeof data?.favicon === 'string' && data.favicon.length < 100000 && /^data:image\/png;base64,[a-z0-9+/=\s]+$/i.test(data.favicon) ? data.favicon.replace(/\s/g, '') : null
  return {
    host,
    port,
    online: true,
    latency: Number.isFinite(data?.latency) ? Math.round(data.latency) : null,
    version: typeof data?.version?.name === 'string' ? data.version.name.slice(0, 80) : null,
    protocol: count(data?.version?.protocol),
    players: { online: count(data?.players?.online), max: count(data?.players?.max) },
    motd: motd(data?.description),
    favicon
  }
}

module.exports = { pingServer, motd, validateTarget }
