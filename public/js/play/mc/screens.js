// Menus drawn like the game's GuiScreens: the game menu, controls, the terrain loading screen and containers.
import { gradient } from './gui.js'

const inside = (mx, my, x, y, w, h) => mx >= x && my >= y && mx < x + w && my < y + h

// Darkens the world behind a screen, like GuiScreen.drawDefaultBackground.
export function dim (ctx, w, h) { gradient(ctx, 0, 0, w, h, 0xc0101010, 0xd0101010) }

export class LoadingScreen {
  constructor (gui) { this.gui = gui }
  draw (ctx, w, h) {
    this.gui.dirt(ctx, w, h)
    this.gui.font.drawCentered(ctx, 'Downloading terrain', w / 2, h / 2 - 50, 0xffffff, { shadow: true })
  }

  click () { return true }
}

// The Esc menu. "Back to Game" takes control of the account again.
export class GameMenu {
  constructor (gui, actions) {
    this.gui = gui
    this.actions = actions // { resume, leave, popOut (or null), distance: { value, set }, controls, status() }
    this.drag = false
  }

  layout (w, h) {
    const top = Math.floor(h / 4) + 8
    const a = this.actions
    return [
      { id: 'resume', label: 'Back to Game', x: w / 2 - 100, y: top, w: 200, enabled: a.canResume() },
      { id: 'distance', slider: true, x: w / 2 - 100, y: top + 24, w: 200 },
      { id: 'popout', label: 'Pop Out', x: w / 2 - 100, y: top + 48, w: 98, enabled: Boolean(a.popOut) },
      { id: 'controls', label: 'Controls...', x: w / 2 + 2, y: top + 48, w: 98, enabled: true },
      { id: 'leave', label: 'Back to StayAlive', x: w / 2 - 100, y: top + 96, w: 200, enabled: true }
    ]
  }

  draw (ctx, w, h, mouse) {
    dim(ctx, w, h)
    const { gui } = this
    gui.font.drawCentered(ctx, 'Game menu', w / 2, 40, 0xffffff, { shadow: true })
    const status = this.actions.status()
    if (status) gui.font.drawCentered(ctx, status, w / 2, 54, 0xa0a0a0, { shadow: true })
    const d = this.actions.distance
    for (const b of this.layout(w, h)) {
      const hover = inside(mouse.x, mouse.y, b.x, b.y, b.w, 20)
      if (b.slider) gui.slider(ctx, b.x, b.y, b.w, 20, `Render Distance: ${d.value} chunks`, (d.value - d.min) / (d.max - d.min), hover || this.drag)
      else gui.button(ctx, b.x, b.y, b.w, 20, b.label, { hover: hover && b.enabled, disabled: !b.enabled })
    }
  }

  sliderValue (b, x) {
    const d = this.actions.distance
    const t = Math.max(0, Math.min(1, (x - b.x - 4) / (b.w - 8)))
    return Math.round(d.min + t * (d.max - d.min))
  }

  click (x, y, button, w, h) {
    if (button !== 0) return true
    for (const b of this.layout(w, h)) {
      if (!inside(x, y, b.x, b.y, b.w, 20)) continue
      if (b.slider) { this.drag = b; this.actions.distance.preview(this.sliderValue(b, x)); return true }
      if (!b.enabled) return true
      this.actions.sound?.()
      if (b.id === 'resume') this.actions.resume()
      if (b.id === 'popout') this.actions.popOut()
      if (b.id === 'controls') this.actions.controls()
      if (b.id === 'leave') this.actions.leave()
      return true
    }
    return true
  }

  move (x) { if (this.drag) this.actions.distance.preview(this.sliderValue(this.drag, x)) }
  release () { if (this.drag) { this.drag = false; this.actions.distance.commit() } }
}

const BINDINGS = [
  ['Walk', 'W A S D'], ['Jump', 'Space'], ['Sneak', 'Shift'], ['Sprint', 'Ctrl or double-tap W'],
  ['Attack/Destroy', 'Left Button'], ['Use Item/Place Block', 'Right Button'], ['Hotbar Slots', '1-9, wheel'],
  ['Open/Close Inventory', 'E'], ['Drop Selected Item', 'Q (Ctrl+Q: stack)'], ['Open Chat', 'T'], ['Open Command', '/'],
  ['List Players', 'Tab'], ['Toggle Perspective', 'F5'], ['Debug Screen', 'F3'], ['Hide GUI', 'F1'], ['Pause', 'Esc']
]

export class ControlsScreen {
  constructor (gui, done) { this.gui = gui; this.done = done }
  draw (ctx, w, h, mouse) {
    dim(ctx, w, h)
    const font = this.gui.font
    font.drawCentered(ctx, 'Controls', w / 2, 15, 0xffffff, { shadow: true })
    BINDINGS.forEach(([action, key], i) => {
      const y = 36 + i * 12
      font.draw(ctx, action, w / 2 - 150, y, 0xffffff, { shadow: true })
      font.draw(ctx, key, w / 2 + 150 - font.width(key), y, 0xffffa0, { shadow: true })
    })
    const y = Math.min(h - 29, 36 + BINDINGS.length * 12 + 8)
    this.gui.button(ctx, w / 2 - 100, y, 200, 20, 'Done', { hover: inside(mouse.x, mouse.y, w / 2 - 100, y, 200, 20) })
    this.doneY = y
  }

  click (x, y, button, w) {
    if (inside(x, y, w / 2 - 100, this.doneY, 200, 20)) this.done()
    return true
  }
}

const grid = (start, count, columns, x, y) => Array.from({ length: count }, (_, i) => ({ index: start + i, x: x + (i % columns) * 18, y: y + Math.floor(i / columns) * 18 }))

// Slot positions and textures from the game's containers.
function layout (kind, containerSlots) {
  if (kind === 'inventory') {
    return {
      texture: 'inventory', w: 176, h: 166, parts: [[0, 0, 176, 166, 0]],
      slots: [{ index: 0, x: 144, y: 36 }, ...grid(1, 4, 2, 88, 26), ...grid(5, 4, 1, 8, 8), ...grid(9, 27, 9, 8, 84), ...grid(36, 9, 9, 8, 142), { index: 45, x: 77, y: 62 }],
      labels: [['Crafting', 86, 16]],
      preview: true
    }
  }
  const inv = (start, y) => [...grid(start, 27, 9, 8, y), ...grid(start + 27, 9, 9, 8, y + 58)]
  if (kind === 'crafting') return { texture: 'crafting_table', w: 176, h: 166, parts: [[0, 0, 176, 166, 0]], slots: [{ index: 0, x: 124, y: 35 }, ...grid(1, 9, 3, 30, 17), ...inv(10, 84)], labels: [['Crafting', 28, 6], ['Inventory', 8, 72]] }
  if (kind === 'furnace') return { texture: 'furnace', w: 176, h: 166, parts: [[0, 0, 176, 166, 0]], slots: [{ index: 0, x: 56, y: 17 }, { index: 1, x: 56, y: 53 }, { index: 2, x: 116, y: 35 }, ...inv(3, 84)], labels: [['title-center', 0, 6], ['Inventory', 8, 72]] }
  if (kind === 'dispenser') return { texture: 'dispenser', w: 176, h: 166, parts: [[0, 0, 176, 166, 0]], slots: [...grid(0, 9, 3, 62, 17), ...inv(9, 84)], labels: [['title-center', 0, 6], ['Inventory', 8, 72]] }
  if (kind === 'hopper') return { texture: 'hopper', w: 176, h: 133, parts: [[0, 0, 176, 133, 0]], slots: [...grid(0, 5, 5, 44, 20), ...inv(5, 51)], labels: [['title', 8, 6], ['Inventory', 8, 39]] }
  const rows = Math.max(1, Math.min(6, Math.ceil(containerSlots / 9)))
  const height = 114 + rows * 18
  return {
    texture: 'generic_54', w: 176, h: height,
    parts: [[0, 0, 176, rows * 18 + 17, 0], [0, 126, 176, 96, rows * 18 + 17]],
    slots: [...grid(0, containerSlots, 9, 8, 18), ...inv(containerSlots, 103 + (rows - 4) * 18)],
    labels: [['title', 8, 6], ['Inventory', 8, height - 96 + 2]]
  }
}

export class ContainerScreen {
  constructor (gui, actions) {
    this.gui = gui
    this.actions = actions // { state(), click(slot, button, mode), close(), preview(mouseDX, mouseDY, w, h) }
  }

  current () {
    const { hud } = this.actions.state()
    const window = hud?.window
    return { hud, window, spec: layout(window ? window.kind : 'inventory', window?.slots ?? 0) }
  }

  origin (w, h, spec) { return [Math.floor((w - spec.w) / 2), Math.floor((h - spec.h) / 2)] }

  hovered (spec, left, top, x, y) {
    return spec.slots.find(s => inside(x, y, left + s.x - 1, top + s.y - 1, 18, 18)) || null
  }

  draw (ctx, w, h, mouse, now) {
    const { gui } = this
    const { hud, window, spec } = this.current()
    if (!hud) return
    dim(ctx, w, h)
    const [left, top] = this.origin(w, h, spec)
    for (const [u, v, pw, ph, dy] of spec.parts) gui.sprite(ctx, spec.texture, u, v, pw, ph, left, top + dy)
    if (spec.preview) {
      const image = this.actions.preview(left + 51 - mouse.x, top + 75 - 50 - mouse.y)
      if (image) ctx.drawImage(image, left + 26, top + 8, 52, 70)
    }
    const hover = this.hovered(spec, left, top, mouse.x, mouse.y)
    for (const slot of spec.slots) {
      const item = hud.inventory[slot.index]
      if (item) gui.item(ctx, item, left + slot.x, top + slot.y, now)
    }
    if (hover) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillRect(left + hover.x, top + hover.y, 16, 16)
    }
    for (const [text, x, y] of spec.labels) {
      const title = window?.title || 'Container'
      if (text === 'title') gui.font.draw(ctx, title, left + x, top + y, 0x404040)
      else if (text === 'title-center') gui.font.draw(ctx, title, left + spec.w / 2 - gui.font.width(title) / 2, top + y, 0x404040)
      else gui.font.draw(ctx, text, left + x, top + y, 0x404040)
    }
    if (hud.carried) gui.item(ctx, hud.carried, mouse.x - 8, mouse.y - 8, now)
    else if (hover && hud.inventory[hover.index]) {
      const item = hud.inventory[hover.index]
      gui.tooltip(ctx, [item.name, ...(item.lore || [])], mouse.x, mouse.y, w, h)
    }
  }

  click (x, y, button, w, h, event) {
    const { hud, spec } = this.current()
    if (!hud) return true
    const [left, top] = this.origin(w, h, spec)
    const slot = this.hovered(spec, left, top, x, y)
    if (slot) this.actions.click(slot.index, button === 2 ? 1 : 0, event.shiftKey ? 1 : 0)
    else if (!inside(x, y, left, top, spec.w, spec.h) && hud.carried) this.actions.click(-999, button === 2 ? 1 : 0, 0)
    return true
  }

  key (event, mouse, w, h) {
    const { hud, spec } = this.current()
    const [left, top] = this.origin(w, h, spec)
    const slot = this.hovered(spec, left, top, mouse.x, mouse.y)
    if (/^Digit[1-9]$/.test(event.code) && slot) { this.actions.click(slot.index, Number(event.code.slice(-1)) - 1, 2); return true }
    if (event.code === 'KeyQ' && slot && hud?.inventory[slot.index]) { this.actions.click(slot.index, event.ctrlKey ? 1 : 0, 4); return true }
    return false
  }
}
