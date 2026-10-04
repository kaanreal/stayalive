const http = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const { Manager } = require('./lib/manager')

function createServer (manager, port) {
  const streams = new Set()
  const broadcast = state => {
    const event = `data: ${JSON.stringify(state)}\n\n`
    for (const stream of streams) {
      if (stream.writableLength > 1024 * 1024) stream.destroy()
      else stream.write(event)
    }
  }
  manager.on('change', broadcast)
  const server = http.createServer(async (req, res) => {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    if (!hosts.includes(req.headers.host) || (req.headers.origin && !hosts.some(host => req.headers.origin === `http://${host}`))) {
      res.writeHead(403); res.end('Local access only.'); return
    }
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    res.setHeader('Cache-Control', 'no-store')
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    try {
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
        res.write(`data: ${JSON.stringify(manager.snapshot())}\n\n`)
        streams.add(res)
        req.on('close', () => streams.delete(res))
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, manager.snapshot())
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (req.headers['content-type'] !== 'application/json') throw Error('Send application/json.')
        let raw = ''
        for await (const chunk of req) {
          raw += chunk
          if (Buffer.byteLength(raw) > 65536) throw Error('Request is too large.')
        }
        const body = JSON.parse(raw)
        const ids = () => {
          if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100) throw Error('Select at least one account.')
          const result = [...new Set(body.ids)]
          result.forEach(id => manager.get(id))
          return result
        }
        switch (url.pathname) {
          case '/api/accounts': manager.add(body.text, body.auth); break
          case '/api/settings': manager.configure(body); break
          case '/api/login': {
            const a = manager.get(body.id)
            if (a.auth !== 'microsoft' || a.authPending || a.bot || a.desired) throw Error('Disconnect and finish any pending login first.')
            manager.login(body.id).catch(error => manager.log(null, error.message))
            break
          }
          case '/api/join': manager.joinMany(ids()); break
          case '/api/disconnect': ids().forEach(id => manager.disconnect(id)); break
          case '/api/route': manager.setRoute(ids(), body.route); break
          case '/api/actions': manager.setActions(ids(), body.actions); break
          case '/api/action': manager.action(ids(), body.action); break
          case '/api/remove': manager.remove(body.id); break
          default: return json(res, 404, { error: 'Unknown action.' })
        }
        return json(res, 200, { ok: true })
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] }
      if (req.method !== 'GET' || !files[url.pathname]) return json(res, 404, { error: 'Not found.' })
      const [file, type] = files[url.pathname]
      const data = await fs.readFile(path.join(__dirname, 'public', file))
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(data)
    } catch (error) { json(res, 400, { error: error.message }) }
  })
  server.on('close', () => { manager.off('change', broadcast); for (const stream of streams) stream.destroy() })
  server.requestTimeout = 15000
  return server
}

function json (res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3180)
  const manager = new Manager(path.join(__dirname, 'data'))
  const server = createServer(manager, port)
  const ticker = setInterval(() => manager.refresh(), 2000)
  server.on('error', error => { console.error(error.message); clearInterval(ticker); manager.close(); process.exitCode = 1 })
  server.listen(port, '127.0.0.1', () => console.log(`stayalive is ready at http://127.0.0.1:${port}\nKeep this terminal open while your accounts are connected.`))
  const close = () => {
    clearInterval(ticker)
    manager.close()
    server.close()
    setTimeout(() => process.exit(0), 1500).unref()
  }
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
}

module.exports = { createServer }
