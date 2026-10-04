// TopStatusBar: who you control, where they are, and how the client is doing.
import { html, cx, useState } from '../lib/preact.js'
import { store, accounts, focused, activeServer } from '../core/store.js'
import { focus, navigate, toggleConsole } from '../core/actions.js'
import { isOnline, displayName, serverLabel, sameServer, statusOf, blockCoords, serverKey } from '../core/format.js'
import { Icon } from '../ui/icon.js'
import { PlayerHead, StatusBadge, Popover, SignalBars } from '../ui/primitives.js'
import { menu } from './sidebar.js'

// AccountSelector: picks the controlled account used by Map, Gameplay and Play.
export function AccountSelector ({ compact }) {
  const [query, setQuery] = useState('')
  const current = focused()
  const list = accounts()
  const shown = list.filter(a => !query || `${a.username} ${a.label}`.toLowerCase().includes(query.toLowerCase()))
  return html`<${Popover} class="account-selector" align="end" trigger=${({ open, toggle }) => html`
    <button type="button" class=${cx('account-selector__trigger', open && 'is-open')} onClick=${toggle} aria-haspopup="listbox" aria-expanded=${open} disabled=${!list.length}>
      ${current ? html`<${PlayerHead} name=${displayName(current)} size=${28} status=${current} focus />` : html`<span class="head head--28 head--empty"><${Icon} name="user" /></span>`}
      <span class="account-selector__text">
        <small>Controlling</small>
        <b>${current ? displayName(current) : 'No accounts'}</b>
      </span>
      ${!compact && current && html`<${StatusBadge} account=${current} />`}
      <${Icon} name="chevron" class="account-selector__chevron" />
    </button>`}>
    <div class="account-menu">
      ${list.length > 6 && html`<label class="account-menu__search"><${Icon} name="search" /><input type="search" placeholder="Find an account" value=${query} onInput=${e => setQuery(e.currentTarget.value)} autofocus /></label>`}
      <div class="account-menu__list" role="listbox">
        ${shown.map(a => html`<button key=${a.id} type="button" role="option" aria-selected=${a.id === current?.id} class=${cx('account-menu__item', a.id === current?.id && 'is-current')} onClick=${() => focus(a.id)} data-close>
          <${PlayerHead} name=${displayName(a)} size=${24} status=${a} />
          <span class="account-menu__name"><b>${displayName(a)}</b><small>${isOnline(a) ? (a.position ? blockCoords(a.position) : serverLabel(a.server)) : statusOf(a).label}</small></span>
          ${a.id === current?.id && html`<${Icon} name="check" />`}
        </button>`)}
        ${!shown.length && html`<p class="account-menu__empty">No matching accounts.</p>`}
      </div>
      <button type="button" class="account-menu__foot" onClick=${() => navigate('accounts')} data-close><${Icon} name="face" /> Manage accounts</button>
    </div>
  <//>`
}

function ServerChip () {
  const server = activeServer()
  if (!server) return html`<button type="button" class="chip chip--warn" onClick=${() => navigate('multiplayer')}><${Icon} name="globe" /><span>Choose a server</span></button>`
  const ping = store.pings[serverKey(server.host, server.port)]
  const online = accounts().filter(a => isOnline(a) && sameServer(a.server, server))
  const latency = online.find(a => a.ping != null)?.ping ?? ping?.data?.latency
  return html`<button type="button" class="chip" onClick=${() => navigate('multiplayer')} title="Server accounts join">
    <${SignalBars} ms=${latency} error=${ping?.state === 'error' && !online.length} />
    <span class="chip__main">${serverLabel(server)}</span>
    <span class="chip__sub">${online.length ? `${online.length} in game` : 'idle'}</span>
  </button>`
}

export function TopStatusBar () {
  const list = accounts()
  const online = list.filter(isOnline).length
  const memory = store.snapshot.memory
  const page = menu.find(m => m.page === store.page)
  return html`<header class="topbar">
    <div class="topbar__title">
      <span class="topbar__kicker">${page?.hint}</span>
      <span class="topbar__page">${page?.label}</span>
    </div>
    <div class="topbar__status">
      <${AccountSelector} />
      <${ServerChip} />
      <span class="chip chip--static" title="Connected accounts">
        <i class=${cx('dot', online ? 'tone-online' : 'tone-offline')} aria-hidden="true"></i>
        <span class="chip__main">${online}<small>/${list.length}</small></span><span class="chip__sub">online</span>
      </span>
      <span class=${cx('chip chip--static chip--memory', memory > 1500 && 'chip--warn')} title="Memory used by the StayAlive process">
        <${Icon} name="chip" /><span class="chip__main">${memory}<small> MB</small></span>
      </span>
      <button type="button" class=${cx('icon-btn', store.consoleOpen && 'is-active')} onClick=${() => toggleConsole()} title="Console ( \` )" aria-label="Toggle console">
        <${Icon} name="console" />${store.unread > 0 && html`<span class="icon-btn__badge">${store.unread > 99 ? '99+' : store.unread}</span>`}
      </button>
      <button type="button" class=${cx('icon-btn', store.page === 'settings' && 'is-active')} onClick=${() => navigate('settings')} title="Settings" aria-label="Settings"><${Icon} name="settings" /></button>
    </div>
  </header>`
}
