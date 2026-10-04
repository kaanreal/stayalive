// SETTINGS: client preferences, status and shortcuts. Server connection rules live in Multiplayer.
import { html } from '../lib/preact.js'
import { store, accounts, activeServer, defaultPrefs } from '../core/store.js'
import { setPref, navigate, confirm, toast } from '../core/actions.js'
import { forget } from '../core/storage.js'
import { isOnline, serverLabel } from '../core/format.js'
import { McButton, GamePanel, ScreenHeader, Toggle, Segmented, Kbd } from '../ui/primitives.js'
import { Logo } from '../ui/brand.js'
import { CLIENT_VERSION } from '../shell/sidebar.js'

const shortcuts = [
  [['1', '–', '6'], 'Switch screens'],
  [['`'], 'Toggle the console'],
  [['G'], 'Open gameplay for the controlled account'],
  [['Esc'], 'Close dialogs, cancel map picking, clear the selection'],
  [['Shift', 'Click'], 'Select a range of accounts · add a map point to the route plan'],
  [['Right-click'], 'Map actions: walk here, send selected, save waypoint']
]
const gameKeys = [
  [['W', 'A', 'S', 'D'], 'Move'], [['Mouse'], 'Look'], [['Space'], 'Jump'], [['Ctrl'], 'Sprint'], [['Shift'], 'Sneak'],
  [['1', '–', '9'], 'Hotbar · or mouse wheel'], [['Left'], 'Dig · attack'], [['Right'], 'Use · place · open'], [['E'], 'Inventory'], [['T'], 'Chat and commands'], [['Esc'], 'Release control']
]

function Keys ({ list }) {
  return html`<dl class="keys">${list.map(([keys, label], i) => html`<div key=${i}><dt>${keys.map((k, j) => k === '–' ? html`<span key=${j} class="keys__dash">–</span>` : html`<${Kbd} key=${j}>${k}<//>`)}</dt><dd>${label}</dd></div>`)}</dl>`
}

export function SettingsScreen () {
  const prefs = store.prefs
  const list = accounts()
  const server = activeServer()
  const resetLocal = () => confirm({
    title: 'Reset client data in this browser?',
    message: 'This clears the saved server list, waypoints, route plan and interface preferences in this browser. Accounts, Microsoft sessions and server settings are not affected.',
    confirmLabel: 'Reset',
    danger: true,
    onConfirm: () => {
      for (const key of ['servers', 'waypoints', 'draft', 'prefs', 'focus']) forget(key)
      location.reload()
    }
  })
  return html`<div class="settings">
    <${ScreenHeader} title="Settings" subtitle="Preferences are saved in this browser." />
    <div class="settings__grid">
      <${GamePanel} kicker="Interface" title="Client">
        <div class="settings__list">
          <div class="setting"><div class="setting__text"><b>Gameplay opens</b><small>Inside the client is full screen; a separate window can sit on another monitor.</small></div>
            <${Segmented} value=${prefs.gameplayWindow} onChange=${v => setPref('gameplayWindow', v)} size="sm" label="Gameplay window" options=${[{ value: 'overlay', label: 'In client' }, { value: 'window', label: 'New window' }]} />
          </div>
          <${Toggle} checked=${prefs.reduceMotion} onChange=${v => setPref('reduceMotion', v)} label="Reduce motion" hint="Stops the title panorama and softens animations." />
        </div>
      <//>
      <${GamePanel} kicker="Map" title="Radar">
        <div class="settings__list">
          <${Toggle} checked=${prefs.chunkGrid} onChange=${v => setPref('chunkGrid', v)} label="Chunk grid" hint="Dashed lines every 16 blocks." />
          <${Toggle} checked=${prefs.mapPlayers} onChange=${v => setPref('mapPlayers', v)} label="Show other accounts" hint="Heads of your other accounts in the same world." />
          <${Toggle} checked=${prefs.spread} onChange=${v => setPref('spread', v)} label="Spread out groups" hint="Accounts sent together get neighbouring blocks instead of one." />
        </div>
      <//>
      <${GamePanel} kicker="Status" title="Client">
        <dl class="facts">
          <div><dt>Client link</dt><dd>${store.link === 'online' ? 'Live' : 'Reconnecting'}</dd></div>
          <div><dt>Memory</dt><dd>${store.snapshot.memory} MB</dd></div>
          <div><dt>Accounts</dt><dd>${list.filter(isOnline).length} online · ${list.length} total</dd></div>
          <div><dt>Active server</dt><dd>${server ? serverLabel(server) : 'None'}</dd></div>
        </dl>
        <div class="btn-row"><${McButton} size="sm" icon="servers" onClick=${() => navigate('multiplayer')}>Connection rules<//></div>
      <//>
      <${GamePanel} kicker="Keyboard" title="Client shortcuts"><${Keys} list=${shortcuts} /><//>
      <${GamePanel} kicker="Keyboard" title="Gameplay controls"><${Keys} list=${gameKeys} /><//>
      <${GamePanel} kicker="About" title="StayAlive" class="about">
        <${Logo} size="lg" tagline=${`Version ${CLIENT_VERSION} · Java Edition`} />
        <p class="muted-note">Keeps Minecraft Java accounts connected without a game window. Microsoft sessions stay on this computer in <code>data/tokens</code>; the client only listens on 127.0.0.1. Built on Mineflayer, Prismarine Auth, Prismarine Viewer and Mineflayer Pathfinder.</p>
        <div class="btn-row">
          <${McButton} size="sm" variant="ghost" onClick=${() => { for (const [k, v] of Object.entries(defaultPrefs)) setPref(k, v); toast('Preferences restored.', 'success') }}>Restore defaults<//>
          <${McButton} size="sm" variant="danger" onClick=${resetLocal}>Reset browser data<//>
        </div>
      <//>
    </div>
  </div>`
}
