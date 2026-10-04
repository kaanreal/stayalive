import { html, render } from './lib/preact.js'
import { App } from './app.js'
import { connectEvents } from './core/events.js'

connectEvents()
const root = document.getElementById('app')
root.replaceChildren()
render(html`<${App} />`, root)
