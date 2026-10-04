// StayAlive identity: the grass-heart emblem, wordmark, server block icons and title panorama.
import { html, cx, useEffect, useRef } from '../lib/preact.js'

// A heart cut from a grass block. Letters map to colors below.
const emblem = [
  '.LLL...LLL.',
  'LWLGG.GLGGG',
  'GGgGGGGGgGG',
  'GDgGDGgDGgD',
  'DDbDDdDDbDD',
  '.DdDDbDDdD.',
  '..DDbDDdD..',
  '...dDDbD...',
  '....DdD....',
  '.....d.....'
]
const emblemColors = { L: '#b3d39a', W: '#eef5e6', G: '#86ad73', g: '#628a55', D: '#7d5c3d', d: '#5c422b', b: '#94704c' }

function pixelPaths (rows, colors) {
  const byColor = {}
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (colors[c]) byColor[c] = (byColor[c] || '') + `M${x} ${y}h1v1h-1z`
  }))
  return Object.entries(byColor).map(([c, d]) => html`<path key=${c} fill=${colors[c]} d=${d} />`)
}

export function Emblem ({ class: className }) {
  return html`<svg class=${cx('emblem', className)} viewBox="0 0 11 10" aria-hidden="true" focusable="false">${pixelPaths(emblem, emblemColors)}</svg>`
}

export function Logo ({ size = 'md', tagline }) {
  return html`<span class=${cx('logo', `logo--${size}`)} aria-label="StayAlive">
    <${Emblem} />
    <span class="logo__text" aria-hidden="true"><span class="logo__word">STAY<b>ALIVE</b></span>${tagline && html`<span class="logo__tagline">${tagline}</span>`}</span>
  </span>`
}

// Procedural 8×8 block textures for servers without an icon.
const blocks = {
  grass: (x, y, r) => y < 2 || (y === 2 && r < 0.5) ? ['#7fb238', '#6a9a2e', '#8cc443'][Math.floor(r * 3)] : ['#8a6142', '#76523a', '#9a6e4c'][Math.floor(r * 3)],
  stone: (x, y, r) => ['#8a8a8a', '#7a7a7a', '#999999', '#6e6e6e'][Math.floor(r * 4)],
  diamond: (x, y, r) => r > 0.82 ? ['#5ae0d6', '#2fb5ab'][Math.floor(r * 10) % 2] : ['#8a8a8a', '#7a7a7a', '#999999'][Math.floor(r * 3)],
  gold: (x, y, r) => r > 0.82 ? ['#f5d76e', '#d6a93a'][Math.floor(r * 10) % 2] : ['#8a8a8a', '#7a7a7a', '#999999'][Math.floor(r * 3)],
  planks: (x, y, r) => y % 3 === 2 ? '#6b4f2c' : ['#a8834f', '#9a7645', '#b48d57'][Math.floor(r * 3)],
  sand: (x, y, r) => ['#dbcf9a', '#cfc28a', '#e6daa6'][Math.floor(r * 3)],
  nether: (x, y, r) => ['#7a2e2e', '#6a2626', '#8a3a36', '#5a2020'][Math.floor(r * 4)],
  prismarine: (x, y, r) => ['#5fa597', '#4d8f84', '#6db8a8', '#3f7a70'][Math.floor(r * 4)]
}

function seeded (text) {
  let h = 2166136261
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296 }
}

export function ServerIcon ({ favicon, name = '', size = 48 }) {
  const ref = useRef()
  useEffect(() => {
    if (favicon || !ref.current) return
    const rand = seeded(name.toLowerCase())
    const kinds = Object.values(blocks)
    const paint = kinds[Math.floor(rand() * kinds.length)]
    const ctx = ref.current.getContext('2d')
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = paint(x, y, rand()); ctx.fillRect(x, y, 1, 1) }
  }, [favicon, name])
  return html`<span class=${cx('server-icon', `server-icon--${size}`)}>
    ${favicon ? html`<img src=${favicon} alt="" />` : html`<canvas ref=${ref} width="8" height="8" aria-hidden="true"></canvas>`}
  </span>`
}

// Title-screen panorama: three looping pixel landscape layers drifting at different speeds.
const W = 720
const H = 150
function wave (x, parts) { return parts.reduce((sum, [amp, period, phase]) => sum + amp * Math.sin((x / W) * Math.PI * 2 * period + phase), 0) }

function drawLayer (canvas, kind) {
  canvas.width = W * 2
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const rand = seeded(kind)
  // Draw every pixel three times so shapes crossing the seam wrap around seamlessly.
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; for (const shift of [-W, 0, W]) ctx.fillRect(x + shift, y, w, h) }
  if (kind === 'far') {
    for (let i = 0; i < 70; i++) rect(Math.floor(rand() * W), Math.floor(rand() * 70), 1, 1, rand() > 0.7 ? '#cfe0c2' : '#6f7f69')
    rect(560, 22, 8, 8, '#e9eddc'); rect(561, 23, 2, 2, '#cfd6bf'); rect(565, 27, 2, 1, '#d5dbc7')
    for (let x = 0; x < W; x += 2) {
      const top = Math.round(78 + wave(x, [[14, 3, 0.4], [7, 7, 1.3], [3, 13, 2]]) / 2) * 2
      rect(x, top, 2, H - top, '#18211a')
      if (top < 74) rect(x, top, 2, 2, '#2a3a2b')
    }
  } else if (kind === 'mid') {
    for (let x = 0; x < W; x += 3) {
      const top = Math.round((100 + wave(x, [[10, 2, 1], [6, 5, 0.2], [3, 11, 3]])) / 3) * 3
      rect(x, top, 3, H - top, '#1f2c20')
      rect(x, top, 3, 3, '#33482f')
    }
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(rand() * (W / 3)) * 3
      const base = Math.round((100 + wave(x, [[10, 2, 1], [6, 5, 0.2], [3, 11, 3]])) / 3) * 3
      rect(x + 3, base - 9, 3, 9, '#2b2219')
      rect(x - 3, base - 21, 15, 12, '#2c4428')
      rect(x, base - 24, 9, 3, '#37552f')
    }
  } else {
    for (let x = 0; x < W; x += 4) {
      const top = Math.round((122 + wave(x, [[6, 2, 2.1], [4, 6, 0.7]])) / 4) * 4
      rect(x, top, 4, H - top, '#2a2117')
      rect(x, top, 4, 4, ['#4d6644', '#5d7a52', '#557048'][Math.floor(rand() * 3)])
      if (rand() > 0.75) rect(x, top + 8 + Math.floor(rand() * 3) * 4, 4, 4, '#3a2e20')
      if (rand() > 0.86) rect(x, top - 4, 4, 4, '#6f8f63')
    }
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(rand() * (W / 4)) * 4
      const top = Math.round((122 + wave(x, [[6, 2, 2.1], [4, 6, 0.7]])) / 4) * 4
      rect(x, top - 24, 4, 24, '#3b2c1c')
      rect(x - 12, top - 44, 28, 20, '#3e5c37')
      rect(x - 8, top - 52, 20, 8, '#4d6f43')
      rect(x - 4, top - 40, 4, 4, '#557a4a')
    }
  }
}

export function Panorama () {
  const refs = [useRef(), useRef(), useRef()]
  useEffect(() => { ['far', 'mid', 'near'].forEach((kind, i) => refs[i].current && drawLayer(refs[i].current, kind)) }, [])
  return html`<div class="panorama" aria-hidden="true">
    <div class="panorama__sky"></div>
    <canvas ref=${refs[0]} class="panorama__layer panorama__layer--far"></canvas>
    <canvas ref=${refs[1]} class="panorama__layer panorama__layer--mid"></canvas>
    <canvas ref=${refs[2]} class="panorama__layer panorama__layer--near"></canvas>
    <div class="panorama__fade"></div>
  </div>`
}
