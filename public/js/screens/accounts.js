// ACCOUNTS: the alt manager. Dense rows that stay readable from 1 to 50+ accounts.
import { html, cx, memo, useEffect, useRef, useState } from '../lib/preact.js'
import { store, accounts, focused, update } from '../core/store.js'
import { run, join, leave, login, removeAccount, addAccounts, openModal, closeModal, focus, toggleSelected, setSelection, openGameplay, navigate, setPref, setDraft, toast } from '../core/actions.js'
import { isOnline, isActive, isMappable, displayName, statusOf, authOf, serverLabel, routeOf, coords, flatDistance, eta } from '../core/format.js'
import { Icon } from '../ui/icon.js'
import { McButton, ScreenHeader, PlayerHead, StatusBadge, SignalBars, Checkbox, Segmented, Field, Popover, MenuItem, EmptyState } from '../ui/primitives.js'
import { Modal } from '../ui/overlays.js'

const msLink = url => /^https:\/\/([a-z0-9-]+\.)?(microsoft\.com|live\.com)\//i.test(url) ? url : 'https://www.microsoft.com/link'

function Countdown ({ until }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t) }, [])
  const left = Math.max(0, Math.round((until - Date.now()) / 1000))
  return html`<span class=${cx('device-code__timer', left < 60 && 'is-low')}>${left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : 'Expired'}</span>`
}

export function DeviceCode ({ account }) {
  const code = account.code
  const expired = code.expiresAt < Date.now()
  return html`<div class="device-code" onClick=${e => e.stopPropagation()}>
    <span class="device-code__icon"><${Icon} name="microsoft" /></span>
    <div class="device-code__text">
      <b>Microsoft sign-in</b>
      <p>${expired ? 'This code expired. Wait for the attempt to finish, then sign in again.' : html`Open the Microsoft page and enter this code, signed in as <b>${account.label}</b>.`}</p>
    </div>
    ${!expired && html`<code class="device-code__code">${code.userCode}</code>
    <div class="device-code__actions">
      <${McButton} size="sm" icon="copy" onClick=${() => run(async () => { await navigator.clipboard.writeText(code.userCode); toast('Login code copied.', 'success') })}>Copy<//>
      <a class="btn btn--sm btn--primary" href=${msLink(code.url)} target="_blank" rel="noopener noreferrer"><span class="btn__label">Open Microsoft</span><${Icon} name="external" /></a>
    </div>
    <${Countdown} until=${code.expiresAt} />`}
  </div>`
}

function Vitals ({ a }) {
  if (!isOnline(a)) return html`<span class="muted">—</span>`
  return html`<span class="vitals">
    <span title="Ping"><${SignalBars} ms=${a.ping} /><small>${a.ping != null ? `${a.ping} ms` : '—'}</small></span>
    <span>
      ${a.health != null && html`<span class="vitals__stat tone-error" title="Health"><${Icon} name="heart" />${Math.round(a.health)}</span>`}
      ${a.food != null && html`<span class="vitals__stat vitals__stat--food" title="Food"><${Icon} name="food" />${a.food}</span>`}
    </span>
  </span>`
}

function primaryAction (a) {
  if (a.auth === 'microsoft' && !a.username && !isActive(a)) return html`<${McButton} size="sm" icon="microsoft" onClick=${() => run(() => login(a.id))}>Sign in<//>`
  if (isActive(a)) return html`<${McButton} size="sm" icon="power" onClick=${() => run(() => leave([a.id]))}>${isOnline(a) ? 'Disconnect' : 'Cancel'}<//>`
  return html`<${McButton} size="sm" variant="primary" icon="play" onClick=${() => run(() => join([a.id]))}>Connect<//>`
}

function AccountRowView ({ a, selected, isFocused, onCheck }) {
  const status = statusOf(a)
  const auth = authOf(a)
  const route = routeOf(a)
  const target = route.target && a.position ? flatDistance(a.position, route.target) : null
  return html`<div class=${cx('acc-row', isFocused && 'is-focused', selected && 'is-selected', `tone-row-${status.tone}`)} onClick=${() => focus(a.id)} role="row" aria-selected=${selected}>
    <${Checkbox} checked=${selected} onChange=${(checked, e) => onCheck(a.id, checked, e.shiftKey)} label=${`Select ${displayName(a)}`} />
    <${PlayerHead} name=${displayName(a)} size=${40} status=${a} focus=${isFocused} />
    <div class="acc-row__id">
      <div class="acc-row__name"><b>${displayName(a)}</b>${isFocused && html`<span class="tag tag--accent">Controlling</span>`}</div>
      <div class="acc-row__sub"><span class=${cx('auth', `auth--${auth.tone}`)}>${a.auth === 'microsoft' && html`<${Icon} name="microsoft" />`}${auth.label}</span>${a.label !== a.username && html`<span class="acc-row__label">${a.label}</span>`}</div>
    </div>
    <div class="acc-row__cell acc-row__status">
      <${StatusBadge} account=${a} />
      <small>${a.server ? serverLabel(a.server) : status.tone === 'error' ? 'See error below' : 'Not connected'}</small>
    </div>
    <div class="acc-row__cell acc-row__pos">
      <span class="mono">${a.position ? coords(a.position) : '—'}</span>
      <small>${a.dimension ? String(a.dimension).replace('minecraft:', '').replaceAll('_', ' ') : isOnline(a) ? 'Loading position…' : 'Offline'}</small>
    </div>
    <div class="acc-row__cell acc-row__route">
      <span class=${cx('route-chip', `route-chip--${route.mode}`)}>${route.label}</span>
      <small>${target != null ? `${Math.round(target)} blocks · ~${eta(target)}` : route.detail}</small>
    </div>
    <div class="acc-row__cell acc-row__vitals"><${Vitals} a=${a} /></div>
    <div class="acc-row__actions" onClick=${e => e.stopPropagation()}>
      ${primaryAction(a)}
      <button type="button" class="icon-btn" title="Show on map" aria-label="Show on map" disabled=${!isMappable(a)} onClick=${() => { focus(a.id); navigate('map') }}><${Icon} name="locate" /></button>
      <button type="button" class="icon-btn" title="Open gameplay" aria-label="Open gameplay" disabled=${!isMappable(a)} onClick=${() => run(() => openGameplay(a.id))}><${Icon} name="sword" /></button>
      <${Popover} align="end" trigger=${({ toggle, open }) => html`<button type="button" class=${cx('icon-btn', open && 'is-active')} aria-label="More actions" onClick=${toggle}><${Icon} name="more" /></button>`}>
        <div class="menu">
          <${MenuItem} icon="route" onClick=${() => { focus(a.id); setSelection([a.id]); setDraft({ mode: a.route.mode === 'idle' ? 'loop' : a.route.mode, points: a.route.points.map(p => ({ ...p })) }); navigate('routes') }}>Edit route<//>
          ${a.auth === 'microsoft' && html`<${MenuItem} icon="microsoft" disabled=${isActive(a)} onClick=${() => run(() => login(a.id))}>${a.username ? 'Sign in again' : 'Sign in'}<//>`}
          <${MenuItem} icon="copy" onClick=${() => run(async () => { await navigator.clipboard.writeText(a.label); toast('Label copied.', 'success') })}>Copy label<//>
          <${MenuItem} icon="trash" danger disabled=${isActive(a)} hint=${isActive(a) ? 'Disconnect first' : null} onClick=${() => removeAccount(a)}>Remove account<//>
        </div>
      <//>
    </div>
    ${a.code && html`<${DeviceCode} account=${a} />`}
    ${a.error && !a.code && html`<p class="acc-row__error"><${Icon} name="warning" />${a.error}</p>`}
  </div>`
}

const AccountRow = memo(AccountRowView, (p, n) => p.selected === n.selected && p.isFocused === n.isFocused && p.onCheck === n.onCheck && JSON.stringify(p.a) === JSON.stringify(n.a))

const filters = {
  all: () => true,
  online: a => isOnline(a),
  offline: a => !isActive(a),
  attention: a => Boolean(a.code || a.error || ['login required', 'login failed', 'path blocked'].includes(a.status) || (a.auth === 'microsoft' && !a.username))
}
const toneOrder = { control: 0, walking: 1, online: 2, warn: 3, attention: 4, busy: 5, error: 6, offline: 7 }
const sorts = {
  status: (a, b) => toneOrder[statusOf(a).tone] - toneOrder[statusOf(b).tone] || displayName(a).localeCompare(displayName(b)),
  name: (a, b) => displayName(a).localeCompare(displayName(b)),
  added: () => 0
}

export function AccountsScreen () {
  const [query, setQuery] = useState('')
  const last = useRef(null)
  const all = accounts()
  const current = focused()
  const filter = store.prefs.accountFilter
  const shown = all
    .filter(filters[filter] || filters.all)
    .filter(a => !query || `${a.username} ${a.label}`.toLowerCase().includes(query.toLowerCase()))
    .sort(sorts[store.prefs.accountSort] || sorts.status)
  const visibleIds = shown.map(a => a.id)
  const selectedVisible = visibleIds.filter(id => store.selected.has(id)).length
  const counts = Object.fromEntries(Object.entries(filters).map(([k, f]) => [k, all.filter(f).length]))

  // Shift-click selects the range since the previous checkbox.
  const onCheck = useRef((id, checked, shift) => {
    const ids = onCheck.ids
    if (shift && last.current && ids.includes(last.current)) {
      const [from, to] = [ids.indexOf(last.current), ids.indexOf(id)].sort((x, y) => x - y)
      const next = new Set(store.selected)
      ids.slice(from, to + 1).forEach(i => checked ? next.add(i) : next.delete(i))
      update({ selected: next })
    } else toggleSelected(id, checked)
    last.current = id
  }).current
  onCheck.ids = visibleIds

  const attention = counts.attention
  return html`<div class="acc">
    <${ScreenHeader} title="Accounts" subtitle=${all.length ? `${all.length} accounts · ${counts.online} online${attention ? ` · ${attention} need attention` : ''}` : 'Add the accounts StayAlive should keep online.'}>
      <${McButton} variant="primary" icon="plus" onClick=${() => openModal('add-account')}>Add account<//>
    <//>
    ${all.length ? html`
      <div class="acc-toolbar">
        <${Checkbox} checked=${shown.length > 0 && selectedVisible === shown.length} indeterminate=${selectedVisible > 0 && selectedVisible < shown.length} onChange=${checked => setSelection(checked ? [...new Set([...store.selected, ...visibleIds])] : [...store.selected].filter(id => !visibleIds.includes(id)))} label="Select all shown accounts" />
        <label class="search"><${Icon} name="search" /><input type="search" placeholder="Search accounts" value=${query} onInput=${e => setQuery(e.currentTarget.value)} /></label>
        <${Segmented} value=${filter} onChange=${v => setPref('accountFilter', v)} size="sm" label="Filter" options=${[
          { value: 'all', label: `All ${counts.all}` },
          { value: 'online', label: `Online ${counts.online}` },
          { value: 'offline', label: `Offline ${counts.offline}` },
          { value: 'attention', label: `Attention ${counts.attention}` }
        ]} />
        <label class="select-inline"><span>Sort</span>
          <select class="input" value=${store.prefs.accountSort} onChange=${e => setPref('accountSort', e.currentTarget.value)}>
            <option value="status">Status</option><option value="name">Name</option><option value="added">Added</option>
          </select>
        </label>
        <span class="acc-toolbar__spacer"></span>
        <button type="button" class="link-btn" disabled=${!counts.online} onClick=${() => setSelection(all.filter(isOnline).map(a => a.id))}>Select online</button>
        <button type="button" class="link-btn" disabled=${!counts.offline} onClick=${() => setSelection(all.filter(a => !isActive(a)).map(a => a.id))}>Select offline</button>
      </div>
      <div class="acc-head" aria-hidden="true"><span></span><span></span><span>Account</span><span>Status · server</span><span>Position</span><span>Route</span><span>Link</span><span></span></div>
      <div class="acc-list" role="grid" aria-label="Accounts">
        ${shown.map(a => html`<${AccountRow} key=${a.id} a=${a} selected=${store.selected.has(a.id)} isFocused=${a.id === current?.id} onCheck=${onCheck} />`)}
        ${!shown.length && html`<p class="muted-note acc-list__none">No accounts match this view.</p>`}
      </div>` : html`<div class="acc-empty"><${EmptyState} title="Room for your accounts" action=${html`<${McButton} variant="primary" size="lg" icon="plus" onClick=${() => openModal('add-account')}>Add account<//>`}>Add Microsoft accounts (signed in through Microsoft in your browser) or offline names for your own servers.<//></div>`}
  </div>`
}

export function AddAccountModal () {
  const [auth, setAuth] = useState('microsoft')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const file = useRef()
  const count = [...new Set(text.split(/[\n,]/).map(s => s.trim()).filter(Boolean))].length
  const submit = e => {
    e?.preventDefault()
    setBusy(true)
    run(async () => { await addAccounts(text, auth); closeModal() }).finally(() => setBusy(false))
  }
  const load = () => run(async () => {
    const f = file.current.files[0]
    if (!f) return
    if (f.size > 65536) throw Error('Account files must be smaller than 64 KB.')
    setText(await f.text())
    file.current.value = ''
  })
  return html`<${Modal} title="Add accounts" icon="face" footer=${html`
    <${McButton} variant="ghost" icon="file" onClick=${() => file.current.click()}>Load .txt<//>
    <span class="modal__spacer"></span>
    <${McButton} variant="ghost" onClick=${closeModal}>Cancel<//>
    <${McButton} variant="primary" icon="plus" disabled=${!count || busy} onClick=${submit}>${count > 1 ? `Add ${count} accounts` : 'Add account'}<//>`}>
    <form class="form" onSubmit=${submit}>
      <${Segmented} value=${auth} onChange=${setAuth} label="Sign-in method" options=${[{ value: 'microsoft', label: 'Microsoft account', icon: 'microsoft' }, { value: 'offline', label: 'Offline username', icon: 'user' }]} />
      <${Field} label=${auth === 'microsoft' ? 'Labels or emails, one per line' : 'Usernames, one per line'} hint=${auth === 'microsoft' ? 'Labels only name the session. Each account signs in on Microsoft’s website. Never paste passwords here.' : 'For servers with online-mode turned off. 3–16 letters, digits or underscores.'}>
        <textarea class="input mono" rows="6" value=${text} onInput=${e => setText(e.currentTarget.value)} placeholder=${auth === 'microsoft' ? 'main@example.com\nsecond-account' : 'Builder_01\nFarmer_02'} spellcheck="false" autofocus></textarea>
      <//>
      <input ref=${file} type="file" accept=".txt,text/plain" hidden onChange=${load} />
    </form>
  <//>`
}
