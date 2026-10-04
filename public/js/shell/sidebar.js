// ClientSidebar: brand, main menu and live client status.
import { html, cx } from '../lib/preact.js'
import { store, accounts, activeServer } from '../core/store.js'
import { navigate } from '../core/actions.js'
import { isOnline, serverLabel, sameServer } from '../core/format.js'
import { Icon } from '../ui/icon.js'
import { Logo, Emblem } from '../ui/brand.js'

export const CLIENT_VERSION = '0.1.0'

export const menu = [
  { page: 'play', label: 'Play', icon: 'play', hint: 'Home' },
  { page: 'multiplayer', label: 'Multiplayer', icon: 'servers', hint: 'Servers' },
  { page: 'accounts', label: 'Accounts', icon: 'face', hint: 'Alt manager' },
  { page: 'map', label: 'Map', icon: 'map', hint: 'Radar' },
  { page: 'routes', label: 'Routes', icon: 'route', hint: 'Movement' },
  { page: 'settings', label: 'Settings', icon: 'settings', hint: 'Client' }
]

function badge (page) {
  const list = accounts()
  if (page === 'accounts') {
    const attention = list.some(a => a.code || a.status === 'login required')
    return list.length ? html`<span class=${cx('nav__badge', attention && 'is-attention')}>${list.filter(isOnline).length}/${list.length}</span>` : null
  }
  if (page === 'routes') {
    const walking = list.filter(a => a.status === 'walking').length
    return walking ? html`<span class="nav__badge is-walking">${walking}</span>` : null
  }
  return null
}

export function ClientSidebar () {
  const server = activeServer()
  const online = accounts().filter(a => isOnline(a) && sameServer(a.server, server)).length
  const link = store.link
  return html`<aside class="sidebar">
    <a class="sidebar__brand" href="#/play" aria-label="StayAlive home"><${Logo} size="md" tagline="Java client" /><${Emblem} class="sidebar__mini" /></a>
    <nav class="nav" aria-label="Main menu">
      ${menu.map((item, i) => html`<a key=${item.page} href=${`#/${item.page}`} class=${cx('nav__item', store.page === item.page && 'is-active')} aria-current=${store.page === item.page ? 'page' : null} title=${`${item.label} (${i + 1})`} onClick=${e => { e.preventDefault(); navigate(item.page) }}>
        <${Icon} name=${item.icon} />
        <span class="nav__label">${item.label}</span>
        ${badge(item.page)}
      </a>`)}
    </nav>
    <div class="sidebar__foot">
      <div class=${cx('link-status', `link-status--${link}`)} role="status">
        <i aria-hidden="true"></i>
        <span>${link === 'online' ? 'Client linked' : link === 'offline' ? 'Reconnecting…' : 'Connecting…'}</span>
      </div>
      <button type="button" class="sidebar__server" onClick=${() => navigate('multiplayer')}>
        <${Icon} name="globe" />
        <span><b>${server ? serverLabel(server) : 'No server chosen'}</b><small>${server ? `${online} StayAlive ${online === 1 ? 'account' : 'accounts'} online` : 'Open Multiplayer'}</small></span>
      </button>
      <p class="sidebar__version">StayAlive ${CLIENT_VERSION} · Java Edition</p>
    </div>
  </aside>`
}
