// App root: layout, routing, keyboard shortcuts and dialogs.
import { html, cx, useEffect } from './lib/preact.js'
import { store, useStore, update, pageFromHash, pages, focused } from './core/store.js'
import { navigate, toggleConsole, clearSelection, closeModal, openGameplay, run } from './core/actions.js'
import { Emblem } from './ui/brand.js'
import { Toasts, ModalHost } from './ui/overlays.js'
import { ClientSidebar } from './shell/sidebar.js'
import { TopStatusBar } from './shell/topbar.js'
import { SelectionDock } from './shell/dock.js'
import { ConsoleDrawer } from './shell/console.js'
import { GameplayOverlay } from './shell/gameplay.js'
import { PlayScreen } from './screens/play.js'
import { MultiplayerScreen, ServerEditorModal, DirectConnectModal } from './screens/multiplayer.js'
import { AccountsScreen, AddAccountModal } from './screens/accounts.js'
import { MapScreen, WaypointModal } from './screens/map.js'
import { RoutesScreen, PastePointsModal } from './screens/routes.js'
import { SettingsScreen } from './screens/settings.js'

const screens = { play: PlayScreen, multiplayer: MultiplayerScreen, accounts: AccountsScreen, map: MapScreen, routes: RoutesScreen, settings: SettingsScreen }
const modals = { 'add-account': AddAccountModal, 'server-editor': ServerEditorModal, 'direct-connect': DirectConnectModal, waypoint: WaypointModal, 'paste-points': PastePointsModal }
const titles = { play: 'StayAlive', multiplayer: 'Multiplayer · StayAlive', accounts: 'Accounts · StayAlive', map: 'Map · StayAlive', routes: 'Routes · StayAlive', settings: 'Settings · StayAlive' }

const typing = target => target.closest?.('input, textarea, select, [contenteditable]')

function useShortcuts () {
  useEffect(() => {
    const key = e => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || store.gameplay) return
      if (e.key === 'Escape') {
        if (store.modal || document.querySelector('.popover.is-open, .context-menu')) return
        if (store.picking) update({ picking: false })
        else if (store.consoleOpen) toggleConsole(false)
        else if (store.selected.size) clearSelection()
        return
      }
      if (e.key === '`') { e.preventDefault(); toggleConsole(); return }
      if (/^[1-6]$/.test(e.key)) { navigate(pages[Number(e.key) - 1]); return }
      if (e.key === 'g' || e.key === 'G') { const a = focused(); if (a) run(() => openGameplay(a.id)) }
    }
    const hash = () => update({ page: pageFromHash() })
    document.addEventListener('keydown', key)
    window.addEventListener('hashchange', hash)
    return () => { document.removeEventListener('keydown', key); window.removeEventListener('hashchange', hash) }
  }, [])
}

function BootScreen () {
  return html`<div class="boot" role="status">
    <${Emblem} class="boot__mark" />
    <p class="boot__title">STAY<b>ALIVE</b></p>
    <p class="boot__tagline">${store.link === 'offline' ? 'Can’t reach the StayAlive process. Is the terminal still running?' : 'Keep your spot.'}</p>
    <div class="loading-bar"><span></span></div>
  </div>`
}

export function App () {
  useStore()
  useShortcuts()
  useEffect(() => { document.title = titles[store.page] }, [store.page])
  useEffect(() => { if (store.modal) closeModal() }, [store.page])
  if (!store.snapshot) return html`<${BootScreen} />`
  const Screen = screens[store.page] || PlayScreen
  return html`<div class=${cx('app', store.prefs.reduceMotion && 'reduce-motion', store.selected.size && 'has-dock', store.consoleOpen && 'has-console')}>
    <${ClientSidebar} />
    <div class="app__main">
      <${TopStatusBar} />
      <main class=${cx('screen', `screen--${store.page}`)} key=${store.page}><${Screen} /></main>
      <${SelectionDock} />
      <${ConsoleDrawer} />
    </div>
    <${Toasts} />
    <${ModalHost} registry=${modals} />
    <${GameplayOverlay} />
  </div>`
}
