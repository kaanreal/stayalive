// ConsoleDrawer: the activity log (chat, joins, kicks, route errors), opened with ` or the top bar.
import { html, cx, useEffect, useRef, useState } from '../lib/preact.js'
import { store, accounts } from '../core/store.js'
import { toggleConsole } from '../core/actions.js'
import { time } from '../core/format.js'
import { Icon } from '../ui/icon.js'

export function ActivityList ({ logs, limit }) {
  const shown = limit ? logs.slice(-limit) : logs
  if (!shown.length) return html`<p class="activity__empty">Quiet for now.</p>`
  return html`<ol class="activity">
    ${shown.map((log, i) => html`<li key=${log.time + i} class=${cx('activity__line', /kicked|cannot|error|failed|disconnected/i.test(log.message) && 'is-warn', /joined|signed in|reached/i.test(log.message) && 'is-good')}>
      <time>${time(log.time)}</time><span class="activity__who">${log.account}</span><span class="activity__msg">${log.message}</span>
    </li>`)}
  </ol>`
}

export function ConsoleDrawer () {
  const [filter, setFilter] = useState('')
  const [query, setQuery] = useState('')
  const body = useRef()
  const logs = (store.snapshot?.logs || []).filter(l => (!filter || l.account === filter) && (!query || l.message.toLowerCase().includes(query.toLowerCase())))
  const key = logs.at(-1)?.time
  useEffect(() => {
    const el = body.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [key, store.consoleOpen])
  if (!store.consoleOpen) return null
  const labels = [...new Set(accounts().map(a => a.label))]
  return html`<section class="console" aria-label="Console">
    <header class="console__head">
      <span class="console__title"><${Icon} name="console" /> Console</span>
      <select value=${filter} onChange=${e => setFilter(e.currentTarget.value)} aria-label="Filter by account">
        <option value="">All accounts</option>
        <option value="stayalive">StayAlive</option>
        ${labels.map(label => html`<option key=${label} value=${label}>${label}</option>`)}
      </select>
      <label class="console__search"><${Icon} name="search" /><input type="search" placeholder="Search messages" value=${query} onInput=${e => setQuery(e.currentTarget.value)} /></label>
      <span class="console__count">${logs.length} lines</span>
      <button type="button" class="icon-btn" aria-label="Close console" onClick=${() => toggleConsole(false)}><${Icon} name="close" /></button>
    </header>
    <div class="console__body" ref=${body} role="log"><${ActivityList} logs=${logs} /></div>
  </section>`
}
