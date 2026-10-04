// MapView: the top-down radar for one account, with players, routes, waypoints and a destination pin.
import { html, cx, useEffect, useMemo, useRef, useState } from '../lib/preact.js'
import { getMap } from '../core/api.js'
import { update } from '../core/store.js'
import { blockName, displayName } from '../core/format.js'
import { headCanvas } from '../ui/head-art.js'
import { art } from '../ui/icon.js'
import { renderTerrain, tileAt } from './colors.js'

// Polls the map for an account every two seconds while mounted.
export function useMapData (id, radius, layer, enabled) {
  const [state, setState] = useState({ data: null, error: null, at: 0 })
  useEffect(() => { setState({ data: null, error: null, at: 0 }) }, [id])
  useEffect(() => {
    if (!id || !enabled) return
    let stopped = false
    let timer
    const tick = async () => {
      try {
        const data = await getMap(id, radius, layer)
        if (stopped) return
        setState({ data, error: null, at: Date.now() })
        update({ mapData: data })
      } catch (error) {
        if (!stopped) setState({ data: null, error: error.message, at: Date.now() })
      } finally {
        if (!stopped) timer = setTimeout(tick, 2000)
      }
    }
    tick()
    return () => { stopped = true; clearTimeout(timer) }
  }, [id, radius, layer, enabled])
  return state
}

const colors = { route: '#f0b45a', draft: '#e6eadf', path: '#8fd8ea', accent: '#9dbb87', ink: '#0b0d0b', danger: '#e0705a', spawn: '#f5d76e', waypoint: '#c9a0f0' }

function drawArt (ctx, rows, x, y, px, color) {
  const size = rows.length * px
  const left = Math.round(x - size / 2)
  const top = Math.round(y - size)
  const paint = (dx, dy, fill) => {
    ctx.fillStyle = fill
    rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(left + c * px + dx, top + r * px + dy, px, px) })
  }
  for (const [dx, dy] of [[-px, 0], [px, 0], [0, -px], [0, px]]) paint(dx, dy, colors.ink)
  paint(0, 0, color)
}

function tag (ctx, text, x, y, color = '#e6eadf') {
  ctx.font = '600 11px "Segoe UI", system-ui, sans-serif'
  const w = Math.ceil(ctx.measureText(text).width) + 10
  ctx.fillStyle = 'rgba(8,10,8,.78)'
  ctx.fillRect(Math.round(x - w / 2), Math.round(y - 18), w, 16)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, Math.round(x), Math.round(y - 10))
}

function node (ctx, x, y, size, fill, label, hollow) {
  const s = Math.round(size)
  const left = Math.round(x - s / 2)
  const top = Math.round(y - s / 2)
  ctx.fillStyle = colors.ink
  ctx.fillRect(left - 2, top - 2, s + 4, s + 4)
  ctx.fillStyle = hollow ? '#1b201b' : fill
  ctx.fillRect(left, top, s, s)
  if (hollow) { ctx.strokeStyle = fill; ctx.lineWidth = 2; ctx.strokeRect(left + 1, top + 1, s - 2, s - 2) }
  if (label && s >= 12) {
    ctx.fillStyle = hollow ? fill : colors.ink
    ctx.font = '8px "StayAlive Pixel", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, Math.round(x) + 0.5, Math.round(y) + 1)
  }
}

function polyline (ctx, points, toScreen, close) {
  ctx.beginPath()
  points.forEach((p, i) => { const [x, y] = toScreen(p.x + 0.5, p.z + 0.5); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
  if (close && points.length > 1) { const [x, y] = toScreen(points[0].x + 0.5, points[0].z + 0.5); ctx.lineTo(x, y) }
  ctx.stroke()
}

export function MapView ({ data, message, account, others = [], selectedIds, draft, waypoints = [], destination, overlays = {}, compact, onPick, onAdd, onContext, onZoom, onFocus, hint }) {
  const wrap = useRef()
  const canvas = useRef()
  const props = useRef()
  const hoverRef = useRef(null)
  const [hover, setHover] = useState(null)
  const terrain = useMemo(() => data ? renderTerrain(data) : null, [data])
  props.current = { data, terrain, account, others, selectedIds, draft, waypoints, destination, overlays }

  // Size the canvas to its box at device resolution.
  useEffect(() => {
    const resize = () => {
      const box = wrap.current.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.current.width = Math.max(1, Math.round(box.width * dpr))
      canvas.current.height = Math.max(1, Math.round(box.height * dpr))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(wrap.current)
    resize()
    return () => observer.disconnect()
  }, [])

  // Draw loop, capped near 30 fps; it pauses with the tab.
  useEffect(() => {
    let frame
    let last = 0
    const loop = now => {
      frame = requestAnimationFrame(loop)
      if (now - last < 32) return
      last = now
      draw(now)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])

  function geometry () {
    const { data } = props.current
    const c = canvas.current
    const dpr = window.devicePixelRatio || 1
    const W = c.width / dpr
    const H = c.height / dpr
    if (!data) return { W, H, dpr }
    const cell = Math.min(W, H) / data.size
    const ox = (W - cell * data.size) / 2
    const oz = (H - cell * data.size) / 2
    const toScreen = (x, z) => [ox + (x - data.origin.x) * cell, oz + (z - data.origin.z) * cell]
    return { W, H, dpr, cell, ox, oz, toScreen }
  }

  function markers () {
    const { data, account, others } = props.current
    if (!data) return []
    const { toScreen, cell } = geometry()
    const list = []
    for (const a of others) {
      if (a.id === account?.id || !a.position) continue
      const [x, y] = toScreen(a.position.x, a.position.z)
      list.push({ a, x, y, size: Math.max(14, Math.min(22, cell * 1.1)) })
    }
    if (account) {
      const [x, y] = toScreen(data.player.x, data.player.z)
      list.push({ a: account, x, y, size: Math.max(18, Math.min(28, cell * 1.4)), focused: true })
    }
    return list
  }

  function draw (now) {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    const g = geometry()
    const { data, terrain, selectedIds, draft, waypoints, destination, overlays } = props.current
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0)
    ctx.clearRect(0, 0, g.W, g.H)
    if (!data) return
    const { cell, ox, oz, toScreen } = g
    const span = cell * data.size
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(terrain, ox, oz, span, span)

    if (overlays.grid) {
      ctx.lineWidth = 1
      if (cell >= 16) {
        ctx.strokeStyle = 'rgba(0,0,0,.14)'
        ctx.beginPath()
        for (let i = 0; i <= data.size; i++) { ctx.moveTo(Math.round(ox + i * cell) + 0.5, oz); ctx.lineTo(Math.round(ox + i * cell) + 0.5, oz + span); ctx.moveTo(ox, Math.round(oz + i * cell) + 0.5); ctx.lineTo(ox + span, Math.round(oz + i * cell) + 0.5) }
        ctx.stroke()
      }
      ctx.strokeStyle = 'rgba(230,234,223,.22)'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      for (let i = 0; i <= data.size; i++) {
        if ((((data.origin.x + i) % 16) + 16) % 16 === 0) { const x = Math.round(ox + i * cell) + 0.5; ctx.moveTo(x, oz); ctx.lineTo(x, oz + span) }
        if ((((data.origin.z + i) % 16) + 16) % 16 === 0) { const z = Math.round(oz + i * cell) + 0.5; ctx.moveTo(ox, z); ctx.lineTo(ox + span, z) }
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    const pulse = (now % 1600) / 1600
    const nodeSize = Math.max(12, Math.min(18, cell * 0.8))

    if (overlays.routes) {
      // Routes of the other accounts, faint, so you can see who patrols where.
      ctx.globalAlpha = 0.4
      ctx.strokeStyle = colors.route
      ctx.lineWidth = 2
      ctx.setLineDash([3, 5])
      for (const other of props.current.others) {
        if (other.id === account?.id || other.route.mode === 'idle' || !other.route.points.length) continue
        polyline(ctx, other.position ? [{ x: Math.floor(other.position.x), z: Math.floor(other.position.z) }, ...other.route.points.slice(other.routeIndex), ...(other.route.mode === 'loop' ? other.route.points.slice(0, other.routeIndex + 1) : [])] : other.route.points, toScreen)
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      // Computed path from the pathfinder.
      if (data.path?.length) {
        ctx.strokeStyle = colors.path
        ctx.lineWidth = 2
        ctx.setLineDash([2, 4])
        polyline(ctx, [{ x: Math.floor(data.player.x), z: Math.floor(data.player.z) }, ...data.path], toScreen)
        ctx.setLineDash([])
      }
      // Saved route of the controlled account.
      const route = data.route
      if (route.points.length) {
        ctx.strokeStyle = colors.route
        ctx.lineWidth = Math.max(2, cell * 0.16)
        ctx.setLineDash([Math.max(4, cell * 0.5), Math.max(3, cell * 0.35)])
        ctx.lineDashOffset = -now / 40
        polyline(ctx, route.points, toScreen, route.mode === 'loop')
        ctx.setLineDash([])
        ctx.lineDashOffset = 0
        route.points.forEach((p, i) => {
          const [x, y] = toScreen(p.x + 0.5, p.z + 0.5)
          const current = i === (account?.routeIndex ?? 0) && account?.status === 'walking'
          if (current) { ctx.strokeStyle = `rgba(240,180,90,${1 - pulse})`; ctx.lineWidth = 2; const r = nodeSize / 2 + 4 + pulse * 10; ctx.strokeRect(x - r, y - r, r * 2, r * 2) }
          node(ctx, x, y, nodeSize, colors.route, route.mode === 'loop' ? String(i + 1) : '')
        })
      }
      // The route being planned.
      if (draft?.points.length) {
        ctx.strokeStyle = colors.draft
        ctx.lineWidth = 2
        ctx.setLineDash([3, 5])
        polyline(ctx, draft.points, toScreen, draft.mode === 'loop')
        ctx.setLineDash([])
        draft.points.forEach((p, i) => { const [x, y] = toScreen(p.x + 0.5, p.z + 0.5); node(ctx, x, y, nodeSize, colors.draft, String(i + 1), true) })
      }
    }

    if (overlays.waypoints) {
      const px = Math.max(2, Math.round(cell / 6))
      if (data.spawn) { const [x, y] = toScreen(data.spawn.x + 0.5, data.spawn.z + 0.5); drawArt(ctx, art.star, x, y + 4, px, colors.spawn) }
      for (const w of waypoints) {
        const [x, y] = toScreen(w.x + 0.5, w.z + 0.5)
        if (x < ox - 20 || y < oz - 20 || x > ox + span + 20 || y > oz + span + 20) continue
        drawArt(ctx, art.flag, x + px * 4, y + 2, px, colors.waypoint)
        if (cell >= 10) tag(ctx, w.name, x, y - px * 9, colors.waypoint)
      }
    }

    if (destination) {
      const [x, y] = toScreen(destination.x, destination.z)
      ctx.strokeStyle = colors.accent
      ctx.lineWidth = 2
      ctx.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(cell) - 2, Math.round(cell) - 2)
      const [px, pz] = toScreen(data.player.x, data.player.z)
      ctx.strokeStyle = 'rgba(230,234,223,.45)'
      ctx.setLineDash([2, 4])
      ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(x + cell / 2, y + cell / 2); ctx.stroke()
      ctx.setLineDash([])
      const bob = Math.round(Math.sin(now / 260) * 3)
      drawArt(ctx, art.pin, x + cell / 2, y + cell / 2 - 2 + bob, Math.max(2, Math.round(cell / 5)), colors.accent)
    }

    // Players: other accounts first, the controlled one on top.
    const hoverId = hoverRef.current?.marker
    for (const m of markers()) {
      const { a, x, y, size, focused } = m
      if (x < ox - size || y < oz - size || x > ox + span + size || y > oz + span + size) continue
      if (!overlays.players && !focused) continue
      const selected = selectedIds?.has(a.id)
      if (focused) {
        const yaw = data.player.yaw
        const reach = Math.min(90, cell * 7)
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, reach)
        gradient.addColorStop(0, 'rgba(157,187,135,.42)')
        gradient.addColorStop(1, 'rgba(157,187,135,0)')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(x, y)
        const angle = Math.atan2(-Math.cos(yaw), -Math.sin(yaw))
        ctx.arc(x, y, reach, angle - 0.55, angle + 0.55)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = `rgba(157,187,135,${0.9 - pulse * 0.9})`
        ctx.lineWidth = 2
        const r = size / 2 + 3 + pulse * 12
        ctx.strokeRect(x - r, y - r, r * 2, r * 2)
      }
      const half = size / 2
      ctx.fillStyle = colors.ink
      ctx.fillRect(Math.round(x - half - 2), Math.round(y - half - 2), Math.round(size + 4), Math.round(size + 4))
      if (focused || selected) {
        ctx.fillStyle = focused ? colors.accent : '#e6eadf'
        ctx.fillRect(Math.round(x - half - 2), Math.round(y - half - 2), Math.round(size + 4), Math.round(size + 4))
        ctx.fillStyle = colors.ink
        ctx.fillRect(Math.round(x - half), Math.round(y - half), Math.round(size), Math.round(size))
      }
      ctx.drawImage(headCanvas(displayName(a)), Math.round(x - half + 1), Math.round(y - half + 1), Math.round(size - 2), Math.round(size - 2))
      if (focused || selected || hoverId === a.id) tag(ctx, displayName(a), x, y - half - 4, focused ? colors.accent : '#e6eadf')
    }

    const h = hoverRef.current
    if (h && !h.marker) {
      const [x, y] = toScreen(h.x, h.z)
      ctx.strokeStyle = h.tile?.walkable ? '#ffffff' : colors.danger
      ctx.lineWidth = 2
      ctx.strokeRect(Math.round(x), Math.round(y), Math.round(cell), Math.round(cell))
    }
  }

  function pointAt (event) {
    const { data } = props.current
    if (!data) return null
    const box = canvas.current.getBoundingClientRect()
    const { cell, ox, oz } = geometry()
    const mx = event.clientX - box.left
    const my = event.clientY - box.top
    const hit = markers().reverse().find(m => Math.abs(mx - m.x) <= m.size / 2 + 2 && Math.abs(my - m.y) <= m.size / 2 + 2 && (props.current.overlays.players || m.focused))
    const ix = Math.floor((mx - ox) / cell)
    const iz = Math.floor((my - oz) / cell)
    if (ix < 0 || iz < 0 || ix >= data.size || iz >= data.size) return hit ? { marker: hit.a.id, account: hit.a } : null
    const x = data.origin.x + ix
    const z = data.origin.z + iz
    return { x, z, tile: tileAt(data, x, z), marker: hit?.a.id, account: hit?.a }
  }

  const move = event => {
    const p = pointAt(event)
    hoverRef.current = p
    const key = p ? `${p.x},${p.z},${p.marker}` : ''
    if (key !== (hover ? `${hover.x},${hover.z},${hover.marker}` : '')) setHover(p)
  }
  const leave = () => { hoverRef.current = null; setHover(null) }
  const click = event => {
    const p = pointAt(event)
    if (!p) return
    if (p.marker && p.account && onFocus) return onFocus(p.account)
    if (event.shiftKey && onAdd) return onAdd(p)
    onPick?.(p)
  }
  const context = event => {
    event.preventDefault()
    const p = pointAt(event)
    if (p && !p.marker && onContext) onContext(p, event.clientX, event.clientY)
  }
  const wheel = event => {
    if (!onZoom) return
    event.preventDefault()
    onZoom(event.deltaY > 0 ? 1 : -1)
  }

  const cursor = hover?.marker ? 'is-player' : hover?.tile?.walkable ? 'is-walkable' : hover ? 'is-blocked' : ''
  return html`<div class=${cx('map-view', compact && 'map-view--compact', cursor)} ref=${wrap}>
    <canvas ref=${canvas} tabindex="0" aria-label="Top-down map around the controlled account. Click a surface to pick a destination." onMouseMove=${move} onMouseLeave=${leave} onClick=${click} onContextMenu=${context} onWheel=${wheel}></canvas>
    ${message && html`<div class="map-view__message"><p>${message}</p></div>`}
    ${data && html`<div class="map-view__hover" aria-live="off">
      ${hover?.marker ? html`<span><b>${displayName(hover.account)}</b> · click to control</span>`
        : hover ? html`<span class="mono">${hover.x} ${hover.tile ? hover.tile.y : '?'} ${hover.z}</span><span class="block">${hover.tile ? blockName(hover.tile.block) : 'Unloaded chunk'}</span>${hover.tile && !hover.tile.walkable && html`<span class="is-blocked">No standing space</span>`}`
        : html`<span>${hint || 'Hover for coordinates'}</span>`}
    </div>`}
  </div>`
}
