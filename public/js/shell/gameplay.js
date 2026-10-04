// GameplayOverlay: the 3D view for one account, full screen inside the client.
// The page in the frame posts "stayalive:exit" when the player chooses to return.
import { html, useEffect, useState } from '../lib/preact.js'
import { store, accountById } from '../core/store.js'
import { closeGameplay } from '../core/actions.js'
import { displayName, isMappable } from '../core/format.js'
import { Emblem } from '../ui/brand.js'

export function GameplayOverlay () {
  const id = store.gameplay
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setLoaded(false)
    if (!id) return
    const message = e => {
      if (e.origin !== location.origin || e.data?.type !== 'stayalive:exit') return
      closeGameplay()
    }
    window.addEventListener('message', message)
    return () => window.removeEventListener('message', message)
  }, [id])
  const account = id && accountById(id)
  useEffect(() => { if (id && account && !isMappable(account) && account.status !== 'respawning') closeGameplay() }, [id, account?.status])
  if (!id || !account) return null
  return html`<div class="gameplay" role="dialog" aria-label=${`Gameplay as ${displayName(account)}`}>
    <iframe class="gameplay__frame" src=${`/play/?id=${encodeURIComponent(id)}`} title="Gameplay" onLoad=${() => setLoaded(true)}></iframe>
    ${!loaded && html`<div class="gameplay__loading"><${Emblem} /><p>Loading world for <b>${displayName(account)}</b>…</p><div class="loading-bar"><span></span></div></div>`}
  </div>`
}
