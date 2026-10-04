// Minecraft's bitmap font, ported from FontRenderer (1.8): ascii.png glyphs with widths read from the pixels,
// unicode pages for everything else, § color and style codes, and the 25% drop shadow.
const CHARS = 'ÀÁÂÈÊËÍÓÔÕÚßãõğİıŒœŞşŴŵžȇ\u0000\u0000\u0000\u0000\u0000\u0000\u0000 !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u0000ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αβΓπΣσμτΦΘΩδ∞∅∈∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u0000'

// Color codes 0-f; shadows are the same colors at a quarter brightness.
export const COLORS = [0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xffaa00, 0xaaaaaa, 0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff]
export const shadowOf = color => (color & 0xfcfcfc) >> 2
export const stripCodes = text => String(text).replace(/§./g, '')

function loadImage (url) {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

function pixels (image) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  return { canvas, data: ctx.getImageData(0, 0, image.width, image.height).data }
}

export class Font {
  constructor (base) {
    this.base = base
    this.ascii = null
    this.widths = new Array(256).fill(0)
    this.pages = new Map() // page -> { canvas, spans } | null (missing) | Promise
    this.tints = new Map()
    this.onLoad = () => {}
    this.ready = loadImage(base + 'ascii.png').then(image => {
      if (!image) return
      const { canvas, data } = pixels(image)
      this.ascii = canvas
      const cell = image.width / 16
      for (let i = 0; i < 256; i++) {
        let column = cell - 1
        for (; column >= 0; column--) {
          let filled = false
          for (let row = 0; row < cell && !filled; row++) filled = data[(((i >> 4) * cell + row) * image.width + (i & 15) * cell + column) * 4 + 3] > 0
          if (filled) break
        }
        this.widths[i] = Math.round((column + 1) * 8 / cell) + 1
      }
      this.widths[32] = 4
      this.onLoad()
    })
  }

  page (n) {
    if (this.pages.has(n)) { const p = this.pages.get(n); return p instanceof Promise ? null : p }
    const loading = loadImage(`${this.base}unicode_page_${n.toString(16).padStart(2, '0')}.png`).then(image => {
      if (!image) { this.pages.set(n, null); return }
      const { canvas, data } = pixels(image)
      const cell = image.width / 16
      // Left and right edge of every glyph, like glyph_sizes.bin.
      const spans = new Array(256)
      for (let i = 0; i < 256; i++) {
        let left = -1; let right = -1
        for (let x = 0; x < cell; x++) {
          for (let y = 0; y < cell; y++) {
            if (data[(((i >> 4) * cell + y) * image.width + (i & 15) * cell + x) * 4 + 3] > 0) { if (left < 0) left = x; right = x; break }
          }
        }
        spans[i] = left < 0 ? [0, 0] : [left, right + 1]
      }
      this.pages.set(n, { canvas, spans, cell })
      this.onLoad()
    })
    this.pages.set(n, loading)
    return null
  }

  glyph (char) {
    if (char === ' ') return { kind: 'space', advance: 4 }
    const index = CHARS.indexOf(char)
    if (index > 0 && char !== '\u0000') return { kind: 'ascii', index, advance: this.widths[index] }
    const code = char.codePointAt(0)
    if (code > 0xffff) return { kind: 'space', advance: 4 }
    const page = this.page(code >> 8)
    if (!page) return { kind: 'space', advance: 4 }
    const [left, right] = page.spans[code & 255]
    return { kind: 'unicode', page, index: code & 255, left, right, advance: (right - left) / 2 + 1 }
  }

  tinted (source, color) {
    const key = source
    let byColor = this.tints.get(key)
    if (!byColor) { byColor = new Map(); this.tints.set(key, byColor) }
    if (!byColor.has(color)) {
      const canvas = document.createElement('canvas')
      canvas.width = source.width
      canvas.height = source.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(source, 0, 0)
      ctx.globalCompositeOperation = 'source-in'
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      byColor.set(color, canvas)
    }
    return byColor.get(color)
  }

  // Width in GUI pixels, ignoring formatting codes.
  width (text) {
    let width = 0
    let bold = false
    const s = String(text)
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '§' && i + 1 < s.length) {
        const code = s[i + 1].toLowerCase()
        if (code === 'l') bold = true
        else if (code === 'r' || '0123456789abcdef'.includes(code)) bold = false
        i++
        continue
      }
      width += this.glyph(s[i]).advance + (bold ? 1 : 0)
    }
    return width
  }

  // Splits text to lines no wider than width, carrying formatting over line breaks.
  wrap (text, width) {
    const lines = []
    for (const paragraph of String(text).split('\n')) {
      let line = ''
      let format = ''
      let lineFormat = ''
      for (const word of paragraph.split(/(?<= )/)) {
        if (line && this.width(line + word) > width) { lines.push(lineFormat + line.trimEnd()); line = ''; lineFormat = format }
        for (const match of word.matchAll(/§([0-9a-fk-or])/gi)) format = '0123456789abcdefr'.includes(match[1].toLowerCase()) ? `§${match[1]}` : format + `§${match[1]}`
        line += word
      }
      lines.push(lineFormat + line)
    }
    return lines
  }

  draw (ctx, text, x, y, color = 0xffffff, { shadow = false, alpha = 1 } = {}) {
    if (!this.ascii) return 0
    if (shadow) this.render(ctx, text, x + 1, y + 1, color, alpha, true)
    return this.render(ctx, text, x, y, color, alpha, false)
  }

  drawCentered (ctx, text, x, y, color, options) {
    return this.draw(ctx, text, Math.round(x - this.width(text) / 2), y, color, options)
  }

  render (ctx, text, x, y, base, alpha, isShadow) {
    const s = String(text)
    let color = isShadow ? shadowOf(base) : base
    let bold = false; let italic = false; let underline = false; let strike = false; let random = false
    const start = x
    ctx.save()
    ctx.globalAlpha *= alpha
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '§' && i + 1 < s.length) {
        const code = s[i + 1].toLowerCase()
        const c = '0123456789abcdef'.indexOf(code)
        if (c >= 0) { color = isShadow ? shadowOf(COLORS[c]) : COLORS[c]; bold = italic = underline = strike = random = false } else if (code === 'k') random = true
        else if (code === 'l') bold = true
        else if (code === 'm') strike = true
        else if (code === 'n') underline = true
        else if (code === 'o') italic = true
        else if (code === 'r') { color = isShadow ? shadowOf(base) : base; bold = italic = underline = strike = random = false }
        i++
        continue
      }
      let glyph = this.glyph(s[i])
      if (random && glyph.kind === 'ascii') {
        const same = []
        for (let k = 0; k < 256; k++) if (this.widths[k] === glyph.advance && CHARS[k] !== '\u0000') same.push(k)
        if (same.length) glyph = { ...glyph, index: same[Math.floor(Math.random() * same.length)] }
      }
      const passes = bold ? [0, 1] : [0]
      for (const dx of passes) this.glyphAt(ctx, glyph, x + dx, y, color, italic)
      const advance = glyph.advance + (bold ? 1 : 0)
      if (strike || underline) {
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
        if (strike) ctx.fillRect(x, y + 3.5, advance, 1)
        if (underline) ctx.fillRect(x - 1, y + 8, advance, 1)
      }
      x += advance
    }
    ctx.restore()
    return x - start
  }

  glyphAt (ctx, glyph, x, y, color, italic) {
    if (glyph.kind === 'space') return
    if (italic) { ctx.save(); ctx.transform(1, 0, -0.25, 1, x + 1, y); x = 0; y = 0 }
    if (glyph.kind === 'ascii') {
      const cell = this.ascii.width / 16
      ctx.drawImage(this.tinted(this.ascii, color), (glyph.index & 15) * cell, (glyph.index >> 4) * cell, cell, cell, x, y, 8, 8)
    } else {
      const { page, index, left, right } = glyph
      const scale = 8 / page.cell
      ctx.drawImage(this.tinted(page.canvas, color), (index & 15) * page.cell + left, (index >> 4) * page.cell, right - left, page.cell, x, y, (right - left) * scale, 8)
    }
    if (italic) ctx.restore()
  }
}
