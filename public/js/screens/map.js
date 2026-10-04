// MAP: the radar. Click to pick a destination, shift-click to plan a route, right-click for more.
import { html, cx, useEffect, useRef, useState } from '../lib/preact.js'
import { store, accounts, focused, selectedAccounts, update } from '../core/store.js'
import { run, toast, setPref, setDestination, walkOnMap, sendTo, addDraftPoint, openModal, closeModal, addWaypoint, visibleWaypoints, focus, stopRoute, openGameplay, navigate, setRoute, setDraft } from '../core/actions.js'
import { isOnline, isMappable, displayName, statusOf, routeOf, sameServer, flatDistance, eta, facing, blockName, plural } from '../core/format.js'
import { Icon } from '../ui/icon.js'
import { McButton, GamePanel, PlayerHead, StatusBadge, Segmented, Toggle, Popover, Field, EmptyState } from '../ui/primitives.js'
import { Modal } from '../ui/overlays.js'
import { MapView, useMapData } from '../map/map-view.js'
import { legend, spreadSpots } from '../map/colors.js'

const zooms = [32, 24, 16]

// Accounts that share a world with the controlled one.
export function mapNeighbours (account) {
  return accounts().filter(a => a.id !== account?.id && isOnline(a) && a.position && sameServer(a.server, account?.server) && a.dimension === account?.dimension)
}

export function mapMessage (account, enabled, state) {
  if (!accounts().length) return 'Add an account, join a server, and its surroundings appear here.'
  if (!account) return 'Choose an account to control.'
  if (!enabled) return `${displayName(account)} isn’t on a server. Join to load the map.`
  if (state.error) return state.error
  if (!state.data) return 'Loading chunks…'
  if (!state.data.tiles.some(Boolean)) return 'Waiting for chunk data…'
  return null
}

function MapTools () {
  const prefs = store.prefs
  const index = zooms.indexOf(prefs.mapRadius)
  const zoom = step => { const next = zooms[Math.max(0, Math.min(zooms.length - 1, index + step))]; if (next) setPref('mapRadius', next) }
  const size = prefs.mapRadius * 2 + 1
  return html`<div class="map-tools">
    <${Segmented} value=${prefs.mapLayer} onChange=${v => setPref('mapLayer', v)} size="sm" label="Map layer" options=${[
      { value: 'surface', label: 'Surface', icon: 'layers', title: 'Highest blocks, including roofs and sky platforms' },
      { value: 'player', label: 'Underground', icon: 'arrow', title: 'Hide blocks above the player: caves and interiors' }
    ]} />
    <div class="zoom" role="group" aria-label="Zoom">
      <button type="button" class="icon-btn" aria-label="Zoom out" disabled=${index <= 0} onClick=${() => zoom(-1)}><${Icon} name="minus" /></button>
      <span class="zoom__level mono">${size}×${size}</span>
      <button type="button" class="icon-btn" aria-label="Zoom in" disabled=${index >= zooms.length - 1} onClick=${() => zoom(1)}><${Icon} name="plus" /></button>
    </div>
    <${Popover} align="start" trigger=${({ toggle, open }) => html`<button type="button" class=${cx('icon-btn icon-btn--label', open && 'is-active')} onClick=${toggle}><${Icon} name="grid" /><span>Layers</span></button>`}>
      <div class="menu menu--pad">
        <${Toggle} checked=${prefs.chunkGrid} onChange=${v => setPref('chunkGrid', v)} label="Chunk grid" />
        <${Toggle} checked=${prefs.mapPlayers} onChange=${v => setPref('mapPlayers', v)} label="Other accounts" />
        <${Toggle} checked=${prefs.mapRoutes} onChange=${v => setPref('mapRoutes', v)} label="Routes and path" />
        <${Toggle} checked=${prefs.mapWaypoints} onChange=${v => setPref('mapWaypoints', v)} label="Spawn and waypoints" />
      </div>
    <//>
  </div>`
}

function Compass ({ account, data }) {
  const yaw = account?.rotation?.yaw ?? 180
  const p = data?.player
  return html`<div class="map-hud">
    <span class="compass" aria-hidden="true"><span class="compass__needle" style=${{ transform: `rotate(${yaw + 180}deg)` }}></span><b>N</b></span>
    <div class="map-hud__text">
      <span class="mono map-hud__xyz">${p ? html`<i>X</i>${Math.floor(p.x)} <i>Y</i>${Math.floor(p.y)} <i>Z</i>${Math.floor(p.z)}` : '— — —'}</span>
      <small>${p ? `Facing ${facing(yaw)} · chunk ${Math.floor(p.x) >> 4}, ${Math.floor(p.z) >> 4}` : 'No position'}</small>
    </div>
  </div>`
}

function Legend () {
  const [open, setOpen] = useState(false)
  return html`<div class=${cx('map-legend', open && 'is-open')}>
    <button type="button" class="icon-btn icon-btn--label" onClick=${() => setOpen(!open)} aria-expanded=${open}><${Icon} name="info" /><span>Legend</span></button>
    ${open && html`<ul>
      ${legend.map(([name, color]) => html`<li key=${name}><i style=${{ background: color }}></i>${name}</li>`)}
      <li><i class="legend-route"></i>Route</li><li><i class="legend-draft"></i>Route plan</li><li><i class="legend-path"></i>Computed path</li>
    </ul>`}
  </div>`
}

function FocusCard ({ account, data }) {
  if (!account) return null
  const route = routeOf(account)
  const target = route.target && data ? flatDistance(data.player, route.target) : null
  const pathBlocks = data?.path?.length || null
  return html`<${GamePanel} class="focus-card" kicker="Controlling" title=${html`<span class="focus-card__title"><${PlayerHead} name=${displayName(account)} size=${28} status=${account} />${displayName(account)}</span>`}>
    <div class="focus-card__rows">
      <div><span>Status</span><${StatusBadge} account=${account} /></div>
      <div><span>Route</span><b>${route.label}</b></div>
      ${route.target && html`<div><span>Target</span><b class="mono">${route.target.x} ${route.target.y} ${route.target.z}</b></div>`}
      ${target != null && html`<div><span>Distance</span><b>${Math.round(pathBlocks || target)} blocks · ~${eta(pathBlocks || target)}</b></div>`}
    </div>
    <div class="btn-row">
      <${McButton} size="sm" icon="stop" disabled=${account.route.mode === 'idle'} onClick=${() => run(() => stopRoute([account.id]))}>Stop<//>
      <${McButton} size="sm" icon="sword" disabled=${!isMappable(account)} onClick=${() => run(() => openGameplay(account.id))}>Gameplay<//>
    </div>
  <//>`
}

function DestinationPanel ({ account, data }) {
  const dest = store.destination
  const chosen = selectedAccounts().filter(a => isOnline(a) && sameServer(a.server, account?.server))
  const picking = store.picking
  if (!dest) {
    return html`<${GamePanel} class=${cx('dest-card', picking && 'is-picking')} kicker="Destination" title=${picking ? 'Pick a spot' : 'Click the map'}>
      <p class="muted-note">${picking ? `Click a surface to send ${plural(chosen.length, 'selected account')} there.` : 'Click a loaded surface to pick a destination. Shift-click adds it to your route plan.'}</p>
      ${picking && html`<${McButton} size="sm" variant="ghost" onClick=${() => update({ picking: false })}>Cancel<//>`}
    <//>`
  }
  const distance = data ? flatDistance(data.player, { x: dest.x + 0.5, z: dest.z + 0.5 }) : null
  const sendFocused = () => run(async () => { await walkOnMap(account.id, dest.x, dest.z, store.prefs.mapLayer); setDestination(null) })
  const sendSelected = () => run(async () => {
    const spots = store.prefs.spread && data ? spreadSpots(data, dest, chosen.length) : [dest]
    await sendTo(chosen, spots)
    update({ destination: null, picking: false })
  })
  return html`<${GamePanel} class="dest-card is-set" kicker="Destination" title=${html`<span class="mono">${dest.x} ${dest.y} ${dest.z}</span>`} actions=${html`<button type="button" class="icon-btn" aria-label="Clear destination" onClick=${() => setDestination(null)}><${Icon} name="close" /></button>`}>
    <dl class="facts facts--tight">
      <div><dt>Block</dt><dd>${blockName(dest.block)}</dd></div>
      <div><dt>Distance</dt><dd>${distance != null ? `${Math.round(distance)} blocks` : '—'}</dd></div>
      <div><dt>Travel time</dt><dd>${distance != null ? `~${eta(distance)}` : '—'}</dd></div>
    </dl>
    <div class="dest-card__send">
      ${chosen.length > 0 && html`<${McButton} variant="primary" block icon="move" onClick=${sendSelected}>Send ${chosen.length} selected<//>`}
      ${account && html`<${McButton} variant=${chosen.length ? null : 'primary'} block icon="play" disabled=${!isMappable(account)} onClick=${sendFocused}>Send ${displayName(account)}<//>`}
      ${chosen.length > 1 && html`<${Toggle} checked=${store.prefs.spread} onChange=${v => setPref('spread', v)} label="Spread out" hint="Each account gets its own block nearby." />`}
    </div>
    <div class="btn-row">
      <${McButton} size="sm" icon="route" onClick=${() => { addDraftPoint(dest); toast('Added to route plan.', 'success') }}>Add to plan<//>
      <${McButton} size="sm" icon="flag" onClick=${() => openModal('waypoint', { point: dest })}>Waypoint<//>
    </div>
  <//>`
}

function PlanCard () {
  const draft = store.draft
  if (!draft.points.length) return null
  const valid = draft.mode === 'goto' ? draft.points.length === 1 : draft.points.length >= 2
  const list = selectedAccounts().length ? selectedAccounts() : [focused()].filter(Boolean)
  return html`<${GamePanel} kicker="Route plan" title=${`${plural(draft.points.length, 'point')} · ${draft.mode === 'loop' ? 'Patrol' : 'Walk to'}`} actions=${html`<button type="button" class="icon-btn" aria-label="Clear plan" title="Clear plan" onClick=${() => setDraft({ ...draft, points: [] })}><${Icon} name="trash" /></button>`}>
    <ol class="plan-mini">${draft.points.slice(0, 5).map((p, i) => html`<li key=${i}><span class="node-num">${i + 1}</span><span class="mono">${p.x} ${p.y} ${p.z}</span>${p.name && html`<small>${p.name}</small>`}</li>`)}${draft.points.length > 5 && html`<li class="muted">+${draft.points.length - 5} more</li>`}</ol>
    <div class="btn-row">
      <${McButton} size="sm" variant="primary" icon="route" disabled=${!valid || !list.length} onClick=${() => run(async () => { await setRoute(list.map(a => a.id), { mode: draft.mode, points: draft.points.map(({ x, y, z }) => ({ x, y, z })) }); toast(`Route applied to ${plural(list.length, 'account')}.`, 'success') })}>Apply to ${list.length > 1 ? list.length : list[0] ? displayName(list[0]) : '—'}<//>
      <${McButton} size="sm" variant="ghost" onClick=${() => navigate('routes')}>Edit<//>
    </div>
    ${!valid && html`<p class="field__hint">${draft.mode === 'goto' ? 'Walk to uses exactly one point.' : 'A patrol needs at least two different points.'}</p>`}
  <//>`
}

function NearbyList ({ account, data }) {
  const others = mapNeighbours(account)
  if (!others.length) return null
  return html`<${GamePanel} kicker="On this map" title=${plural(others.length, 'other account')}>
    <ul class="nearby">${others.map(a => html`<li key=${a.id}><button type="button" onClick=${() => focus(a.id)} title="Control this account">
      <${PlayerHead} name=${displayName(a)} size=${24} status=${a} />
      <span><b>${displayName(a)}</b><small>${statusOf(a).label}</small></span>
      <span class="mono muted">${data ? `${Math.round(flatDistance(data.player, a.position))}m` : ''}</span>
    </button></li>`)}</ul>
  <//>`
}

function ContextMenu ({ menu, account, onClose }) {
  const ref = useRef()
  useEffect(() => {
    const away = e => { if (!ref.current?.contains(e.target)) onClose() }
    const key = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key) }
  }, [])
  const { point } = menu
  const tile = point.tile
  const spot = tile ? { x: point.x, y: tile.y, z: point.z, block: tile.block } : null
  const chosen = selectedAccounts().filter(a => isOnline(a) && sameServer(a.server, account?.server))
  const act = fn => () => { onClose(); fn() }
  return html`<div class="menu context-menu" ref=${ref} style=${{ left: `${Math.min(menu.x, innerWidth - 240)}px`, top: `${Math.min(menu.y, innerHeight - 260)}px` }} role="menu">
    <p class="menu__title mono">${point.x} ${tile ? tile.y : '?'} ${point.z}</p>
    <button type="button" class="menu-item" disabled=${!tile?.walkable || !isMappable(account)} onClick=${act(() => run(() => walkOnMap(account.id, point.x, point.z, store.prefs.mapLayer)))}><${Icon} name="play" /><span>Walk here</span><small>${displayName(account)}</small></button>
    <button type="button" class="menu-item" disabled=${!tile?.walkable || !chosen.length} onClick=${act(() => run(() => sendTo(chosen, store.prefs.spread ? spreadSpots(store.mapData, spot, chosen.length) : [spot])))}><${Icon} name="move" /><span>Send selected here</span><small>${chosen.length}</small></button>
    <button type="button" class="menu-item" disabled=${!tile?.walkable} onClick=${act(() => setDestination(spot))}><${Icon} name="pin" /><span>Set destination</span></button>
    <button type="button" class="menu-item" disabled=${!tile} onClick=${act(() => { addDraftPoint(spot); toast('Added to route plan.', 'success') })}><${Icon} name="route" /><span>Add to route plan</span></button>
    <button type="button" class="menu-item" disabled=${!tile} onClick=${act(() => openModal('waypoint', { point: spot }))}><${Icon} name="flag" /><span>Save waypoint</span></button>
    <button type="button" class="menu-item" onClick=${act(() => run(async () => { await navigator.clipboard.writeText(`${point.x} ${tile ? tile.y : '~'} ${point.z}`); toast('Coordinates copied.', 'success') }))}><${Icon} name="copy" /><span>Copy coordinates</span></button>
  </div>`
}

export function MapScreen () {
  const account = focused()
  const prefs = store.prefs
  const enabled = Boolean(account && isMappable(account))
  const state = useMapData(account?.id, prefs.mapRadius, prefs.mapLayer, enabled)
  const [menu, setMenu] = useState(null)
  useEffect(() => () => update({ picking: false }), [])
  const pick = p => {
    if (!p.tile) return toast('That chunk isn’t loaded yet.', 'warn')
    if (!p.tile.walkable) return toast(`No room to stand on ${blockName(p.tile.block)} there.`, 'warn')
    setDestination({ x: p.x, y: p.tile.y, z: p.z, block: p.tile.block })
  }
  const add = p => {
    if (!p.tile) return toast('That chunk isn’t loaded yet.', 'warn')
    addDraftPoint({ x: p.x, y: p.tile.y, z: p.z })
  }
  const zoom = dir => {
    const i = zooms.indexOf(prefs.mapRadius) - dir
    if (zooms[i]) setPref('mapRadius', zooms[i])
  }
  const message = mapMessage(account, enabled, state)
  return html`<div class="map-screen">
    <div class="map-stage">
      <${MapView} data=${enabled ? state.data : null} message=${message} account=${account} others=${mapNeighbours(account)} selectedIds=${store.selected}
        draft=${store.draft} waypoints=${visibleWaypoints()} destination=${store.destination}
        overlays=${{ grid: prefs.chunkGrid, players: prefs.mapPlayers, routes: prefs.mapRoutes, waypoints: prefs.mapWaypoints }}
        onPick=${pick} onAdd=${add} onZoom=${zoom} onFocus=${a => focus(a.id)} onContext=${(point, x, y) => setMenu({ point, x, y })}
        hint="Click: destination · Shift-click: add to plan · Right-click: more" />
      <${MapTools} />
      <${Compass} account=${account} data=${enabled ? state.data : null} />
      <${Legend} />
      ${store.picking && html`<div class="map-banner"><${Icon} name="move" /> Pick a destination for ${plural(selectedAccounts().length, 'selected account')} <button type="button" class="link-btn" onClick=${() => update({ picking: false })}>Cancel</button></div>`}
      ${state.at > 0 && enabled && html`<span class="map-live" title="The map refreshes every two seconds"><i></i>Live</span>`}
    </div>
    <aside class="map-rail">
      ${account ? html`
        <${FocusCard} account=${account} data=${state.data} />
        <${DestinationPanel} account=${account} data=${state.data} />
        <${PlanCard} />
        <${NearbyList} account=${account} data=${state.data} />` : html`<${EmptyState} icon="map" title="No account">Add an account to use the map.<//>`}
    </aside>
    ${menu && account && html`<${ContextMenu} menu=${menu} account=${account} onClose=${() => setMenu(null)} />`}
  </div>`
}

export function WaypointModal ({ point }) {
  const [name, setName] = useState('')
  const save = e => { e?.preventDefault(); addWaypoint(point, name); closeModal() }
  return html`<${Modal} title="Save waypoint" icon="flag" footer=${html`
    <${McButton} variant="ghost" onClick=${closeModal}>Cancel<//>
    <${McButton} variant="primary" icon="flag" onClick=${save}>Save waypoint<//>`}>
    <form class="form" onSubmit=${save}>
      <p class="modal__text">Waypoints are saved in this browser for the active server, and show up on the map and in the route planner.</p>
      <${Field} label="Name"><input class="input" value=${name} onInput=${e => setName(e.currentTarget.value)} placeholder="Base, farm, portal…" maxlength="40" autofocus /><//>
      <p class="mono muted">${point.x} ${point.y} ${point.z}${point.block ? ` · ${blockName(point.block)}` : ''}</p>
      <button type="submit" hidden></button>
    </form>
  <//>`
}
