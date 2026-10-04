// Small building blocks shared by every screen.
import { html, cx, useEffect, useRef, useState } from '../lib/preact.js'
import { Icon } from './icon.js'
import { paintHead } from './head-art.js'
import { statusOf } from '../core/format.js'

// MinecraftButton: square, bevelled, pixel label. variant: default | primary | danger | ghost
export function McButton ({ variant, size, icon, block, active, class: className, children, type = 'button', ...rest }) {
  return html`<button type=${type} class=${cx('btn', variant && `btn--${variant}`, size && `btn--${size}`, block && 'btn--block', active && 'is-active', !children && 'btn--icon', className)} ...${rest}>
    ${icon && html`<${Icon} name=${icon} />`}${children && html`<span class="btn__label">${children}</span>`}
  </button>`
}

// GamePanel: the bevelled surface every section sits on.
export function GamePanel ({ title, kicker, actions, class: className, children, flush, ...rest }) {
  return html`<section class=${cx('panel', flush && 'panel--flush', className)} ...${rest}>
    ${(title || actions) && html`<header class="panel__head">
      <div class="panel__titles">${kicker && html`<p class="panel__kicker">${kicker}</p>`}${title && html`<h2 class="panel__title">${title}</h2>`}</div>
      ${actions && html`<div class="panel__actions">${actions}</div>`}
    </header>`}
    <div class="panel__body">${children}</div>
  </section>`
}

export function ScreenHeader ({ title, subtitle, children }) {
  return html`<header class="screen-head">
    <div><h1 class="screen-head__title">${title}</h1>${subtitle && html`<p class="screen-head__subtitle">${subtitle}</p>`}</div>
    ${children && html`<div class="screen-head__actions">${children}</div>`}
  </header>`
}

export function PlayerHead ({ name, size = 32, status, focus, class: className }) {
  const ref = useRef()
  useEffect(() => { if (ref.current) paintHead(ref.current, name || '?') }, [name])
  const tone = status ? statusOf(status).tone : null
  return html`<span class=${cx('head', `head--${size}`, focus && 'head--focus', className)}>
    <canvas ref=${ref} width="8" height="8" aria-hidden="true"></canvas>
    ${tone && html`<i class=${cx('head__dot', `tone-${tone}`)} aria-hidden="true"></i>`}
  </span>`
}

export function HeadStack ({ accounts, max = 5, size = 24 }) {
  const extra = accounts.length - max
  return html`<span class="head-stack">
    ${accounts.slice(0, max).map(a => html`<${PlayerHead} key=${a.id} name=${a.username || a.label} size=${size} />`)}
    ${extra > 0 && html`<span class=${cx('head-stack__more', `head--${size}`)}>+${extra}</span>`}
  </span>`
}

export function StatusBadge ({ account, tone, label, pulse }) {
  const status = account ? statusOf(account) : { tone, label }
  return html`<span class=${cx('badge', `tone-${status.tone}`, (pulse ?? ['busy', 'attention'].includes(status.tone)) && 'badge--pulse')}><i aria-hidden="true"></i>${status.label}</span>`
}

// Five bars, like the multiplayer list. ms null = unknown.
export function SignalBars ({ ms, loading, error }) {
  const level = error ? 0 : ms == null ? -1 : ms < 80 ? 5 : ms < 150 ? 4 : ms < 300 ? 3 : ms < 600 ? 2 : 1
  return html`<span class=${cx('signal', loading && 'signal--loading', error && 'signal--error', level >= 0 && `signal--${level}`)} aria-label=${error ? 'Offline' : ms == null ? 'Ping unknown' : `${ms} ms`}>
    ${[1, 2, 3, 4, 5].map(i => html`<i key=${i} class=${cx(level >= i && 'on')}></i>`)}
  </span>`
}

export function Toggle ({ checked, onChange, label, hint, disabled }) {
  return html`<label class=${cx('toggle', disabled && 'is-disabled')}>
    <input type="checkbox" checked=${checked} disabled=${disabled} onChange=${e => onChange(e.currentTarget.checked)} />
    <span class="toggle__track" aria-hidden="true"><span class="toggle__thumb"></span></span>
    ${(label || hint) && html`<span class="toggle__text">${label && html`<span class="toggle__label">${label}</span>`}${hint && html`<span class="toggle__hint">${hint}</span>`}</span>`}
  </label>`
}

// onChange(checked, event): the click event carries shiftKey for range selection.
export function Checkbox ({ checked, indeterminate, onChange, label, class: className }) {
  const ref = useRef()
  useEffect(() => { if (ref.current) ref.current.indeterminate = Boolean(indeterminate) }, [indeterminate])
  return html`<label class=${cx('check', className)} onClick=${e => e.stopPropagation()}>
    <input ref=${ref} type="checkbox" checked=${checked} onClick=${e => onChange(e.currentTarget.checked, e)} aria-label=${label} />
    <span class="check__box" aria-hidden="true"><${Icon} name=${indeterminate ? 'minus' : 'check'} /></span>
  </label>`
}

// Segmented control: options = [{ value, label, icon }]
export function Segmented ({ value, options, onChange, size, label }) {
  return html`<div class=${cx('seg', size && `seg--${size}`)} role="radiogroup" aria-label=${label}>
    ${options.map(o => html`<button key=${o.value} type="button" role="radio" aria-checked=${value === o.value} class=${cx('seg__item', value === o.value && 'is-active')} onClick=${() => onChange(o.value)} title=${o.title}>
      ${o.icon && html`<${Icon} name=${o.icon} />`}${o.label && html`<span>${o.label}</span>`}
    </button>`)}
  </div>`
}

export function Field ({ label, hint, error, children, class: className }) {
  return html`<label class=${cx('field', className)}>
    ${label && html`<span class="field__label">${label}</span>`}
    ${children}
    ${(error || hint) && html`<span class=${cx('field__hint', error && 'is-error')}>${error || hint}</span>`}
  </label>`
}

export function Kbd ({ children }) { return html`<kbd class="kbd">${children}</kbd>` }

export function Stat ({ label, value, unit, icon, tone, children }) {
  return html`<div class=${cx('stat', tone && `tone-${tone}`)}>
    ${icon && html`<span class="stat__icon"><${Icon} name=${icon} /></span>`}
    <div class="stat__text"><span class="stat__value">${value}${unit && html`<small>${unit}</small>`}</span><span class="stat__label">${label}</span></div>
    ${children}
  </div>`
}

export function EmptyState ({ icon = 'face', title, children, action }) {
  return html`<div class="empty">
    <span class="empty__icon"><${Icon} name=${icon} size="xl" /></span>
    <h3 class="empty__title">${title}</h3>
    ${children && html`<p class="empty__text">${children}</p>`}
    ${action}
  </div>`
}

// Dropdown/popover that closes on outside click or Escape.
export function Popover ({ trigger, children, align = 'start', class: className, open: controlled, onOpenChange }) {
  const [own, setOwn] = useState(false)
  const open = controlled ?? own
  const setOpen = value => { setOwn(value); onOpenChange?.(value) }
  const ref = useRef()
  useEffect(() => {
    if (!open) return
    const outside = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  }, [open])
  return html`<div class=${cx('popover', open && 'is-open', className)} ref=${ref}>
    ${trigger({ open, toggle: () => setOpen(!open) })}
    ${open && html`<div class=${cx('popover__panel', `popover__panel--${align}`)} onClick=${e => { if (e.target.closest('[data-close]')) setOpen(false) }}>${children}</div>`}
  </div>`
}

export function MenuItem ({ icon, children, onClick, danger, disabled, hint }) {
  return html`<button type="button" class=${cx('menu-item', danger && 'menu-item--danger')} disabled=${disabled} onClick=${onClick} data-close>
    ${icon && html`<${Icon} name=${icon} />`}<span>${children}</span>${hint && html`<small>${hint}</small>`}
  </button>`
}

// Minecraft-style server MOTD runs: [{ text, color, bold, italic }]
export function Motd ({ runs, fallback }) {
  if (!runs?.length) return html`<span class="motd motd--empty">${fallback}</span>`
  return html`<span class="motd">${runs.map((r, i) => html`<span key=${i} class=${cx(r.bold && 'b', r.italic && 'i')} style=${r.color ? { color: r.color } : null}>${r.text}</span>`)}</span>`
}
