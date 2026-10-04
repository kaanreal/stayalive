// MULTIPLAYER: a server list in the spirit of the vanilla screen, plus join targets and connection rules.
import { html, cx, useEffect, useState } from '../lib/preact.js'
import { store, accounts, focused, selectedAccounts, activeServer, settings } from '../core/store.js'
import { run, openModal, closeModal, joinServer, useServer, upsertServer, deleteServer, moveServer, pingServer, pingIfStale, saveConnection, toast } from '../core/actions.js'
import { isActive, displayName, serverLabel, serverKey, sameServer, parseAddress, plural, statusOf } from '../core/format.js'
import { Icon } from '../ui/icon.js'
import { McButton, GamePanel, ScreenHeader, PlayerHead, HeadStack, SignalBars, Toggle, Segmented, Field, Motd, EmptyState } from '../ui/primitives.js'
import { ServerIcon } from '../ui/brand.js'
import { Modal } from '../ui/overlays.js'

const pingOf = server => store.pings[serverKey(server.host, server.port)]
const accountsOn = server => accounts().filter(a => isActive(a) && sameServer(a.server, server))

function ServerCard ({ server, selected, onSelect, onJoin }) {
  const ping = pingOf(server)
  const active = sameServer(server, activeServer())
  const here = accountsOn(server)
  const data = ping?.data
  return html`<div role="option" aria-selected=${selected} tabindex="0" class=${cx('server-card', selected && 'is-selected', active && 'is-active')} onClick=${onSelect} onDblClick=${onJoin} onKeyDown=${e => { if (e.key === 'Enter') onJoin() }}>
    <${ServerIcon} favicon=${data?.favicon} name=${server.host} size=${64} />
    <div class="server-card__main">
      <div class="server-card__title"><b>${server.name}</b>${active && html`<span class="tag tag--accent">Active</span>`}</div>
      <div class="server-card__motd">
        ${ping?.state === 'error' ? html`<span class="motd motd--error">Can’t connect to server · ${ping.error}</span>`
          : data ? html`<${Motd} runs=${data.motd} fallback="A Minecraft server" />`
          : html`<span class="motd motd--empty">Pinging…</span>`}
      </div>
      <div class="server-card__meta"><span class="mono">${serverLabel(server)}</span><span>${server.version ? `Client ${server.version}` : 'Auto-detect version'}</span>${data?.version && data.version !== server.version && html`<span>Server ${data.version}</span>`}</div>
    </div>
    <div class="server-card__side">
      <span class="server-card__ping"><${SignalBars} ms=${data?.latency} loading=${ping?.state === 'loading'} error=${ping?.state === 'error'} /><small>${data?.latency != null && ping.state !== 'error' ? `${data.latency} ms` : ping?.state === 'error' ? 'offline' : '…'}</small></span>
      <span class="server-card__players">${data ? `${data.players.online ?? '?'}/${data.players.max ?? '?'}` : '—'}</span>
      ${here.length ? html`<span class="server-card__here"><${HeadStack} accounts=${here} max=${4} size=${18} /><small>${here.length} here</small></span>` : html`<small class="server-card__none">No accounts here</small>`}
    </div>
    <div class="server-card__order">
      <button type="button" class="icon-btn icon-btn--sm" aria-label="Move up" onClick=${e => { e.stopPropagation(); moveServer(server.id, -1) }}><${Icon} name="chevron" class="rot-180" /></button>
      <button type="button" class="icon-btn icon-btn--sm" aria-label="Move down" onClick=${e => { e.stopPropagation(); moveServer(server.id, 1) }}><${Icon} name="chevron" /></button>
    </div>
  </div>`
}

// Which accounts a join applies to.
export function useJoinTarget () {
  const [mode, setMode] = useState(store.selected.size ? 'selected' : 'focused')
  const chosen = selectedAccounts()
  const current = focused()
  const ready = accounts().filter(a => !isActive(a))
  const effective = mode === 'selected' && !chosen.length ? 'focused' : mode
  const list = effective === 'selected' ? chosen : effective === 'all' ? ready : current ? [current] : []
  const options = [
    { value: 'focused', label: current ? displayName(current) : 'Controlled', icon: 'user' },
    { value: 'selected', label: `Selected (${chosen.length})`, icon: 'check' },
    { value: 'all', label: `All offline (${ready.length})`, icon: 'face' }
  ]
  return { mode: effective, setMode, list, options }
}

function ConnectionRules () {
  const s = settings()
  const [delay, setDelay] = useState(s.joinDelay / 1000)
  useEffect(() => setDelay(s.joinDelay / 1000), [s.joinDelay])
  const saveDelay = () => {
    const ms = Math.round(Number(delay) * 1000)
    if (ms !== s.joinDelay) run(async () => { await saveConnection({ joinDelay: ms }); toast('Join delay saved.', 'success') })
  }
  return html`<div class="rules">
    <${Toggle} checked=${s.reconnect} disabled=${!s.host} onChange=${value => run(() => saveConnection({ reconnect: value }))} label="Reconnect automatically" hint="Retries after 15 seconds, backing off to about two minutes." />
    <${Field} label="Delay between joins" hint="Spaces out connections when several accounts join together.">
      <div class="range-row">
        <input type="range" min="1" max="30" step="1" value=${delay} disabled=${!s.host} onInput=${e => setDelay(e.currentTarget.value)} onChange=${saveDelay} />
        <span class="range-row__value mono">${delay}s</span>
      </div>
    <//>
  </div>`
}

function ServerDetail ({ server }) {
  const target = useJoinTarget()
  const ping = pingOf(server)
  const data = ping?.data
  const here = accountsOn(server)
  const active = sameServer(server, activeServer())
  const joinable = target.list.filter(a => !isActive(a))
  return html`<div class="server-detail">
    <div class="server-detail__head">
      <${ServerIcon} favicon=${data?.favicon} name=${server.host} size=${96} />
      <div>
        <p class="panel__kicker">${active ? 'Active server' : 'Server'}</p>
        <h2 class="server-detail__name">${server.name}</h2>
        <p class="mono muted">${serverLabel(server)}</p>
      </div>
    </div>
    <div class="motd-box">${ping?.state === 'error' ? html`<span class="motd motd--error">${ping.error}</span>` : html`<${Motd} runs=${data?.motd} fallback=${ping?.state === 'loading' ? 'Pinging…' : 'No message of the day'} />`}</div>
    <dl class="facts">
      <div><dt>Ping</dt><dd><${SignalBars} ms=${data?.latency} error=${ping?.state === 'error'} /> ${data?.latency != null ? `${data.latency} ms` : '—'}</dd></div>
      <div><dt>Players</dt><dd>${data ? `${data.players.online ?? '?'} / ${data.players.max ?? '?'}` : '—'}</dd></div>
      <div><dt>Server version</dt><dd>${data?.version || '—'}</dd></div>
      <div><dt>Client version</dt><dd>${server.version || 'Auto-detect'}</dd></div>
    </dl>
    <div class="join-box">
      <p class="field__label">Join with</p>
      <${Segmented} value=${target.mode} options=${target.options} onChange=${target.setMode} size="sm" label="Accounts to join" />
      <${McButton} variant="primary" size="lg" block icon="play" disabled=${!joinable.length} onClick=${() => run(() => joinServer(server, joinable.map(a => a.id)))}>
        ${joinable.length > 1 ? `Join with ${joinable.length} accounts` : 'Join server'}
      <//>
      <p class="join-box__hint">${!target.list.length ? 'No accounts to join.' : !joinable.length ? 'These accounts are already connected or busy.' : `${plural(joinable.length, 'account')} will join${joinable.length > 1 ? `, ${settings().joinDelay / 1000}s apart` : ''}.`}</p>
      ${!active && html`<button type="button" class="link-btn" onClick=${() => run(async () => { await useServer(server); toast(`${server.name} is now the active server.`, 'success') })}>Make active without joining</button>`}
    </div>
    <div class="server-detail__section">
      <p class="field__label">StayAlive accounts here</p>
      ${here.length ? html`<ul class="here-list">${here.map(a => html`<li key=${a.id}><${PlayerHead} name=${displayName(a)} size=${24} status=${a} /><b>${displayName(a)}</b><small>${statusOf(a).label}${a.ping != null ? ` · ${a.ping} ms` : ''}</small></li>`)}</ul>` : html`<p class="muted-note">None of your accounts are on this server.</p>`}
    </div>
    <div class="server-detail__section">
      <p class="field__label">Connection rules <small>· every server</small></p>
      <${ConnectionRules} />
    </div>
  </div>`
}

export function MultiplayerScreen () {
  const [selectedId, setSelectedId] = useState(null)
  const servers = store.servers
  const active = activeServer()
  const current = servers.find(s => s.id === selectedId) || servers.find(s => sameServer(s, active)) || servers[0] || null
  useEffect(() => { servers.forEach(s => pingIfStale(s, 60000)) }, [servers.length])
  const join = server => run(() => {
    const chosen = selectedAccounts()
    const list = (chosen.length ? chosen : [focused()].filter(Boolean)).filter(a => !isActive(a))
    if (!list.length) throw Error('Select offline accounts to join, or use the panel on the right.')
    return joinServer(server, list.map(a => a.id))
  })
  return html`<div class="mp">
    <${ScreenHeader} title="Multiplayer" subtitle="Choose a server. Accounts join the active one, spaced apart.">
      <${McButton} icon="refresh" onClick=${() => servers.forEach(pingServer)}>Refresh<//>
    <//>
    <div class="mp__layout">
      <div class="mp__main">
      <${GamePanel} class="mp__list" flush>
        ${servers.length ? html`<div class="server-list" role="listbox" aria-label="Servers">
          ${servers.map(s => html`<${ServerCard} key=${s.id} server=${s} selected=${s.id === current?.id} onSelect=${() => setSelectedId(s.id)} onJoin=${() => join(s)} />`)}
        </div>` : html`<${EmptyState} icon="servers" title="No servers yet" action=${html`<${McButton} variant="primary" icon="plus" onClick=${() => openModal('server-editor')}>Add server<//>`}>Add the server your accounts should stay on.<//>`}
      <//>
      <footer class="mp__bar">
        <${McButton} variant="primary" icon="play" disabled=${!current} onClick=${() => join(current)}>Join server<//>
        <${McButton} icon="globe" onClick=${() => openModal('direct-connect')}>Direct connect<//>
        <${McButton} icon="plus" onClick=${() => openModal('server-editor')}>Add server<//>
        <${McButton} icon="edit" disabled=${!current} onClick=${() => openModal('server-editor', { server: current })}>Edit<//>
        <${McButton} icon="trash" variant="danger" disabled=${!current} onClick=${() => deleteServer(current)}>Delete<//>
      </footer>
      </div>
      <${GamePanel} class="mp__detail">
        ${current ? html`<${ServerDetail} key=${current.id} server=${current} />` : html`<${EmptyState} icon="globe" title="Pick a server">Select a server to see its details and join it.<//>`}
      <//>
    </div>
  </div>`
}

function VersionSelect ({ value, onChange }) {
  const versions = [...(store.snapshot?.versions || [])].reverse()
  return html`<select class="input" value=${value} onChange=${e => onChange(e.currentTarget.value)}>
    <option value="">Auto-detect (recommended)</option>
    ${versions.map(v => html`<option key=${v} value=${v}>${v}</option>`)}
  </select>`
}

function useServerForm (server) {
  const [name, setName] = useState(server?.name || '')
  const [address, setAddress] = useState(server ? serverLabel(server) : '')
  const [version, setVersion] = useState(server?.version || '')
  const parsed = parseAddress(address)
  const error = !address.trim() ? null : !parsed.host || /[\s/\\]/.test(parsed.host) ? 'Enter a hostname or IP, like play.example.net or 10.0.0.5:25570.' : !Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535 ? 'Port must be between 1 and 65535.' : null
  const valid = Boolean(address.trim()) && !error
  return { name, setName, address, setAddress, version, setVersion, parsed, error, valid }
}

export function ServerEditorModal ({ server }) {
  const form = useServerForm(server)
  const save = e => {
    e?.preventDefault()
    if (!form.valid) return
    const saved = upsertServer({ id: server?.id, name: form.name || form.parsed.host, host: form.parsed.host, port: form.parsed.port, version: form.version })
    pingServer(saved)
    closeModal()
  }
  return html`<${Modal} title=${server ? 'Edit server' : 'Add server'} icon="servers" footer=${html`
    <${McButton} variant="ghost" onClick=${closeModal}>Cancel<//>
    <${McButton} variant="primary" disabled=${!form.valid} onClick=${save}>${server ? 'Save' : 'Add server'}<//>`}>
    <form class="form" onSubmit=${save}>
      <${Field} label="Server name"><input class="input" value=${form.name} onInput=${e => form.setName(e.currentTarget.value)} placeholder="Minecraft Server" maxlength="48" /><//>
      <${Field} label="Server address" error=${form.error}><input class="input mono" value=${form.address} onInput=${e => form.setAddress(e.currentTarget.value)} placeholder="play.example.net" autocomplete="off" spellcheck="false" autofocus /><//>
      <${Field} label="Client version" hint="Leave on auto-detect unless the server needs a specific version."><${VersionSelect} value=${form.version} onChange=${form.setVersion} /><//>
      <button type="submit" hidden></button>
    </form>
  <//>`
}

export function DirectConnectModal () {
  const form = useServerForm(null)
  const target = useJoinTarget()
  const [keep, setKeep] = useState(false)
  const joinable = target.list.filter(a => !isActive(a))
  const connect = e => {
    e?.preventDefault()
    if (!form.valid) return
    run(async () => {
      const server = { host: form.parsed.host, port: form.parsed.port, version: form.version, name: form.parsed.host }
      if (keep) upsertServer(server)
      await joinServer(server, joinable.map(a => a.id))
      closeModal()
    })
  }
  return html`<${Modal} title="Direct connect" icon="globe" footer=${html`
    <${McButton} variant="ghost" onClick=${closeModal}>Cancel<//>
    <${McButton} variant="primary" icon="play" disabled=${!form.valid || !joinable.length} onClick=${connect}>Join server<//>`}>
    <form class="form" onSubmit=${connect}>
      <${Field} label="Server address" error=${form.error}><input class="input mono" value=${form.address} onInput=${e => form.setAddress(e.currentTarget.value)} placeholder="play.example.net:25565" autocomplete="off" spellcheck="false" autofocus /><//>
      <${Field} label="Client version"><${VersionSelect} value=${form.version} onChange=${form.setVersion} /><//>
      <div class="field"><span class="field__label">Join with</span><${Segmented} value=${target.mode} options=${target.options} onChange=${target.setMode} size="sm" label="Accounts to join" /></div>
      <${Toggle} checked=${keep} onChange=${setKeep} label="Save to server list" />
      <button type="submit" hidden></button>
    </form>
  <//>`
}
