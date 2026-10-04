const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pingServer, motd } = require('../lib/ping')

test('MOTDs flatten legacy codes and chat components into colored runs', () => {
  assert.deepEqual(motd('§aGreen §lBold§r plain'), [
    { text: 'Green ', color: '#55ff55', bold: false, italic: false },
    { text: 'Bold', color: '#55ff55', bold: true, italic: false },
    { text: ' plain', color: null, bold: false, italic: false }
  ])
  assert.deepEqual(motd({ text: 'A ', color: 'gold', extra: [{ text: 'B', bold: true }, { text: 'C', color: '#12ABcd' }] }), [
    { text: 'A ', color: '#ffaa00', bold: false, italic: false },
    { text: 'B', color: '#ffaa00', bold: true, italic: false },
    { text: 'C', color: '#12abcd', bold: false, italic: false }
  ])
  assert.equal(motd('x'.repeat(500))[0].text.length, 300)
  assert.deepEqual(motd(undefined), [])
})

test('ping results are validated and normalized', async () => {
  const calls = []
  const fake = async options => {
    calls.push(options)
    return { version: { name: 'Paper 1.21.4', protocol: 769 }, players: { online: 12, max: 100 }, description: '§eHello', favicon: 'data:image/png;base64,AAAA', latency: 41.6 }
  }
  const result = await pingServer({ host: ' play.example.net ', port: 25565 }, fake)
  assert.equal(calls[0].host, 'play.example.net')
  assert.ok(calls[0].closeTimeout <= 6000)
  assert.deepEqual(result, { host: 'play.example.net', port: 25565, online: true, latency: 42, version: 'Paper 1.21.4', protocol: 769, players: { online: 12, max: 100 }, motd: [{ text: 'Hello', color: '#ffff55', bold: false, italic: false }], favicon: 'data:image/png;base64,AAAA' })
  const odd = await pingServer({ host: 'a.example', port: 1 }, async () => ({ players: { online: -1 }, favicon: 'javascript:alert(1)' }))
  assert.deepEqual(odd.players, { online: null, max: null })
  assert.equal(odd.favicon, null)
  await assert.rejects(pingServer({ host: 'https://a.example', port: 25565 }, fake), /hostname/)
  await assert.rejects(pingServer({ host: 'a.example', port: 70000 }, fake), /Port/)
  assert.deepEqual(await pingServer({ host: 'a.example', port: 25565 }, async () => { throw Object.assign(Error('connect'), { code: 'ECONNREFUSED' }) }), { host: 'a.example', port: 25565, online: false, error: 'Connection refused.' })
})
