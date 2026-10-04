// Toast notifications and modal dialogs.
import { html, cx, useEffect, useRef, useState } from '../lib/preact.js'
import { store } from '../core/store.js'
import { dismiss, closeModal, run } from '../core/actions.js'
import { Icon } from './icon.js'
import { McButton } from './primitives.js'

const toastIcons = { info: 'info', success: 'check', warn: 'warning', error: 'warning' }

export function Toasts () {
  return html`<div class="toasts" role="status" aria-live="polite">
    ${store.toasts.map(t => html`<div key=${t.id} class=${cx('toast', `toast--${t.kind}`)}>
      <${Icon} name=${toastIcons[t.kind]} />
      <p>${t.message}</p>
      ${t.action && html`<button type="button" class="toast__action" onClick=${() => { t.action.run(); dismiss(t.id) }}>${t.action.label}</button>`}
      <button type="button" class="toast__close" aria-label="Dismiss" onClick=${() => dismiss(t.id)}><${Icon} name="close" /></button>
    </div>`)}
  </div>`
}

// Modal frame: title bar, body, footer. Escape and the backdrop close it.
export function Modal ({ title, icon, children, footer, wide, onClose = closeModal }) {
  const ref = useRef()
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    const first = ref.current?.querySelector('[autofocus], input:not([type=checkbox]), textarea, select, button.btn--primary')
    first?.focus()
    return () => document.removeEventListener('keydown', key)
  }, [])
  return html`<div class="modal" onPointerDown=${e => { if (e.target === e.currentTarget) onClose() }}>
    <div class=${cx('modal__window', wide && 'modal__window--wide')} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
      <header class="modal__head">
        ${icon && html`<${Icon} name=${icon} />`}<h2>${title}</h2>
        <button type="button" class="modal__close" aria-label="Close" onClick=${onClose}><${Icon} name="close" /></button>
      </header>
      <div class="modal__body">${children}</div>
      ${footer && html`<footer class="modal__foot">${footer}</footer>`}
    </div>
  </div>`
}

export function ConfirmModal ({ title, message, confirmLabel = 'Confirm', danger, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const confirm = () => {
    setBusy(true)
    run(async () => { await onConfirm(); closeModal() }).finally(() => setBusy(false))
  }
  return html`<${Modal} title=${title} icon=${danger ? 'warning' : 'info'} footer=${html`
    <${McButton} variant="ghost" onClick=${closeModal}>Cancel<//>
    <${McButton} variant=${danger ? 'danger' : 'primary'} onClick=${confirm} disabled=${busy} autofocus>${confirmLabel}<//>`}>
    <p class="modal__text">${message}</p>
  <//>`
}

export function ModalHost ({ registry }) {
  const modal = store.modal
  if (!modal) return null
  const Component = modal.type === 'confirm' ? ConfirmModal : registry[modal.type]
  return Component ? html`<${Component} key=${modal.type} ...${modal.props} />` : null
}
