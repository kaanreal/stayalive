// PLAY: the home screen. One big, state-aware button gets the controlled account into the game.
import { html, cx, useEffect } from '../lib/preact.js'
import { store, accounts, focused, activeServer } from '../core/store.js'
import { run, join, leave, navigate, openModal, openGameplay, focus, pingIfStale, toggleConsole } from '../core/actions.js'
import { isOnline, isActive, isMappable, BUSY, displayName, serverLabel, serverKey, sameServer, statusOf, routeOf, blockCoords, plural } from '../core/format.js'
import { Icon } from '../ui/icon.js'
import { McButton, GamePanel, PlayerHead, StatusBadge, SignalBars, Stat, EmptyState } from '../ui/primitives.js'
import { Panorama, Logo, ServerIcon } from '../ui/brand.js'
import { AccountSelector } from '../shell/topbar.js'
import { ActivityList } from '../shell/console.js'

// The one action that matters most right now, for the controlled account.
function launchAction (account, server) {
  if (!accounts().length) return { label: 'Add account', icon: 'plus', run: () => openModal('add-account'), caption: 'Add a Microsoft or offline account to get started.' }
  if (!server) return { label: 'Choose server', icon: 'servers', run: () => navigate('multiplayer'), caption: 'Pick the server your accounts should join.' }
  const name = displayName(account)
  if (account.code) return { label: 'Sign in', icon: 'microsoft', run: () => navigate('accounts'), caption: `Enter code ${account.code.userCode} at microsoft.com/link` }
  if (isMappable(account)) {
    const elsewhere = account.server && !sameServer(account.server, server)
    return { label: 'Open gameplay', icon: 'sword', run: () => openGameplay(account.id), caption: `${name} is playing on ${serverLabel(account.server)}${elsewhere ? ' (not the active server)' : ''}` }
  }
  if (BUSY.has(account.status)) return { label: `${statusOf(account).label}…`, icon: 'refresh', busy: true, caption: `${name} → ${serverLabel(account.server || server)}` }
  return { label: 'Join server', icon: 'play', run: () => join([account.id]), caption: `as ${name} on ${serverLabel(server)}` }
}

function LaunchBar () {
  const account = focused()
  const server = activeServer()
  const ping = server && store.pings[serverKey(server.host, server.port)]
  const action = launchAction(account, server)
  const joinable = accounts().filter(a => !isActive(a))
  return html`<div class="launch">
    <button type="button" class="launch__server" onClick=${() => navigate('multiplayer')}>
      <${ServerIcon} favicon=${ping?.data?.favicon} name=${server?.host || ''} size=${48} />
      <span class="launch__server-text">
        <small>Server</small>
        <b>${server ? serverLabel(server) : 'None chosen'}</b>
        <span class="launch__meta">
          ${server && html`<${SignalBars} ms=${ping?.data?.latency} loading=${ping?.state === 'loading'} error=${ping?.state === 'error'} />`}
          ${server ? (ping?.state === 'error' ? 'Unreachable' : ping?.data ? `${ping.data.players.online ?? '?'}/${ping.data.players.max ?? '?'} players · ${server.version || 'auto'}` : 'Checking…') : 'Open Multiplayer'}
        </span>
      </span>
      <${Icon} name="chevron" class="launch__chevron" />
    </button>
    <div class="launch__center">
      <button type="button" class=${cx('play-button', action.busy && 'is-busy')} disabled=${action.busy} onClick=${() => run(action.run)}>
        <${Icon} name=${action.icon} size="lg" /><span>${action.label}</span>
      </button>
      <p class="launch__caption">${action.caption}</p>
      <div class="launch__secondary">
        ${account && isActive(account) && html`<button type="button" class="link-btn" onClick=${() => run(() => leave([account.id]))}><${Icon} name="power" /> ${BUSY.has(account.status) ? 'Cancel' : 'Disconnect'}</button>`}
        ${account && isMappable(account) && html`<button type="button" class="link-btn" onClick=${() => navigate('map')}><${Icon} name="map" /> Open map</button>`}
        ${server && joinable.length > 1 && html`<button type="button" class="link-btn" onClick=${() => run(() => join(joinable.map(a => a.id)))}><${Icon} name="play" /> Join all ${joinable.length}</button>`}
      </div>
    </div>
    <div class="launch__account"><${AccountSelector} /></div>
  </div>`
}

function QuickSwitch () {
  const list = accounts()
  const current = focused()
  return html`<${GamePanel} title="Your accounts" kicker="Quick switch" actions=${html`<${McButton} size="sm" variant="ghost" icon="face" onClick=${() => navigate('accounts')}>Manage<//>`}>
    ${list.length ? html`<div class="quick-switch">
      ${list.slice(0, 15).map(a => html`<button key=${a.id} type="button" class=${cx('quick-switch__item', a.id === current?.id && 'is-current', store.selected.has(a.id) && 'is-selected')} onClick=${() => focus(a.id)} title=${`${displayName(a)} · ${statusOf(a).label}`}>
        <${PlayerHead} name=${displayName(a)} size=${40} status=${a} focus=${a.id === current?.id} />
        <span>${displayName(a)}</span>
      </button>`)}
      <button type="button" class="quick-switch__item quick-switch__add" onClick=${() => openModal('add-account')}><span class="head head--40 head--empty"><${Icon} name="plus" /></span><span>Add</span></button>
    </div>` : html`<${EmptyState} title="No accounts yet" action=${html`<${McButton} variant="primary" icon="plus" onClick=${() => openModal('add-account')}>Add account<//>`}>Add a Microsoft account, or an offline name for your own server.<//>`}
  <//>`
}

function OnlineNow () {
  const online = accounts().filter(isOnline)
  const current = focused()
  return html`<${GamePanel} title="Online now" kicker=${plural(online.length, 'account')} actions=${online.length ? html`<${McButton} size="sm" variant="ghost" icon="map" onClick=${() => navigate('map')}>Map<//>` : null}>
    ${online.length ? html`<ul class="online-list">
      ${online.slice(0, 7).map(a => {
        const route = routeOf(a)
        return html`<li key=${a.id}>
          <button type="button" class=${cx('online-list__item', a.id === current?.id && 'is-current')} onClick=${() => { focus(a.id); navigate('map') }}>
            <${PlayerHead} name=${displayName(a)} size=${28} status=${a} />
            <span class="online-list__who"><b>${displayName(a)}</b><small class="mono">${a.position ? blockCoords(a.position) : 'Spawning…'}</small></span>
            <span class="online-list__route"><${StatusBadge} account=${a} /><small>${route.label}</small></span>
          </button>
        </li>`
      })}
    </ul>` : html`<p class="muted-note">No accounts are connected. Use <b>Join server</b> above, or select several accounts and join them together.</p>`}
  <//>`
}

function ClientStatus () {
  const list = accounts()
  const online = list.filter(isOnline)
  const walking = list.filter(a => a.status === 'walking').length
  const memory = store.snapshot.memory
  return html`<${GamePanel} title="Client" kicker="Status">
    <div class="stat-grid">
      <${Stat} icon="face" label="Online" value=${online.length} unit=${`/${list.length}`} tone=${online.length ? 'online' : null} />
      <${Stat} icon="route" label="Walking" value=${walking} tone=${walking ? 'walking' : null} />
      <${Stat} icon="chip" label="Memory" value=${memory} unit=" MB">
        <span class="meter"><span class="meter__fill" style=${{ width: `${Math.min(100, memory / 20)}%` }}></span></span>
      <//>
      <${Stat} icon="link" label="Client link" value=${store.link === 'online' ? 'Live' : 'Lost'} tone=${store.link === 'online' ? 'online' : 'error'} />
    </div>
  <//>`
}

export function PlayScreen () {
  const server = activeServer()
  useEffect(() => { if (server) pingIfStale(server) }, [server?.host, server?.port])
  const logs = store.snapshot.logs
  return html`<div class="home">
    <section class="home__hero">
      <${Panorama} />
      <div class="home__brand">
        <${Logo} size="xl" />
        <p class="home__tagline">Keep your spot.</p>
      </div>
      <${LaunchBar} />
    </section>
    <div class="home__grid">
      <${QuickSwitch} />
      <${OnlineNow} />
      <div class="home__stack">
        <${ClientStatus} />
        <${GamePanel} title="Activity" kicker="Latest" actions=${html`<${McButton} size="sm" variant="ghost" icon="console" onClick=${() => toggleConsole(true)}>Console<//>`}>
          <${ActivityList} logs=${logs} limit=${5} />
        <//>
      </div>
    </div>
  </div>`
}
