const { createHash } = require('node:crypto')

const banks = new Map()
const files = new Map()
const allowed = new Set()
let versions

async function download (url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error(`Minecraft audio download failed (${response.status}).`)
  if (Number(response.headers.get('content-length')) > limit) throw Error('Minecraft audio file is too large.')
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length > limit) throw Error('Minecraft audio file is too large.')
  return data
}

async function asset (hash, limit) {
  if (!/^[0-9a-f]{40}$/.test(hash)) throw Error('Invalid Minecraft asset hash.')
  const data = await download(`https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`, limit)
  if (createHash('sha1').update(data).digest('hex') !== hash) throw Error('Minecraft audio checksum failed.')
  return data
}

function soundManifest (version) {
  if (!/^1\.\d+(\.\d+)?$/.test(version)) return Promise.reject(Error('Invalid Minecraft audio version.'))
  if (banks.has(version)) return banks.get(version)
  const pending = (async () => {
    if (!versions) {
      versions = download('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', 2 * 1024 * 1024).then(data => JSON.parse(data))
      versions.catch(() => { versions = null })
    }
    const entry = (await versions).versions.find(entry => entry.id === version)
    if (!entry || !entry.url.startsWith('https://piston-meta.mojang.com/')) throw Error('Minecraft audio version not found.')
    const metadata = JSON.parse(await download(entry.url, 2 * 1024 * 1024))
    if (!/^https:\/\/(piston-meta|launchermeta)\.mojang\.com\//.test(metadata.assetIndex?.url || '')) throw Error('Invalid Minecraft audio index.')
    const index = JSON.parse(await download(metadata.assetIndex.url, 8 * 1024 * 1024))
    const definition = index.objects['minecraft/sounds.json']
    if (!definition) throw Error('Minecraft audio definitions not found.')
    const events = JSON.parse(await asset(definition.hash, 4 * 1024 * 1024))
    const resolve = (name, seen = new Set()) => {
      if (seen.has(name)) return []
      const next = new Set(seen).add(name)
      return (events[name]?.sounds || []).flatMap(sound => {
        const info = typeof sound === 'string' ? { name: sound } : sound
        if (info.type === 'event') return resolve(info.name.replace(/^minecraft:/, ''), next)
        const file = index.objects[`minecraft/sounds/${info.name.replace(/^minecraft:/, '')}.ogg`]
        if (!file || file.size > 4 * 1024 * 1024) return []
        allowed.add(file.hash)
        return [{ hash: file.hash, volume: info.volume ?? 1, pitch: info.pitch ?? 1, weight: info.weight ?? 1 }]
      })
    }
    const result = {}
    for (const name of Object.keys(events)) result[name] = resolve(name)
    return result
  })()
  banks.set(version, pending)
  pending.catch(() => banks.delete(version))
  if (banks.size > 8) banks.delete(banks.keys().next().value)
  return pending
}

function soundFile (hash) {
  if (!/^[0-9a-f]{40}$/.test(hash) || !allowed.has(hash)) return Promise.reject(Error('Unknown Minecraft sound.'))
  if (files.has(hash)) return files.get(hash)
  const pending = asset(hash, 4 * 1024 * 1024)
  files.set(hash, pending)
  pending.catch(() => files.delete(hash))
  if (files.size > 64) files.delete(files.keys().next().value)
  return pending
}

module.exports = { soundManifest, soundFile }
