// Block → map color, loosely following vanilla map colors.
const dyes = { white: '#e4e7e7', orange: '#e57a23', magenta: '#b8489f', light_blue: '#4aa7d6', yellow: '#efc23a', lime: '#79b82a', pink: '#e48fab', gray: '#4a5053', light_gray: '#9a9a94', cyan: '#1f8a91', purple: '#7b33a8', blue: '#3a3f9e', brown: '#76502f', green: '#566f22', red: '#a3302b', black: '#1d1d21' }

const rules = [
  [/water|bubble_column|kelp|seagrass/, '#3f6fd8'],
  [/lava/, '#e4692a'],
  [/magma|fire/, '#c9532a'],
  [/blue_ice|packed_ice|^ice|frosted_ice/, '#9cc0f2'],
  [/powder_snow|snow/, '#f2f6f8'],
  [/red_sand|red_sandstone/, '#c4733a'],
  [/sand|end_stone|sandstone|bone_block/, '#d9cc92'],
  [/grass_block|moss|^grass$|short_grass|tall_grass|fern|lily_pad|vine/, '#7fb238'],
  [/azalea|leaves/, '#3a7f24'],
  [/mycelium/, '#7a6a7a'],
  [/podzol|rooted_dirt|coarse_dirt|dirt_path|dirt|mud|farmland|soul_soil/, '#966c4a'],
  [/clay/, '#a2a6b4'],
  [/terracotta/, '#9c5d3e'],
  [/crimson/, '#8a2c3a'],
  [/warped/, '#2a8a86'],
  [/netherrack|nether_brick|nether_wart/, '#7a2e2e'],
  [/soul_sand/, '#53402f'],
  [/obsidian|blackstone|basalt|bedrock/, '#2a272e'],
  [/deepslate|tuff/, '#55555c'],
  [/granite/, '#9a6c58'],
  [/diorite|calcite|quartz|birch/, '#d8d5cc'],
  [/log|wood|planks|chest|crafting|barrel|bookshelf|fence|door|trapdoor|stairs|slab|ladder/, '#8f7348'],
  [/glass/, '#b8d4d9'],
  [/gold_block/, '#f2cf4a'],
  [/iron_block|anvil|cauldron|hopper/, '#bfc4c8'],
  [/diamond_block/, '#5fdcd2'],
  [/emerald_block/, '#2fbf5a'],
  [/redstone_block/, '#b52a1f'],
  [/hay/, '#c9a52a'],
  [/pumpkin|melon/, '#d0802a'],
  [/cobble|stone|andesite|gravel|ore|furnace|bricks/, '#7b7b7b']
]

const cache = new Map()
export function blockColor (name) {
  if (cache.has(name)) return cache.get(name)
  let color = '#8a8f86'
  const dye = /^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_(wool|concrete|carpet|terracotta|glazed_terracotta|stained_glass|bed|banner|candle|shulker_box)/.exec(name)
  if (dye) color = dyes[dye[1]]
  else for (const [pattern, value] of rules) if (pattern.test(name)) { color = value; break }
  cache.set(name, color)
  return color
}

export const legend = [
  ['Grass', '#7fb238'], ['Foliage', '#3a7f24'], ['Water', '#3f6fd8'], ['Stone', '#7b7b7b'],
  ['Sand', '#d9cc92'], ['Dirt', '#966c4a'], ['Wood', '#8f7348'], ['Lava', '#e4692a'],
  ['Snow', '#f2f6f8'], ['Unloaded', '#1c201c']
]

const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const noise = (x, z) => {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// One pixel per block, shaded by the height of the block to the north like vanilla maps.
export function renderTerrain (data) {
  const { size, tiles, origin } = data
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(size, size)
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    const x = i % size
    const z = Math.floor(i / size)
    const o = i * 4
    if (!tile) {
      // Unloaded chunks: a dark checkerboard fixed to world coordinates.
      const dark = (origin.x + x + origin.z + z) % 2 === 0
      image.data.set(dark ? [28, 32, 28, 255] : [23, 26, 23, 255], o)
      continue
    }
    const [r, g, b] = rgb(blockColor(tile.block))
    const north = z > 0 ? tiles[i - size] : null
    const liquid = /water|lava/.test(tile.block)
    let shade = 1
    if (north && !liquid) shade = tile.height > north.height ? 1.1 : tile.height < north.height ? 0.8 : 0.94
    shade *= 0.96 + noise(origin.x + x, origin.z + z) * (liquid ? 0.06 : 0.1)
    image.data[o] = Math.min(255, r * shade)
    image.data[o + 1] = Math.min(255, g * shade)
    image.data[o + 2] = Math.min(255, b * shade)
    image.data[o + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export function tileAt (data, x, z) {
  if (!data) return null
  const ix = x - data.origin.x
  const iz = z - data.origin.z
  if (ix < 0 || iz < 0 || ix >= data.size || iz >= data.size) return null
  return data.tiles[iz * data.size + ix]
}

// Distinct standing spots around a target so a group doesn't pile onto one block.
export function spreadSpots (data, target, count) {
  const spots = [target]
  for (let r = 1; spots.length < count && r <= 5; r++) {
    for (let dz = -r; dz <= r && spots.length < count; dz++) {
      for (let dx = -r; dx <= r && spots.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const tile = tileAt(data, target.x + dx, target.z + dz)
        if (tile?.walkable && Math.abs(tile.y - target.y) <= 2) spots.push({ x: target.x + dx, y: tile.y, z: target.z + dz })
      }
    }
  }
  while (spots.length < count) spots.push(target)
  return spots
}
