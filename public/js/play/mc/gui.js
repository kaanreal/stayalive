// Shared Minecraft GUI pieces: textures, GUI scale, buttons, sliders, tooltips and item icons.
import { Font } from './font.js'

export function loadImage (url) {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

// Like the game's "Auto" GUI scale: the largest scale that keeps at least 320×240 GUI pixels.
export function guiScale (width, height) {
  let scale = 1
  while (width / (scale + 1) >= 320 && height / (scale + 1) >= 240) scale++
  return scale
}

export const rgb = (color, alpha = 1) => `rgba(${color >> 16 & 255},${color >> 8 & 255},${color & 255},${alpha})`
// Colors written as the game's ARGB integers, e.g. 0x80000000.
export const argb = value => `rgba(${value >>> 16 & 255},${value >>> 8 & 255},${value & 255},${((value >>> 24) & 255) / 255})`

export function gradient (ctx, x, y, w, h, top, bottom) {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, argb(top))
  g.addColorStop(1, argb(bottom))
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
}

const GRASS = 0x91bd59
const FOLIAGE = { spruce_leaves: 0x619961, birch_leaves: 0x80a755 }

export class Gui {
  constructor (legacy) {
    const base = `/play/textures/${legacy ? '1.8.8' : '1.16.4'}/`
    this.font = new Font(base + 'font/')
    this.textures = {}
    this.ready = Promise.all(['gui/widgets.png', 'gui/icons.png', 'gui/options_background.png', 'gui/container/inventory.png', 'gui/container/generic_54.png', 'gui/container/crafting_table.png', 'gui/container/furnace.png', 'gui/container/dispenser.png', 'gui/container/hopper.png', 'misc/enchanted_item_glint.png']
      .map(file => loadImage(base + file).then(image => { this.textures[file.split('/').pop().replace('.png', '')] = image })))
    this.icons = new Map()
    this.blocks = null
    this.atlas = null
  }

  // Block models and the block atlas, used to draw block items as small 3D blocks.
  setBlockAssets (version) {
    if (this.blockVersion === version) return
    this.blockVersion = version
    loadImage(`/play/textures/${version}.png`).then(image => { this.atlas = image; this.icons.clear() })
    fetch(`/play/blocksStates/${version}.json`).then(r => r.json()).then(json => { this.blocks = json; this.icons.clear() }).catch(() => {})
  }

  sprite (ctx, name, sx, sy, w, h, x, y, dw = w, dh = h) {
    const image = this.textures[name]
    if (image) ctx.drawImage(image, sx, sy, w, h, x, y, dw, dh)
  }

  // A 200×20 button from widgets.png, stretched from both ends like GuiButton.
  button (ctx, x, y, w, h, label, { hover, disabled } = {}) {
    const row = disabled ? 46 : hover ? 86 : 66
    this.sprite(ctx, 'widgets', 0, row, w / 2, h, x, y)
    this.sprite(ctx, 'widgets', 200 - w / 2, row, w / 2, h, x + w / 2, y)
    this.font.drawCentered(ctx, label, x + w / 2, y + (h - 8) / 2, disabled ? 0xa0a0a0 : hover ? 0xffffa0 : 0xe0e0e0, { shadow: true })
  }

  slider (ctx, x, y, w, h, label, value, hover) {
    this.sprite(ctx, 'widgets', 0, 46, w / 2, h, x, y)
    this.sprite(ctx, 'widgets', 200 - w / 2, 46, w / 2, h, x + w / 2, y)
    const knob = x + Math.round(value * (w - 8))
    this.sprite(ctx, 'widgets', 0, 66, 4, 20, knob, y)
    this.sprite(ctx, 'widgets', 196, 66, 4, 20, knob + 4, y)
    this.font.drawCentered(ctx, label, x + w / 2, y + (h - 8) / 2, hover ? 0xffffa0 : 0xe0e0e0, { shadow: true })
  }

  // The dirt background behind menus and loading screens.
  dirt (ctx, width, height) {
    const image = this.textures.options_background
    if (!image) { ctx.fillStyle = '#2a1f17'; ctx.fillRect(0, 0, width, height); return }
    for (let y = 0; y < height; y += 32) for (let x = 0; x < width; x += 32) ctx.drawImage(image, x, y, 32, 32)
    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    ctx.fillRect(0, 0, width, height)
  }

  // The purple-bordered item tooltip.
  tooltip (ctx, lines, mouseX, mouseY, screenW, screenH) {
    if (!lines.length) return
    const width = Math.max(...lines.map(line => this.font.width(line)))
    const height = 8 + (lines.length > 1 ? 2 + (lines.length - 1) * 10 : 0)
    let x = mouseX + 12
    let y = mouseY - 12
    if (x + width > screenW) x -= 28 + width
    if (y + height + 6 > screenH) y = screenH - height - 6
    const bg = argb(0xf0100010)
    ctx.fillStyle = bg
    ctx.fillRect(x - 3, y - 4, width + 6, 1); ctx.fillRect(x - 3, y + height + 3, width + 6, 1)
    ctx.fillRect(x - 3, y - 3, width + 6, height + 6)
    ctx.fillRect(x - 4, y - 3, 1, height + 6); ctx.fillRect(x + width + 3, y - 3, 1, height + 6)
    gradient(ctx, x - 3, y - 2, 1, height + 4, 0x505000ff, 0x5028007f)
    gradient(ctx, x + width + 2, y - 2, 1, height + 4, 0x505000ff, 0x5028007f)
    ctx.fillStyle = argb(0x505000ff); ctx.fillRect(x - 3, y - 3, width + 6, 1)
    ctx.fillStyle = argb(0x5028007f); ctx.fillRect(x - 3, y + height + 2, width + 6, 1)
    lines.forEach((line, i) => this.font.draw(ctx, i === 0 ? line : '§7' + line, x, y + (i === 0 ? 0 : 2 + i * 10), 0xffffff, { shadow: true }))
  }

  // 16×16 item icon: block items as isometric blocks from their model, other items flat.
  icon (item) {
    const key = `${item.block || ''}|${item.icon || ''}`
    if (this.icons.has(key)) return this.icons.get(key)
    this.icons.set(key, null)
    const done = canvas => { this.icons.set(key, canvas); return canvas }
    if (item.block && this.blocks && this.atlas) {
      const canvas = this.isometric(item.block)
      if (canvas) return done(canvas)
    }
    if (item.icon) {
      loadImage('/play/' + item.icon).then(image => {
        if (!image) return
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 16
        canvas.getContext('2d').drawImage(image, 0, 0, image.width, Math.min(image.height, image.width), 0, 0, 16, 16)
        done(canvas)
      })
    }
    return null
  }

  isometric (name) {
    const state = this.blocks[name]
    const first = state && (state.variants ? Object.values(state.variants)[0] : null)
    const model = (Array.isArray(first) ? first[0] : first)?.model
    if (!model?.elements?.length) return null
    const size = this.atlas.width
    const scale = 4
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 16 * scale
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    // Seen from the north-west and above, like the inventory: top, north (left) and west (right) faces.
    const project = ([x, y, z]) => [(8 - 0.5 * x + 0.5 * z) * scale, (16 - 0.25 * (x + z) - 0.5 * y) * scale]
    const tint = /grass|fern/.test(name) ? GRASS : FOLIAGE[name] ?? (/leaves|vine/.test(name) ? 0x77ab2f : null)
    const elements = [...model.elements].sort((a, b) => (b.from[0] + b.from[2]) - (a.from[0] + a.from[2]) || a.from[1] - b.from[1])
    for (const element of elements) {
      const [fx, fy, fz] = element.from
      const [tx, ty, tz] = element.to
      const faces = [
        ['north', [tx, ty, fz], [fx, ty, fz], [tx, fy, fz], 0.8],
        ['west', [fx, ty, fz], [fx, ty, tz], [fx, fy, fz], 0.6],
        ['up', [fx, ty, fz], [tx, ty, fz], [fx, ty, tz], 1]
      ]
      for (const [faceName, p0, p1, p2, light] of faces) {
        const face = element.faces?.[faceName]
        const uv = face && typeof face.texture === 'object' ? face.texture : null
        if (!uv) continue
        const source = this.faceTexture(uv, size, face.tintindex !== undefined ? tint : null, light)
        const [ax, ay] = project(p0); const [bx, by] = project(p1); const [cx, cy] = project(p2)
        ctx.setTransform((bx - ax) / 16, (by - ay) / 16, (cx - ax) / 16, (cy - ay) / 16, ax, ay)
        ctx.drawImage(source, 0, 0, 16, 16)
      }
    }
    return canvas
  }

  faceTexture (uv, size, tint, light) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 16
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.atlas, uv.u * size, uv.v * size, uv.su * size, uv.sv * size, 0, 0, 16, 16)
    const shade = tint ?? 0xffffff
    const r = (shade >> 16 & 255) * light; const g = (shade >> 8 & 255) * light; const b = (shade & 255) * light
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(0, 0, 16, 16)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(this.atlas, uv.u * size, uv.v * size, uv.su * size, uv.sv * size, 0, 0, 16, 16)
    return canvas
  }

  // An item in a slot: icon, enchantment glint, durability bar and stack size, like renderItemOverlayIntoGUI.
  item (ctx, item, x, y, now = performance.now()) {
    if (!item) return
    const icon = this.icon(item)
    if (icon) {
      ctx.drawImage(icon, x, y, 16, 16)
      if (item.enchanted) this.glint(ctx, icon, x, y, now)
    }
    if (item.durability != null && item.durability < 1) {
      const j = Math.round(13 * item.durability)
      const i = Math.round(255 * item.durability)
      ctx.fillStyle = '#000'; ctx.fillRect(x + 2, y + 13, 13, 2)
      ctx.fillStyle = `rgb(${(255 - i) >> 2},64,0)`; ctx.fillRect(x + 2, y + 13, 12, 1)
      ctx.fillStyle = `rgb(${255 - i},${i},0)`; ctx.fillRect(x + 2, y + 13, j, 1)
    }
    if (item.count > 1) {
      const text = String(item.count)
      this.font.draw(ctx, text, x + 19 - 2 - this.font.width(text), y + 9, 0xffffff, { shadow: true })
    }
  }

  glint (ctx, icon, x, y, now) {
    const texture = this.textures.enchanted_item_glint
    if (!texture) return
    this.glintCanvas ??= document.createElement('canvas')
    const canvas = this.glintCanvas
    canvas.width = canvas.height = 16
    const g = canvas.getContext('2d')
    g.drawImage(icon, 0, 0, 16, 16)
    g.globalCompositeOperation = 'source-atop'
    g.globalAlpha = 0.5
    const offset = (now / 30) % 64
    g.drawImage(texture, offset, 0, 64, 64, 0, 0, 16, 16)
    g.drawImage(texture, offset - 64, 0, 64, 64, 0, 0, 16, 16)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.65
    ctx.drawImage(canvas, x, y)
    ctx.restore()
  }
}
