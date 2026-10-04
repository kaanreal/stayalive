const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { soundManifest, soundFile } = require('../lib/sounds')

test('audio only fetches indexed Minecraft assets and checks their content hashes', async t => {
  const audio = Buffer.from('OggS-test-audio')
  const hash = data => createHash('sha1').update(data).digest('hex')
  const definitions = Buffer.from(JSON.stringify({
    click: { sounds: [{ name: 'random/click', volume: 0.5, weight: 2 }] },
    alias: { sounds: [{ name: 'click', type: 'event' }] },
    loop: { sounds: [{ name: 'loop', type: 'event' }] }
  }))
  const index = { objects: { 'minecraft/sounds.json': { hash: hash(definitions) }, 'minecraft/sounds/random/click.ogg': { hash: hash(audio), size: audio.length } } }
  let corrupt = true
  const urls = []
  t.mock.method(global, 'fetch', async url => {
    urls.push(url)
    let data
    if (url.endsWith('version_manifest_v2.json')) data = { versions: [{ id: '1.16.5', url: 'https://piston-meta.mojang.com/version.json' }] }
    else if (url.endsWith('/version.json')) data = { assetIndex: { url: 'https://piston-meta.mojang.com/index.json' } }
    else if (url.endsWith('/index.json')) data = index
    else if (url.endsWith(hash(definitions))) data = definitions
    else if (url.endsWith(hash(audio))) data = corrupt ? Buffer.from('wrong-content') : audio
    else throw Error('Unexpected download')
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data))
    return { ok: true, headers: { get: () => String(buffer.length) }, arrayBuffer: async () => buffer }
  })
  await assert.rejects(soundManifest('../../secrets'), /Invalid/)
  await assert.rejects(soundFile('a'.repeat(40)), /Unknown/)
  assert.equal(urls.length, 0)
  const bank = await soundManifest('1.16.5')
  assert.deepEqual(bank.alias, bank.click)
  assert.deepEqual(bank.loop, [])
  assert.equal(bank.click[0].volume, 0.5)
  await assert.rejects(soundFile(hash(audio)), /checksum/)
  corrupt = false
  assert.deepEqual(await soundFile(hash(audio)), audio)
  const before = urls.length
  assert.deepEqual(await soundFile(hash(audio)), audio)
  assert.equal(urls.length, before)
  assert.ok(urls.every(url => /^https:\/\/(piston-meta\.mojang\.com|resources\.download\.minecraft\.net)\//.test(url)))
})
