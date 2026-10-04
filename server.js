const http = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const { Manager } = require('./lib/manager')
const { attachGameplay, playFile, skinFile } = require('./lib/play')
const { pingServer } = require('./lib/ping')
const { soundManifest, soundFile } = require('./lib/sounds')

const publicRoot = path.join(__dirname, 'public')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf' }
// Preact + htm as one browser module. htm's exports map hides the file, so resolve it from the package.
const preactBundle = path.join(path.dirname(require.resolve('htm')), '..', 'preact', 'standalone.module.js')
// three.js as a browser module, in the version prismarine-viewer's meshing worker is built for.
const threeModule = path.join(path.dirname(require.resolve('three', { paths: [path.dirname(require.resolve('prismarine-viewer'))] })), 'three.module.js')

// Client files live in fixed folders with lowercase names, so paths cannot escape public/.
function publicFile (pathname) {
  if (pathname === '/') return path.join(publicRoot, 'index.html')
  if (pathname === '/vendor/preact.js') return preactBundle
  if (pathname === '/vendor/three.js') return threeModule
  if (!/^\/(js|css|fonts)(\/[a-z0-9-]+)+\.(js|css|ttf)$/.test(pathname)) return null
  return path.join(publicRoot, pathname)
}

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
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    res.setHeader('Cache-Control', 'no-store')
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    try {
      const soundBank = /^\/play\/sounds\/(1\.\d+(?:\.\d+)?)\.json$/.exec(url.pathname)
      if (req.method === 'GET' && soundBank) {
        try { return json(res, 200, await soundManifest(soundBank[1])) } catch (error) { return json(res, 502, { error: error.message }) }
      }
      const sound = /^\/play\/sound\/([0-9a-f]{40})\.ogg$/.exec(url.pathname)
      if (req.method === 'GET' && sound) {
        const data = await soundFile(sound[1]).catch(() => null)
        if (!data) return json(res, 404, { error: 'Sound not found.' })
        res.writeHead(200, { 'Content-Type': 'audio/ogg', 'Cache-Control': 'public, max-age=604800, immutable' })
        res.end(data)
        return
      }
      const skin = /^\/play\/skin\/([0-9a-f]{16,80})\.png$/.exec(url.pathname)
      if (req.method === 'GET' && skin) {
        const data = await skinFile(skin[1]).catch(() => null)
        if (!data) return json(res, 404, { error: 'Skin not found.' })
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800, immutable' })
        res.end(data)
        return
      }
      if (req.method === 'GET' && url.pathname.startsWith('/play/')) {
        const file = playFile(url.pathname)
        if (!file) return json(res, 404, { error: 'Not found.' })
        // The meshing worker compiles block schemas at runtime.
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'self'; base-uri 'none'")
        if (url.pathname === '/play/') {
          res.setHeader('Referrer-Policy', 'same-origin')
        }
        // Only the meshing worker, textures and models from node_modules are cached.
        res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': ['/play/', '/play/mesher.js'].includes(url.pathname) ? 'no-store' : 'public, max-age=86400' })
        const stream = require('node:fs').createReadStream(file[0])
        stream.on('error', () => res.destroy())
        stream.pipe(res)
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
        res.write(`data: ${JSON.stringify(manager.snapshot())}\n\n`)
        streams.add(res)
        req.on('close', () => streams.delete(res))
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, manager.snapshot())
      if (req.method === 'GET' && url.pathname === '/api/map') return json(res, 200, manager.map(url.searchParams.get('id'), Number(url.searchParams.get('radius') || 24), url.searchParams.get('layer') || 'surface'))
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
          case '/api/map-walk': return json(res, 200, { point: manager.walkOnMap(body.id, body.x, body.z, body.layer) })
          case '/api/actions': manager.setActions(ids(), body.actions); break
          case '/api/action': manager.action(ids(), body.action); break
          case '/api/remove': manager.remove(body.id); break
          case '/api/ping': return json(res, 200, await pingServer(body))
          default: return json(res, 404, { error: 'Unknown action.' })
        }
        return json(res, 200, { ok: true })
      }
      const file = req.method === 'GET' && publicFile(url.pathname)
      if (!file) return json(res, 404, { error: 'Not found.' })
      const data = await fs.readFile(file).catch(() => null)
      if (!data) return json(res, 404, { error: 'Not found.' })
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] }); res.end(data)
    } catch (error) { json(res, 400, { error: error.message }) }
  })
  server.on('close', () => { manager.off('change', broadcast); for (const stream of streams) stream.destroy() })
  server.requestTimeout = 15000
  attachGameplay(server, manager, port)
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
