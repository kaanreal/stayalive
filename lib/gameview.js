const fs = require('node:fs')
const path = require('node:path')
const { Vec3 } = require('vec3')
const { getVersion } = require('prismarine-viewer/viewer/lib/version')
const legacy = require('minecraft-data/minecraft-data/data/pc/common/legacy.json')

const assets = path.join(path.dirname(require.resolve('prismarine-viewer')), 'public')
// Versions before the flattening (1.8 to 1.12) have no block states the renderer understands:
// stairs, slabs, logs and colored blocks would vanish. They are rendered with 1.13 assets instead.
const LEGACY_RENDER = '1.13.2'

function parseState (text) {
  const match = /^minecraft:([a-z0-9_]+)(?:\[(.*)\])?$/.exec(text)
  const props = {}
  if (match[2]) {
    for (const pair of match[2].split(',')) {
      const [key, value] = pair.split('=')
      props[key] = value === 'true' ? true : value === 'false' ? false : /^\d+$/.test(value) ? Number(value) : value
    }
  }
  return [match[1], props]
}

const tables = new Map()
// Maps a pre-1.13 state id (id << 4 | metadata) to a 1.13.2 state id.
function legacyTable () {
  if (tables.has('legacy')) return tables.get('legacy')
  const Block = require('prismarine-block')(LEGACY_RENDER)
  const registry = require('minecraft-data')(LEGACY_RENDER)
  const table = new Int32Array(4096).fill(-1)
  for (let id = 0; id < 256; id++) {
    for (let meta = 0; meta < 16; meta++) {
      const state = legacy.blocks[`${id}:${meta}`] || legacy.blocks[`${id}:0`]
      if (!state) continue
      const [name, props] = parseState(state)
      const type = registry.blocksByName[name]
      if (!type) continue
      try {
        // Unlisted properties keep their defaults (otherwise stairs come out waterlogged).
        const defaults = Block.fromStateId(type.defaultState, 1).getProperties()
        table[(id << 4) | meta] = Block.fromProperties(name, { ...defaults, ...props }, 1).stateId
      } catch { table[(id << 4) | meta] = type.defaultState }
    }
  }
  tables.set('legacy', table)
  return table
}

function renderVersion (bot) {
  return bot.supportFeature('theFlattening') ? getVersion(bot.version) : LEGACY_RENDER
}

// Chat components and legacy § text both become § formatted strings, which the client's font draws.
const chats = new Map()
function chatFor (bot) {
  if (!chats.has(bot.version)) chats.set(bot.version, require('prismarine-chat')(bot.registry))
  return chats.get(bot.version)
}
function formatted (bot, value) {
  if (value == null) return ''
  if (typeof value.toMotd === 'function') return value.toMotd()
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/^\s*[{["]/.test(text)) { try { return chatFor(bot).fromNotch(text).toMotd() } catch {} }
  return text
}

// Item icons from the renderer's assets: legacy items are mapped to their modern names first.
const itemIndexes = new Map()
function itemIndex (version) {
  if (!itemIndexes.has(version)) {
    const index = new Map()
    try {
      for (const entry of JSON.parse(fs.readFileSync(path.join(assets, 'textures', version, 'items_textures.json'), 'utf8'))) {
        if (!entry.texture) continue
        const file = entry.texture.replace(/^item\//, 'items/').replace(/^block\//, 'blocks/')
        if (fs.existsSync(path.join(assets, 'textures', version, file + '.png'))) index.set(entry.name, { icon: `textures/${version}/${file}.png`, block: entry.texture.startsWith('block/') })
      }
    } catch {}
    itemIndexes.set(version, index)
  }
  return itemIndexes.get(version)
}
const modernName = (bot, item) => bot.supportFeature('theFlattening') ? item.name : (legacy.items[`${item.type}:${item.metadata}`] || legacy.items[`${item.type}:0`] || '').replace('minecraft:', '')

function itemIcon (bot, item) {
  return itemIndex(renderVersion(bot)).get(modernName(bot, item))?.icon || null
}

// Everything the client draws for an item: icon (or block model), name, lore, glint and durability.
function itemInfo (bot, item) {
  if (!item) return null
  const version = renderVersion(bot)
  const modern = modernName(bot, item)
  const entry = itemIndex(version).get(modern)
  const block = entry?.block ? require('minecraft-data')(version).blocksByName[modern] : null
  const max = bot.registry.items[item.type]?.maxDurability
  let lore = []
  let custom = null
  let enchanted = false
  try { lore = (item.customLore || []).map(line => formatted(bot, line)).slice(0, 16) } catch {}
  try { custom = item.customName ? formatted(bot, item.customName) : null } catch {}
  try { enchanted = Boolean(item.enchants?.length) } catch {}
  return {
    name: custom || item.displayName || item.name,
    id: item.name,
    count: item.count,
    icon: entry?.icon || null,
    block: block && block.boundingBox === 'block' ? modern : null,
    durability: max && item.durabilityUsed ? Math.max(0, 1 - item.durabilityUsed / max) : null,
    enchanted,
    lore
  }
}

// Worn armor by material, for the armor layers on player models.
function armorOf (bot, entity) {
  const slots = bot.supportFeature('doesntHaveOffHandSlot') ? { helmet: 4, chest: 3, legs: 2, boots: 1 } : { helmet: 5, chest: 4, legs: 3, boots: 2 }
  const armor = {}
  for (const [part, index] of Object.entries(slots)) {
    const item = entity.equipment?.[index]
    const match = item && /^(leather|chainmail|iron|golden|gold|diamond|netherite)_(helmet|chestplate|leggings|boots)$/.exec(item.name)
    if (!match) continue
    const color = item.nbt?.value?.display?.value?.color?.value
    armor[part] = { material: match[1] === 'golden' ? 'gold' : match[1], color: match[1] === 'leather' ? (Number.isInteger(color) ? color : 0xa06540) : null }
  }
  return armor
}

// 1.8 entity names are CamelCase; the models use modern snake_case names.
const entityNames = { PigZombie: 'zombified_piglin', LavaSlime: 'magma_cube', EntityHorse: 'horse', Ozelot: 'ocelot', VillagerGolem: 'iron_golem', MushroomCow: 'mooshroom', SnowMan: 'snow_golem', WitherBoss: 'wither', EnderDragon: 'ender_dragon', ThrownEnderpearl: 'ender_pearl', ThrownPotion: 'potion', ThrownExpBottle: 'experience_bottle', ThrownEgg: 'egg', FireworksRocketEntity: 'firework_rocket', XPOrb: 'experience_orb', PrimedTnt: 'tnt', MinecartRideable: 'minecart', Arrow: 'arrow', Item: 'item' }
const modelName = name => entityNames[name] || String(name || '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()

function customName (bot, entity) {
  const raw = entity.metadata?.[2]
  return raw == null || raw === '' ? '' : formatted(bot, raw)
}

// Player name tags use the team's prefix, color and suffix, and respect its visibility rule.
function nameTag (bot, entity) {
  const team = bot.teamMap?.[entity.username]
  if (team) {
    const mine = bot.teamMap?.[bot.username] === team
    const rule = team.nameTagVisibility
    if (rule === 'never' || (rule === 'hideForOtherTeams' && !mine) || (rule === 'hideForOwnTeam' && mine)) return ''
    try { return team.displayName(entity.username).toMotd() } catch {}
  }
  return entity.username
}

// Streams the world around one bot to one gameplay page: chunks nearest first, then entities and block changes.
class GameView {
  constructor (bot, socket, radius = 8) {
    this.bot = bot
    this.socket = socket
    this.radius = radius
    this.version = renderVersion(bot)
    this.legacy = !bot.supportFeature('theFlattening')
    this.table = this.legacy ? legacyTable() : null
    this.Chunk = this.legacy ? require('prismarine-chunk')(LEGACY_RENDER) : null
    this.sent = new Set()
    this.queue = []
    this.center = null
    this.skins = new Map()
    this.entities = new Set()
    this.listeners = {}
    this.closed = false
  }

  // The player's own skin, for the first-person hand and the inventory preview.
  self () {
    const me = this.bot.players[this.bot.username]
    const skin = me?.skinData
    return { skin: skin?.url ? String(skin.url).split('/').pop() : null, slim: skin ? skin.model === 'slim' : /[13579bdf]$/i.test(String(me?.uuid || '')), name: this.bot.username }
  }

  worldInfo (extra = {}) {
    const bot = this.bot
    const minY = bot.game.minY ?? 0
    return { version: this.version, legacy: this.legacy, radius: this.radius, minY, height: bot.game.height ?? 256, cloudHeight: minY < 0 ? 192 : 128, self: this.self(), ...extra }
  }

  start () {
    const bot = this.bot
    this.socket.emit('world', this.worldInfo())
    for (const player of Object.values(bot.players)) this.rememberSkin(player)
    const on = (event, fn) => { this.listeners[event] = fn; bot.on(event, fn) }
    on('chunkColumnLoad', pos => { if (this.wanted(pos.x >> 4, pos.z >> 4)) this.enqueue(pos.x >> 4, pos.z >> 4) })
    on('chunkColumnUnload', pos => this.unload(pos.x >> 4, pos.z >> 4))
    on('blockUpdate', (old, block) => {
      if (!block || !this.sent.has(`${block.position.x >> 4},${block.position.z >> 4}`)) return
      this.socket.emit('block', { x: block.position.x, y: block.position.y, z: block.position.z, stateId: this.translate(block.stateId ?? ((block.type << 4) | block.metadata)) })
    })
    on('move', () => this.recenter())
    on('respawn', () => { for (const key of this.sent) { const [x, z] = key.split(',').map(Number); this.unload(x, z) } this.center = null; this.recenter() })
    on('entitySpawn', e => this.sendEntity(e))
    on('entityUpdate', e => this.sendEntity(e))
    on('entityEquip', e => this.sendEntity(e))
    on('entityMoved', e => this.moveEntity(e))
    on('entityGone', e => { if (this.entities.delete(e.id)) this.socket.emit('entity', { id: e.id, delete: true }) })
    on('entitySwingArm', e => { if (this.entities.has(e.id)) this.socket.emit('entityEvent', { id: e.id, swing: true }) })
    on('entityHurt', e => { if (this.entities.has(e.id)) this.socket.emit('entityEvent', { id: e.id, hurt: true }) })
    on('playerJoined', player => this.rememberSkin(player))
    on('playerUpdated', player => {
      this.rememberSkin(player)
      if (player.username === bot.username) this.socket.emit('world', this.worldInfo({ keep: true }))
      if (player.entity) this.sendEntity(player.entity)
    })
    // Team changes alter name tags.
    const retag = () => { for (const e of Object.values(bot.entities)) if (e.type === 'player' && this.entities.has(e.id)) this.sendEntity(e) }
    for (const event of ['teamCreated', 'teamUpdated', 'teamMemberAdded', 'teamMemberRemoved', 'teamRemoved']) on(event, retag)
    this.recenter()
    for (const e of Object.values(bot.entities)) this.sendEntity(e)
    this.timer = setInterval(() => this.pump(), 16)
  }

  stop () {
    this.closed = true
    clearInterval(this.timer)
    for (const [event, fn] of Object.entries(this.listeners)) this.bot.off(event, fn)
  }

  setRadius (radius) {
    this.radius = radius
    this.socket.emit('world', this.worldInfo({ keep: true }))
    this.center = null
    this.recenter()
  }

  wanted (cx, cz) {
    const c = this.center
    return c && Math.max(Math.abs(cx - c[0]), Math.abs(cz - c[1])) <= this.radius
  }

  recenter () {
    const p = this.bot.entity?.position
    if (!p) return
    const cx = Math.floor(p.x) >> 4
    const cz = Math.floor(p.z) >> 4
    if (this.center && this.center[0] === cx && this.center[1] === cz) return
    this.center = [cx, cz]
    for (const key of [...this.sent]) {
      const [x, z] = key.split(',').map(Number)
      if (!this.wanted(x, z)) this.unload(x, z)
    }
    this.queue = this.queue.filter(([x, z]) => this.wanted(x, z))
    for (let r = 0; r <= this.radius; r++) {
      for (let x = -r; x <= r; x++) {
        for (let z = -r; z <= r; z++) {
          if (Math.max(Math.abs(x), Math.abs(z)) === r) this.enqueue(cx + x, cz + z)
        }
      }
    }
  }

  enqueue (x, z) {
    const key = `${x},${z}`
    if (this.sent.has(key) || this.queue.some(q => q[0] === x && q[1] === z)) return
    this.queue.push([x, z])
  }

  unload (x, z) {
    const key = `${x},${z}`
    if (!this.sent.delete(key)) return
    this.socket.emit('unloadChunk', { x: x * 16, z: z * 16 })
  }

  // A few columns per tick keeps the event loop and the socket responsive.
  pump () {
    if (this.closed || !this.queue.length || !this.center) return
    if (this.socket.conn?.transport?.writable === false) return
    const [cx, cz] = this.center
    this.queue.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz))
    let budget = 4
    while (budget > 0 && this.queue.length) {
      const [x, z] = this.queue.shift()
      const column = this.bot.world.getColumn(x, z)
      if (!column) continue
      this.socket.emit('chunk', { x: x * 16, z: z * 16, chunk: this.convert(column) })
      this.sent.add(`${x},${z}`)
      budget--
    }
  }

  translate (stateId) {
    if (!this.legacy) return stateId
    const mapped = this.table[stateId]
    if (mapped >= 0) return mapped
    const base = this.table[stateId & ~15]
    return base >= 0 ? base : 0
  }

  convert (column) {
    if (!this.legacy) return column.toJson()
    const out = new this.Chunk()
    const pos = new Vec3(0, 0, 0)
    for (let s = 0; s < 16; s++) {
      if (column.sections && !column.sections[s]) continue
      for (let y = s * 16; y < s * 16 + 16; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            pos.set(x, y, z)
            const id = column.getBlockStateId(pos)
            if (id) out.setBlockStateId(pos, this.translate(id))
          }
        }
      }
    }
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        pos.set(x, 0, z)
        try { out.setBiome(pos, column.getBiome(pos)) } catch {}
      }
    }
    return out.toJson()
  }

  rememberSkin (player) {
    if (player?.username && player.skinData?.url) this.skins.set(player.username, player.skinData)
  }

  near (e) {
    const p = this.bot.entity?.position
    return p && e.position && Math.hypot(e.position.x - p.x, e.position.z - p.z) < (this.radius + 1) * 16
  }

  sendEntity (e) {
    if (!e || e === this.bot.entity || !e.position) return
    if (!this.near(e)) {
      if (this.entities.delete(e.id)) this.socket.emit('entity', { id: e.id, delete: true })
      return
    }
    const bot = this.bot
    const flags = typeof e.metadata?.[0] === 'number' ? e.metadata[0] : 0
    const player = e.type === 'player' || e.name === 'player'
    const skin = player ? this.skins.get(e.username) || bot.players[e.username]?.skinData : null
    const uuid = player ? bot.players[e.username]?.uuid || e.uuid || '' : ''
    const model = player ? 'player' : modelName(e.name)
    let dropped = null
    if (model === 'item') { try { dropped = itemInfo(bot, e.getDroppedItem?.()) } catch {} }
    this.entities.add(e.id)
    this.socket.emit('entity', {
      id: e.id,
      model,
      label: player ? nameTag(bot, e) : (e.metadata?.[3] ? customName(bot, e) : ''),
      pos: { x: e.position.x, y: e.position.y, z: e.position.z },
      yaw: e.yaw,
      pitch: e.pitch,
      headYaw: e.headYaw ?? e.yaw,
      width: e.width,
      height: e.height,
      skin: skin?.url ? String(skin.url).split('/').pop() : null,
      // Default skins: Mojang picks Alex for UUIDs whose hash is odd.
      slim: skin ? skin.model === 'slim' : /[13579bdf]$/i.test(String(uuid)),
      invisible: Boolean(flags & 0x20),
      sneaking: Boolean(flags & 0x02),
      armor: armorOf(bot, e),
      held: itemInfo(bot, e.heldItem),
      item: dropped
    })
  }

  moveEntity (e) {
    if (!e || e === this.bot.entity) return
    if (!this.entities.has(e.id)) return this.sendEntity(e)
    if (!this.near(e)) return this.sendEntity(e)
    this.socket.volatile.emit('move', { id: e.id, x: e.position.x, y: e.position.y, z: e.position.z, yaw: e.yaw, pitch: e.pitch, headYaw: e.headYaw ?? e.yaw })
  }
}

module.exports = { GameView, renderVersion, itemIcon, itemInfo, formatted, legacyTable, modelName }
