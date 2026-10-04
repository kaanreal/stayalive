// ROUTES: plan walks and patrols, watch every account's movement, and tune idle behavior.
import { html, cx, useEffect, useState } from '../lib/preact.js'
import { store, accounts, focused, targets, selectedAccounts } from '../core/store.js'
import { run, toast, setDraft, addDraftPoint, setRoute, stopRoute, applyActions, playerAction, openModal, closeModal, visibleWaypoints, removeWaypoint, focus, setSelection, navigate } from '../core/actions.js'
import { isOnline, isMappable, displayName, routeOf, flatDistance, eta, plural } from '../core/format.js'
import { Icon } from '../ui/icon.js'
import { McButton, GamePanel, ScreenHeader, PlayerHead, HeadStack, StatusBadge, Segmented, Toggle, Field, EmptyState } from '../ui/primitives.js'
import { Modal } from '../ui/overlays.js'
import { MapView, useMapData } from '../map/map-view.js'
import { mapMessage, mapNeighbours } from './map.js'

const modes = [
  { value: 'goto', label: 'Walk to', icon: 'pin' },
  { value: 'loop', label: 'Patrol', icon: 'refresh' },
  { value: 'idle', label: 'Stay AFK', icon: 'pause' }
]
const modeHints = {
  goto: 'Walk to one point, then stay there. Uses exactly one point.',
  loop: 'Walk between the points on repeat until stopped. Needs at least two different points.',
  idle: 'Stop moving and stay connected. Idle behavior below still applies.'
}

export function TargetLine () {
  const list = targets()
  const chosen = selectedAccounts().length
  return html`<div class="target-line">
    <span class="field__label">Applies to</span>
    ${list.length ? html`<${HeadStack} accounts=${list} max=${5} size=${20} />` : null}
    <b>${chosen ? `${chosen} selected ${chosen === 1 ? 'account' : 'accounts'}` : list[0] ? `${displayName(list[0])} (controlling)` : 'No accounts'}</b>
    ${!chosen && accounts().length > 1 && html`<button type="button" class="link-btn" onClick=${() => navigate('accounts')}>Select more</button>`}
  </div>`
}

function validate (draft) {
  const bad = draft.points.findIndex(p => !['x', 'y', 'z'].every(k => Number.isInteger(Number(p[k])) && String(p[k]).trim() !== ''))
  if (bad >= 0) return `Point ${bad + 1} needs whole-number X, Y and Z.`
  if (draft.mode === 'goto' && draft.points.length !== 1) return 'Walk to uses exactly one point.'
  if (draft.mode === 'loop' && new Set(draft.points.map(p => `${p.x} ${p.y} ${p.z}`)).size < 2) return 'A patrol needs at least two different points.'
  return null
}

function Planner () {
  const draft = store.draft
  const list = targets()
  const account = focused()
  const enabled = Boolean(account && isMappable(account))
  const state = useMapData(account?.id, store.prefs.mapRadius, store.prefs.mapLayer, enabled)
  const points = draft.points
  const set = next => setDraft({ ...draft, points: next })
  const edit = (i, key, value) => set(points.map((p, j) => j === i ? { ...p, [key]: value } : p))
  const swap = (i, j) => { if (j < 0 || j >= points.length) return; const next = [...points];[next[i], next[j]] = [next[j], next[i]]; set(next) }
  const error = draft.mode === 'idle' ? null : validate(draft)
  const apply = () => run(async () => {
    const route = { mode: draft.mode, points: draft.mode === 'idle' ? [] : points.map(p => ({ x: Number(p.x), y: Number(p.y), z: Number(p.z) })) }
    await setRoute(list.map(a => a.id), route)
    toast(`${draft.mode === 'idle' ? 'Stay AFK' : draft.mode === 'loop' ? 'Patrol' : 'Walk'} applied to ${plural(list.length, 'account')}. Offline accounts use it when they spawn.`, 'success')
  })
  const here = account?.position ? { x: Math.floor(account.position.x), y: Math.floor(account.position.y), z: Math.floor(account.position.z) } : null
  const waypoints = visibleWaypoints()
  return html`<div class="planner">
    <${GamePanel} class="planner__editor" kicker="Plan" title="Route planner">
      <${Segmented} value=${draft.mode} onChange=${mode => setDraft({ ...draft, mode })} options=${modes} label="Movement mode" />
      <p class="muted-note">${modeHints[draft.mode]}</p>
      ${draft.mode !== 'idle' && html`
        <ol class="waypoints">
          ${points.map((p, i) => html`<li key=${i} class="waypoint-row">
            <span class="node-num">${i + 1}</span>
            ${['x', 'y', 'z'].map(k => html`<label key=${k} class="coord"><span>${k.toUpperCase()}</span><input class="input mono" inputmode="numeric" value=${p[k]} onInput=${e => edit(i, k, e.currentTarget.value.trim())} aria-label=${`Point ${i + 1} ${k.toUpperCase()}`} /></label>`)}
            <span class="waypoint-row__name">${p.name || ''}</span>
            <span class="waypoint-row__tools">
              <button type="button" class="icon-btn icon-btn--sm" aria-label="Move up" disabled=${i === 0} onClick=${() => swap(i, i - 1)}><${Icon} name="chevron" class="rot-180" /></button>
              <button type="button" class="icon-btn icon-btn--sm" aria-label="Move down" disabled=${i === points.length - 1} onClick=${() => swap(i, i + 1)}><${Icon} name="chevron" /></button>
              <button type="button" class="icon-btn icon-btn--sm" aria-label="Remove point" onClick=${() => set(points.filter((_, j) => j !== i))}><${Icon} name="close" /></button>
            </span>
          </li>`)}
          ${!points.length && html`<li class="waypoints__empty">No points yet. Click the map, use the buttons below, or paste a list.</li>`}
        </ol>
        <div class="btn-row btn-row--wrap">
          <${McButton} size="sm" icon="plus" onClick=${() => addDraftPoint(here || { x: 0, y: 64, z: 0 })}>Point<//>
          <${McButton} size="sm" icon="locate" disabled=${!here} onClick=${() => addDraftPoint(here)} title=${account ? `Where ${displayName(account)} stands` : ''}>Current position<//>
          <${McButton} size="sm" icon="file" onClick=${() => openModal('paste-points')}>Paste list<//>
          ${points.length > 0 && html`<${McButton} size="sm" variant="ghost" icon="trash" onClick=${() => set([])}>Clear<//>`}
        </div>`}
      ${error && points.length > 0 && html`<p class="field__hint is-error">${error}</p>`}
      <div class="planner__apply">
        <${TargetLine} />
        <div class="btn-row">
          <${McButton} variant="primary" icon="route" disabled=${!list.length || Boolean(error)} onClick=${apply}>Apply ${draft.mode === 'idle' ? 'Stay AFK' : 'route'}<//>
          <${McButton} icon="stop" disabled=${!list.some(a => a.route.mode !== 'idle')} onClick=${() => run(() => stopRoute(list.map(a => a.id)))}>Stop moving<//>
        </div>
        <p class="muted-note">Use the block your feet occupy for Y. Routes never break or place blocks, and resume after reconnecting.</p>
      </div>
    <//>
    <${GamePanel} class="planner__map" flush kicker=${account ? `Map · ${displayName(account)}` : 'Map'} title="Click to add points">
      <${MapView} compact data=${enabled ? state.data : null} message=${mapMessage(account, enabled, state)} account=${account} others=${mapNeighbours(account)} selectedIds=${store.selected}
        draft=${draft.mode === 'idle' ? null : draft} waypoints=${waypoints} overlays=${{ grid: store.prefs.chunkGrid, players: store.prefs.mapPlayers, routes: true, waypoints: true }}
        onPick=${p => { if (!p.tile) return toast('That chunk isn’t loaded yet.', 'warn'); if (draft.mode === 'idle') setDraft({ ...draft, mode: 'loop' }); addDraftPoint({ x: p.x, y: p.tile.y, z: p.z }) }}
        onFocus=${a => focus(a.id)} hint="Click a surface to add it to the plan" />
    <//>
    <${GamePanel} class="planner__waypoints" kicker="Saved" title="Waypoints" actions=${html`<${McButton} size="sm" variant="ghost" icon="flag" disabled=${!here} onClick=${() => openModal('waypoint', { point: here })}>Save position<//>`}>
      ${waypoints.length ? html`<ul class="saved-waypoints">${waypoints.map(w => html`<li key=${w.id}>
        <${Icon} name="flag" class="tone-waypoint" />
        <span><b>${w.name}</b><small class="mono">${w.x} ${w.y} ${w.z}</small></span>
        <button type="button" class="icon-btn icon-btn--sm" title="Add to plan" aria-label=${`Add ${w.name} to plan`} onClick=${() => addDraftPoint(w)}><${Icon} name="plus" /></button>
        <button type="button" class="icon-btn icon-btn--sm" title="Delete" aria-label=${`Delete ${w.name}`} onClick=${() => removeWaypoint(w.id)}><${Icon} name="trash" /></button>
      </li>`)}</ul>` : html`<p class="muted-note">Save spots you visit often, like a base or a farm. Right-click the map or use “Save position”.</p>`}
    <//>
  </div>`
}

function Overview () {
  const list = [...accounts()].sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)))
  const current = focused()
  if (!list.length) return null
  return html`<${GamePanel} kicker="Overview" title="Movement" class="overview">
    <div class="overview__table" role="table">
      <div class="overview__row overview__row--head" role="row"><span>Account</span><span>Status</span><span>Route</span><span>Target</span><span>Distance</span><span></span></div>
      ${list.map(a => {
        const route = routeOf(a)
        const d = route.target && a.position ? flatDistance(a.position, route.target) : null
        return html`<div key=${a.id} role="row" class=${cx('overview__row', a.id === current?.id && 'is-focused', store.selected.has(a.id) && 'is-selected')}>
          <button type="button" class="overview__who" onClick=${() => focus(a.id)}><${PlayerHead} name=${displayName(a)} size=${24} status=${a} /><b>${displayName(a)}</b></button>
          <span><${StatusBadge} account=${a} /></span>
          <span><span class=${cx('route-chip', `route-chip--${route.mode}`)}>${route.label}</span>${route.mode === 'loop' && html`<small> ${a.routeIndex + 1}/${a.route.points.length}</small>`}</span>
          <span class="mono">${route.target ? `${route.target.x} ${route.target.y} ${route.target.z}` : '—'}</span>
          <span>${d != null && isOnline(a) ? `${Math.round(d)} blocks · ~${eta(d)}` : '—'}</span>
          <span class="overview__actions">
            <button type="button" class="icon-btn icon-btn--sm" title="Load into planner" aria-label="Load route into planner" disabled=${route.mode === 'idle'} onClick=${() => { setDraft({ mode: a.route.mode, points: a.route.points.map(p => ({ ...p })) }); setSelection([a.id]); focus(a.id) }}><${Icon} name="edit" /></button>
            <button type="button" class="icon-btn icon-btn--sm" title="Stop" aria-label="Stop" disabled=${route.mode === 'idle'} onClick=${() => run(() => stopRoute([a.id]))}><${Icon} name="stop" /></button>
          </span>
        </div>`
      })}
    </div>
  <//>`
}

// Minecraft yaw: 0 south, 90 west, 180 north, -90 east.
const dial = [['NW', 135], ['N', 180], ['NE', -135], ['W', 90], null, ['E', -90], ['SW', 45], ['S', 0], ['SE', -45]]

function Behavior () {
  const list = targets()
  const source = list[0]
  const [form, setForm] = useState(() => structuredClone(source?.actions))
  const key = list.map(a => a.id).join()
  useEffect(() => { if (source) setForm(structuredClone(source.actions)) }, [key])
  if (!source || !form) return html`<${GamePanel}><${EmptyState} icon="pause" title="No accounts">Add an account to set its idle behavior.<//><//>`
  const set = patch => setForm({ ...form, ...patch })
  const anti = patch => setForm({ ...form, antiAfk: { ...form.antiAfk, ...patch } })
  const ids = list.map(a => a.id)
  const apply = () => run(async () => { await applyActions(ids, { ...form, yaw: Number(form.yaw), pitch: Number(form.pitch), antiAfk: { ...form.antiAfk, interval: Number(form.antiAfk.interval) } }); toast(`Behavior saved for ${plural(ids.length, 'account')}. Idle pose applies when walking stops.`, 'success') })
  const disableAnti = () => run(async () => {
    for (const a of list) await applyActions([a.id], { ...a.actions, antiAfk: { ...a.actions.antiAfk, enabled: false } })
    anti({ enabled: false })
    toast('Anti-AFK disabled.', 'success')
  })
  const online = list.filter(isOnline)
  return html`<div class="behavior">
    <div class="behavior__bar"><${TargetLine} />${list.length > 1 && html`<small class="muted">Form loaded from ${displayName(source)}.</small>`}</div>
    <div class="behavior__grid">
      <${GamePanel} kicker="Idle" title="Pose">
        <div class="pose">
          <div class="dial" role="group" aria-label="Facing direction">
            ${dial.map((d, i) => d ? html`<button key=${i} type="button" class=${cx('dial__btn', Number(form.yaw) === d[1] && 'is-active')} onClick=${() => set({ yaw: d[1] })}>${d[0]}</button>` : html`<span key=${i} class="dial__center"><${PlayerHead} name=${displayName(source)} size=${24} /></span>`)}
          </div>
          <div class="pose__fields">
            <${Field} label="Yaw" hint="0 south · 90 west · 180 north · -90 east"><input class="input mono" type="number" min="-180" max="180" step="any" value=${form.yaw} onInput=${e => set({ yaw: e.currentTarget.value })} /><//>
            <${Field} label=${`Pitch · ${form.pitch}°`} hint="-90 looks up · 0 level · 90 looks down">
              <input type="range" min="-90" max="90" step="1" value=${form.pitch} onInput=${e => set({ pitch: Number(e.currentTarget.value) })} />
            <//>
          </div>
        </div>
        <${Field} label="Hotbar slot">
          <div class="hotbar-pick" role="radiogroup">${Array.from({ length: 9 }, (_, i) => html`<button key=${i} type="button" role="radio" aria-checked=${form.slot === i + 1} class=${cx('hotbar-pick__slot', form.slot === i + 1 && 'is-active')} onClick=${() => set({ slot: i + 1 })}>${i + 1}</button>`)}</div>
        <//>
        <${Toggle} checked=${form.sneak} onChange=${v => set({ sneak: v })} label="Keep sneaking while idle" />
      <//>
      <${GamePanel} kicker="Repeat" title="Anti-AFK" actions=${html`<${Toggle} checked=${form.antiAfk.enabled} onChange=${v => anti({ enabled: v })} label=${form.antiAfk.enabled ? 'On' : 'Off'} />`}>
        <div class=${cx('anti', !form.antiAfk.enabled && 'is-off')}>
          <${Field} label=${`Every ${form.antiAfk.interval} seconds`} hint="Between 5 seconds and one hour.">
            <div class="range-row">
              <input type="range" min="5" max="300" step="5" value=${Math.min(300, form.antiAfk.interval)} onInput=${e => anti({ interval: Number(e.currentTarget.value) })} />
              <input class="input mono range-row__input" type="number" min="5" max="3600" value=${form.antiAfk.interval} onInput=${e => anti({ interval: Number(e.currentTarget.value) })} aria-label="Interval in seconds" />
            </div>
          <//>
          <p class="field__label">Actions</p>
          <div class="chips">
            ${[['jump', 'Jump'], ['sneak', 'Sneak / stand'], ['swing', 'Swing arm'], ['rotate', 'Turn head'], ['hotbar', 'Cycle hotbar']].map(([k, label]) => html`<button key=${k} type="button" class=${cx('chip-toggle', form.antiAfk[k] && 'is-on')} aria-pressed=${form.antiAfk[k]} onClick=${() => anti({ [k]: !form.antiAfk[k] })}>${form.antiAfk[k] && html`<${Icon} name="check" />`}${label}</button>`)}
          </div>
          <p class="muted-note">While walking, only arm swings and hotbar cycling run; the pathfinder controls looking, jumping and sneaking.</p>
        </div>
      <//>
      <${GamePanel} kicker="Now" title="Quick actions">
        <div class="quick-actions">
          <${McButton} icon="arrow" disabled=${!online.length} onClick=${() => run(() => playerAction(online.map(a => a.id), 'jump'))}>Jump<//>
          <${McButton} icon="minus" disabled=${!online.length} onClick=${() => run(() => playerAction(online.map(a => a.id), 'sneak'))}>Sneak<//>
          <${McButton} icon="sword" disabled=${!online.length} onClick=${() => run(() => playerAction(online.map(a => a.id), 'swing'))}>Swing<//>
        </div>
        <p class="muted-note">${online.length ? `Runs once on ${plural(online.length, 'online account')}. Swinging doesn’t attack or break blocks.` : 'Join the server to use quick actions.'}</p>
      <//>
    </div>
    <footer class="behavior__foot">
      <${McButton} variant="primary" icon="check" onClick=${apply}>Save behavior<//>
      <${McButton} icon="pause" onClick=${disableAnti}>Disable anti-AFK<//>
      <${McButton} variant="ghost" onClick=${() => setForm(structuredClone(source.actions))}>Reset<//>
    </footer>
  </div>`
}

export function RoutesScreen () {
  const [tab, setTab] = useState('planner')
  return html`<div class="routes">
    <${ScreenHeader} title="Routes" subtitle="Plan where accounts walk, and what they do while they wait.">
      <${Segmented} value=${tab} onChange=${setTab} label="Section" options=${[{ value: 'planner', label: 'Route planner', icon: 'route' }, { value: 'behavior', label: 'Idle & anti-AFK', icon: 'pause' }]} />
    <//>
    ${tab === 'planner' ? html`<${Planner} /><${Overview} />` : html`<${Behavior} />`}
  </div>`
}

export function PastePointsModal () {
  const [text, setText] = useState('')
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const parsed = lines.map(line => line.split(/[\s,]+/))
  const bad = parsed.findIndex(parts => parts.length !== 3 || !parts.every(p => /^-?\d+$/.test(p)))
  const add = () => {
    setDraft({ ...store.draft, mode: store.draft.mode === 'idle' ? 'loop' : store.draft.mode, points: [...store.draft.points, ...parsed.map(([x, y, z]) => ({ x: Number(x), y: Number(y), z: Number(z) }))].slice(0, 100) })
    closeModal()
  }
  return html`<${Modal} title="Paste waypoints" icon="file" footer=${html`
    <${McButton} variant="ghost" onClick=${closeModal}>Cancel<//>
    <${McButton} variant="primary" disabled=${!lines.length || bad >= 0} onClick=${add}>Add ${lines.length || ''} ${lines.length === 1 ? 'point' : 'points'}<//>`}>
    <${Field} label="X Y Z, one point per line" error=${bad >= 0 ? `Line ${bad + 1} needs three whole numbers.` : null} hint="Commas or spaces both work.">
      <textarea class="input mono" rows="7" value=${text} onInput=${e => setText(e.currentTarget.value)} placeholder=${'100 64 200\n110 64 200'} spellcheck="false" autofocus></textarea>
    <//>
  <//>`
}
