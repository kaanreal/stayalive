// Deterministic 8×8 player heads, generated from the username so every account is recognizable
// without downloading skins. Shared by the client and the gameplay page.
const skins = [['#f2cfa6', '#d9ad84'], ['#e3b083', '#c48f62'], ['#c68c5c', '#a56f44'], ['#9a6942', '#7c5232'], ['#6c472c', '#55371f'], ['#f6dcc2', '#dcbd9f']]
const hairs = ['#2e2119', '#4a3121', '#6b4424', '#1f1f24', '#9a6a33', '#c9a65a', '#d9d2c4', '#7a3b26', '#3d5a80', '#5d7a52']
const eyes = ['#4a7bd0', '#3d8a5a', '#6b4a2e', '#5b5fa8', '#2e7b7b', '#7a5c2e']
const helmets = [['#c7cbcf', '#9da3a8'], ['#e8c547', '#b8962c'], ['#5fd3c8', '#3aa79c'], ['#4a4a52', '#33333a']]

function hash (text) {
  let h = 2166136261
  for (const char of String(text).toLowerCase()) h = Math.imul(h ^ char.codePointAt(0), 16777619)
  return h >>> 0
}

function random (seed) {
  let s = seed || 1
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

function shade (hex, amount) {
  const n = parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * amount))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

// Returns 64 colors, row by row.
export function headPixels (name) {
  const rand = random(hash(name))
  const pick = list => list[Math.floor(rand() * list.length)]
  const [skin, skinDark] = pick(skins)
  const hair = pick(hairs)
  const eye = pick(eyes)
  const style = Math.floor(rand() * 5)
  const helmet = rand() < 0.14 ? pick(helmets) : null
  const beard = rand() < 0.22
  const px = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) px.push(shade(skin, 0.96 + rand() * 0.08))
  }
  const set = (x, y, color) => { px[y * 8 + x] = color }
  const hairPixel = () => shade(hair, 0.88 + rand() * 0.24)
  // Hair styles: short, fringe, side part, long, buzz.
  for (let x = 0; x < 8; x++) set(x, 0, hairPixel())
  if (style !== 4) for (let x = 0; x < 8; x++) set(x, 1, hairPixel())
  if (style === 1) [0, 1, 2, 5, 6, 7].forEach(x => set(x, 2, hairPixel()))
  if (style === 2) [0, 1, 2, 3, 7].forEach(x => set(x, 2, hairPixel()))
  if (style === 0 || style === 1) { set(0, 2, hairPixel()); set(7, 2, hairPixel()) }
  if (style === 3) for (let y = 2; y < 7; y++) { set(0, y, hairPixel()); set(7, y, hairPixel()) }
  if (helmet) {
    for (let x = 0; x < 8; x++) { set(x, 0, helmet[0]); set(x, 1, x % 3 ? helmet[0] : helmet[1]) }
    for (let y = 2; y < 4; y++) { set(0, y, helmet[1]); set(7, y, helmet[1]) }
  }
  // Eyes, nose, mouth.
  set(1, 4, '#ffffff'); set(2, 4, eye); set(5, 4, eye); set(6, 4, '#ffffff')
  set(3, 5, skinDark); set(4, 5, skinDark)
  if (beard) {
    for (let x = 1; x < 7; x++) set(x, 6, hairPixel())
    for (let x = 2; x < 6; x++) set(x, 7, hairPixel())
    set(3, 6, shade(skinDark, 0.7)); set(4, 6, shade(skinDark, 0.7))
  } else {
    for (let x = 2; x < 6; x++) set(x, 6, shade(skinDark, 0.82))
  }
  return px
}

const cache = new Map()
// An 8×8 canvas for drawImage; scale it up with image smoothing disabled.
export function headCanvas (name) {
  const key = String(name).toLowerCase()
  if (cache.has(key)) return cache.get(key)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 8
  const ctx = canvas.getContext('2d')
  headPixels(name).forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(i % 8, Math.floor(i / 8), 1, 1) })
  cache.set(key, canvas)
  return canvas
}

export function paintHead (canvas, name) {
  canvas.width = canvas.height = 8
  canvas.getContext('2d').drawImage(headCanvas(name), 0, 0)
}
