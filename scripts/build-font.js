// Builds public/fonts/stayalive-pixel.ttf from the glyph art below.
// Run with: node scripts/build-font.js
// Each glyph is drawn on a pixel grid. Rows 0-6 sit above the baseline, rows 7+ hang below it.
// Lowercase letters reuse the capitals, so the font always reads as small caps.
const fs = require('node:fs')
const path = require('node:path')

const glyphs = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['....#', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['...'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '"': ['#.#', '#.#'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  "'": ['#', '#'],
  '(': ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  ')': ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'],
  '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  ',': ['.', '.', '.', '.', '.', '#', '#', '#'],
  '-': ['....', '....', '....', '####', '....', '....', '....'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  ':': ['.', '#', '.', '.', '.', '#', '.'],
  ';': ['.', '#', '.', '.', '.', '#', '#', '#'],
  '<': ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '>': ['#...', '.#..', '..#.', '...#', '..#.', '.#..', '#...'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.###.'],
  '[': ['###', '#..', '#..', '#..', '#..', '#..', '###'],
  '\\': ['#....', '#....', '.#...', '..#..', '...#.', '....#', '....#'],
  ']': ['###', '..#', '..#', '..#', '..#', '..#', '###'],
  '^': ['..#..', '.#.#.', '#...#'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '`': ['#.', '.#'],
  '{': ['..##', '.#..', '.#..', '#...', '.#..', '.#..', '..##'],
  '|': ['#', '#', '#', '#', '#', '#', '#'],
  '}': ['##..', '..#.', '..#.', '...#', '..#.', '..#.', '##..'],
  '~': ['.....', '.....', '.#...', '#.#.#', '...#.', '.....', '.....'],
  '°': ['.#.', '#.#', '.#.'],
  '·': ['.', '.', '.', '#'],
  '×': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
  '•': ['...', '...', '###', '###', '###'],
  '…': ['.....', '.....', '.....', '.....', '.....', '.....', '#.#.#'],
  '←': ['.....', '..#..', '.#...', '#####', '.#...', '..#..', '.....'],
  '↑': ['..#..', '.###.', '#.#.#', '..#..', '..#..', '..#..', '..#..'],
  '→': ['.....', '..#..', '...#.', '#####', '...#.', '..#..', '.....'],
  '↓': ['..#..', '..#..', '..#..', '..#..', '#.#.#', '.###.', '..#..']
}

const PIXEL = 128 // font units per pixel
const EM = 1024 // 8 pixels per em
const ASCENT = 9 * PIXEL
const DESCENT = 2 * PIXEL

// Merge each row's horizontal runs into rectangles, then draw them clockwise.
function outline (art) {
  const width = Math.max(...art.map(row => row.length))
  const contours = []
  art.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '#') continue
      let end = c
      while (row[end + 1] === '#') end++
      const x0 = c * PIXEL
      const x1 = (end + 1) * PIXEL
      const y0 = (6 - r) * PIXEL
      const y1 = (7 - r) * PIXEL
      contours.push([[x0, y0], [x0, y1], [x1, y1], [x1, y0]])
      c = end
    }
  })
  return { width, contours, advance: (width + 1) * PIXEL }
}

const notdef = outline(['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'])
const list = [{ name: '.notdef', codes: [], ...notdef }]
for (const [char, art] of Object.entries(glyphs)) {
  const codes = [char.codePointAt(0)]
  if (/^[A-Z]$/.test(char)) codes.push(char.toLowerCase().codePointAt(0))
  if (char === ' ') codes.push(0xa0)
  list.push({ name: char, codes, ...outline(art) })
}

function glyphData (glyph) {
  if (!glyph.contours.length) return { bytes: Buffer.alloc(0), bbox: [0, 0, 0, 0], points: 0 }
  const points = glyph.contours.flat()
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  const size = 10 + glyph.contours.length * 2 + 2 + points.length * 5
  const b = Buffer.alloc(size + (4 - size % 4) % 4)
  let o = 0
  o = b.writeInt16BE(glyph.contours.length, o)
  for (const v of bbox) o = b.writeInt16BE(v, o)
  let end = -1
  for (const contour of glyph.contours) { end += contour.length; o = b.writeUInt16BE(end, o) }
  o = b.writeUInt16BE(0, o) // no instructions
  for (let i = 0; i < points.length; i++) o = b.writeUInt8(1, o) // on-curve, 16-bit deltas
  let prev = 0
  for (const [x] of points) { o = b.writeInt16BE(x - prev, o); prev = x }
  prev = 0
  for (const [, y] of points) { o = b.writeInt16BE(y - prev, o); prev = y }
  return { bytes: b, bbox, points: points.length }
}

const built = list.map(glyph => ({ ...glyph, ...glyphData(glyph) }))
const boxes = built.filter(g => g.contours.length).map(g => g.bbox)
const fontBox = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))]

function table (size, write) { const b = Buffer.alloc(size); write(b); return b }

const glyf = Buffer.concat(built.map(g => g.bytes))
const offsets = []
let offset = 0
for (const g of built) { offsets.push(offset); offset += g.bytes.length }
offsets.push(offset)
const loca = table(offsets.length * 4, b => offsets.forEach((v, i) => b.writeUInt32BE(v, i * 4)))

const hmtx = table(built.length * 4, b => built.forEach((g, i) => { b.writeUInt16BE(g.advance, i * 4); b.writeInt16BE(g.bbox[0], i * 4 + 2) }))

const head = table(54, b => {
  b.writeUInt32BE(0x00010000, 0)
  b.writeUInt32BE(0x00010000, 4)
  b.writeUInt32BE(0, 8) // checkSumAdjustment, filled in below
  b.writeUInt32BE(0x5f0f3cf5, 12)
  b.writeUInt16BE(0x0009, 16)
  b.writeUInt16BE(EM, 18)
  b.writeBigInt64BE(3870000000n, 20)
  b.writeBigInt64BE(3870000000n, 28)
  fontBox.forEach((v, i) => b.writeInt16BE(v, 36 + i * 2))
  b.writeUInt16BE(0, 44)
  b.writeUInt16BE(8, 46)
  b.writeInt16BE(2, 48)
  b.writeInt16BE(1, 50) // long loca offsets
  b.writeInt16BE(0, 52)
})

const hhea = table(36, b => {
  b.writeUInt32BE(0x00010000, 0)
  b.writeInt16BE(ASCENT, 4)
  b.writeInt16BE(-DESCENT, 6)
  b.writeInt16BE(0, 8)
  b.writeUInt16BE(Math.max(...built.map(g => g.advance)), 10)
  b.writeInt16BE(Math.min(...built.map(g => g.bbox[0])), 12)
  b.writeInt16BE(Math.min(...built.map(g => g.advance - g.bbox[2])), 14)
  b.writeInt16BE(Math.max(...built.map(g => g.bbox[2])), 16)
  b.writeInt16BE(1, 18)
  b.writeInt16BE(0, 20)
  b.writeUInt16BE(built.length, 34)
})

const maxp = table(32, b => {
  b.writeUInt32BE(0x00010000, 0)
  b.writeUInt16BE(built.length, 4)
  b.writeUInt16BE(Math.max(...built.map(g => g.points)), 6)
  b.writeUInt16BE(Math.max(...built.map(g => g.contours.length)), 8)
  b.writeUInt16BE(2, 14) // maxZones
})

const codes = built.flatMap((g, id) => g.codes.map(code => [code, id])).sort((a, b) => a[0] - b[0])

const os2 = table(96, b => {
  b.writeUInt16BE(4, 0)
  b.writeInt16BE(Math.round(built.reduce((sum, g) => sum + g.advance, 0) / built.length), 2)
  b.writeUInt16BE(400, 4)
  b.writeUInt16BE(5, 6)
  b.writeUInt16BE(0, 8) // installable embedding
  b.writeInt16BE(5 * PIXEL, 10); b.writeInt16BE(5 * PIXEL, 12); b.writeInt16BE(0, 14); b.writeInt16BE(PIXEL, 16)
  b.writeInt16BE(5 * PIXEL, 18); b.writeInt16BE(5 * PIXEL, 20); b.writeInt16BE(0, 22); b.writeInt16BE(4 * PIXEL, 24)
  b.writeInt16BE(PIXEL, 26)
  b.writeInt16BE(3 * PIXEL, 28)
  b.writeUInt32BE(0b11, 42) // Basic Latin, Latin-1 Supplement
  b.writeUInt32BE(1 << 5, 46) // Arrows
  b.write('SALV', 58, 'latin1')
  b.writeUInt16BE(0x0040, 62) // regular
  b.writeUInt16BE(codes[0][0], 64)
  b.writeUInt16BE(Math.min(0xffff, codes[codes.length - 1][0]), 66)
  b.writeInt16BE(ASCENT, 68)
  b.writeInt16BE(-DESCENT, 70)
  b.writeInt16BE(0, 72)
  b.writeUInt16BE(ASCENT, 74)
  b.writeUInt16BE(DESCENT, 76)
  b.writeUInt32BE(1, 78) // Latin 1 code page
  b.writeInt16BE(7 * PIXEL, 86)
  b.writeInt16BE(7 * PIXEL, 88)
  b.writeUInt16BE(0, 90)
  b.writeUInt16BE(32, 92)
  b.writeUInt16BE(1, 94)
})

// cmap format 4 with one segment per code point, followed by the required 0xFFFF segment.
const segments = [...codes.map(([code, id]) => ({ start: code, end: code, delta: (id - code + 65536) % 65536 })), { start: 0xffff, end: 0xffff, delta: 1 }]
const segCount = segments.length
const power = 2 ** Math.floor(Math.log2(segCount))
const sub = table(16 + segCount * 8, b => {
  b.writeUInt16BE(4, 0)
  b.writeUInt16BE(16 + segCount * 8, 2)
  b.writeUInt16BE(0, 4)
  b.writeUInt16BE(segCount * 2, 6)
  b.writeUInt16BE(power * 2, 8)
  b.writeUInt16BE(Math.log2(power), 10)
  b.writeUInt16BE(segCount * 2 - power * 2, 12)
  let o = 14
  for (const s of segments) o = b.writeUInt16BE(s.end, o)
  o = b.writeUInt16BE(0, o)
  for (const s of segments) o = b.writeUInt16BE(s.start, o)
  for (const s of segments) o = b.writeUInt16BE(s.delta, o)
  for (let i = 0; i < segCount; i++) o = b.writeUInt16BE(0, o)
})
const cmap = Buffer.concat([table(12, b => { b.writeUInt16BE(0, 0); b.writeUInt16BE(1, 2); b.writeUInt16BE(3, 4); b.writeUInt16BE(1, 6); b.writeUInt32BE(12, 8) }), sub])

const names = [[0, 'Generated for StayAlive. Free to use with this project.'], [1, 'StayAlive Pixel'], [2, 'Regular'], [3, 'StayAlive Pixel Regular 1.000'], [4, 'StayAlive Pixel'], [5, 'Version 1.000'], [6, 'StayAlivePixel-Regular']]
const strings = names.map(([, text]) => Buffer.from(text, 'utf16le').swap16())
const name = Buffer.concat([table(6 + names.length * 12, b => {
  b.writeUInt16BE(0, 0)
  b.writeUInt16BE(names.length, 2)
  b.writeUInt16BE(6 + names.length * 12, 4)
  let stringOffset = 0
  names.forEach(([id], i) => {
    const o = 6 + i * 12
    b.writeUInt16BE(3, o); b.writeUInt16BE(1, o + 2); b.writeUInt16BE(0x409, o + 4); b.writeUInt16BE(id, o + 6)
    b.writeUInt16BE(strings[i].length, o + 8); b.writeUInt16BE(stringOffset, o + 10)
    stringOffset += strings[i].length
  })
}), ...strings])

const post = table(32, b => { b.writeUInt32BE(0x00030000, 0); b.writeInt16BE(-PIXEL, 8); b.writeInt16BE(PIXEL, 10) })

const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post }
const tags = Object.keys(tables).sort()
const checksum = buffer => {
  const padded = Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4)])
  let sum = 0
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0
  return sum
}
const tablePower = 2 ** Math.floor(Math.log2(tags.length))
const directory = Buffer.alloc(12 + tags.length * 16)
directory.writeUInt32BE(0x00010000, 0)
directory.writeUInt16BE(tags.length, 4)
directory.writeUInt16BE(tablePower * 16, 6)
directory.writeUInt16BE(Math.log2(tablePower), 8)
directory.writeUInt16BE(tags.length * 16 - tablePower * 16, 10)
let position = directory.length
const body = []
tags.forEach((tag, i) => {
  const data = tables[tag]
  const o = 12 + i * 16
  directory.write(tag, o, 'latin1')
  directory.writeUInt32BE(checksum(data), o + 4)
  directory.writeUInt32BE(position, o + 8)
  directory.writeUInt32BE(data.length, o + 12)
  const padded = Buffer.concat([data, Buffer.alloc((4 - data.length % 4) % 4)])
  body.push(padded)
  position += padded.length
})
const font = Buffer.concat([directory, ...body])
const headOffset = directory.readUInt32BE(12 + tags.indexOf('head') * 16 + 8)
font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8)

const out = path.join(__dirname, '..', 'public', 'fonts', 'stayalive-pixel.ttf')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, font)
console.log(`Wrote ${path.relative(process.cwd(), out)} (${built.length} glyphs, ${font.length} bytes)`)
