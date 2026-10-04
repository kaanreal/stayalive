// SelectionDock: the multi-account control bar. Visible on every screen while accounts are selected.
import { html, cx } from '../lib/preact.js'
import { store, accounts, selectedAccounts, focused, update } from '../core/store.js'
import { run, join, leave, stopRoute, navigate, openGameplay, setSelection, clearSelection, toggleSelected, setRoute, toast } from '../core/actions.js'
import { isOnline, isActive, isMappable, displayName, statusOf } from '../core/format.js'
import { Icon } from '../ui/icon.js'
import { McButton, HeadStack, PlayerHead, Popover } from '../ui/primitives.js'

export function SelectionDock () {
  const chosen = selectedAccounts()
  if (!chosen.length) return null
  const online = chosen.filter(isOnline)
  const joinable = chosen.filter(a => !isActive(a))
  const leavable = chosen.filter(isActive)
  const moving = online.filter(a => a.route.mode !== 'idle')
  const draft = store.draft
  const control = chosen.find(a => a.id === focused()?.id && isMappable(a)) || chosen.find(isMappable)
  const startRoute = () => run(async () => {
    const valid = draft.mode === 'goto' ? draft.points.length === 1 : draft.points.length >= 2
    if (!valid) { navigate('routes'); toast('Plan a route first, then apply it to the selection.', 'info'); return }
    await setRoute(chosen.map(a => a.id), { mode: draft.mode, points: draft.points.map(({ x, y, z }) => ({ x, y, z })) })
    toast(`Route applied to ${chosen.length} ${chosen.length === 1 ? 'account' : 'accounts'}.`, 'success')
  })
  return html`<div class="dock" role="region" aria-label="Selected accounts">
    <${Popover} align="start" class="dock__who" trigger=${({ toggle, open }) => html`
      <button type="button" class=${cx('dock__count', open && 'is-open')} onClick=${toggle} aria-expanded=${open}>
        <${HeadStack} accounts=${chosen} max=${4} size=${24} />
        <span><b>${chosen.length} selected</b><small>${online.length} online · ${chosen.length - online.length} offline</small></span>
        <${Icon} name="chevron" />
      </button>`}>
      <div class="dock__list">
        ${chosen.map(a => html`<div key=${a.id} class="dock__row">
          <${PlayerHead} name=${displayName(a)} size=${24} status=${a} />
          <span><b>${displayName(a)}</b><small>${statusOf(a).label}</small></span>
          <button type="button" class="icon-btn icon-btn--sm" aria-label=${`Deselect ${displayName(a)}`} onClick=${() => toggleSelected(a.id, false)}><${Icon} name="close" /></button>
        </div>`)}
      </div>
    <//>
    <div class="dock__actions">
      <${McButton} variant="primary" icon="play" disabled=${!joinable.length} onClick=${() => run(() => join(joinable.map(a => a.id)))} title="Join the active server">Join${joinable.length && joinable.length !== chosen.length ? ` ${joinable.length}` : ''}<//>
      <${McButton} icon="power" disabled=${!leavable.length} onClick=${() => run(() => leave(leavable.map(a => a.id)))}>Disconnect<//>
      <span class="dock__sep" aria-hidden="true"></span>
      <${McButton} icon="route" onClick=${startRoute} title=${draft.points.length ? `Apply the planned route (${draft.points.length} points)` : 'Plan a route'}>Start route<//>
      <${McButton} icon="stop" disabled=${!moving.length} onClick=${() => run(() => stopRoute(moving.map(a => a.id)))}>Stop<//>
      <${McButton} icon="move" active=${store.picking} disabled=${!online.length} onClick=${() => { update({ picking: true }); navigate('map') }} title="Pick a destination on the map">Move<//>
      <${McButton} icon="sword" disabled=${!control} onClick=${() => run(() => openGameplay(control.id))} title=${control ? `Play as ${displayName(control)}` : 'Join first'}>Gameplay<//>
    </div>
    <div class="dock__end">
      <button type="button" class="link-btn" onClick=${() => setSelection(accounts().map(a => a.id))}>Select all</button>
      <button type="button" class="icon-btn" aria-label="Clear selection" title="Clear selection (Esc)" onClick=${clearSelection}><${Icon} name="close" /></button>
    </div>
  </div>`
}
