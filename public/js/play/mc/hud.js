// The in-game overlay, following GuiIngame (1.8): hotbar, health, armor, food, air, experience,
// item name, action bar, titles, chat, scoreboard sidebar, player list and the F3 debug screen.
import { argb } from './gui.js'

const TICK = 50 // ms

export class Hud {
  constructor (gui) {
    this.gui = gui
    this.chat = [] // { text, time }
    this.actionbar = null
    this.title = { title: '', subtitle: '', start: 0, fadeIn: 10, stay: 70, fadeOut: 20 }
    this.highlight = null
    this.lastHealth = null
    this.flash = 0
    this.random = 0
  }

  addChat (text) {
    const lines = this.gui.font.wrap(text, 320)
    for (const line of lines) this.chat.push({ text: line, time: performance.now() })
    if (this.chat.length > 100) this.chat.splice(0, this.chat.length - 100)
  }

  setActionbar (text) { this.actionbar = { text, time: performance.now() } }

  setTitle (event) {
    const t = this.title
    if (event.type === 'times') Object.assign(t, { fadeIn: event.fadeIn, stay: event.stay, fadeOut: event.fadeOut })
    else if (event.type === 'subtitle') t.subtitle = event.text
    else if (event.type === 'title') { t.title = event.text; t.start = performance.now() }
    else { t.title = ''; t.subtitle = ''; t.start = 0 }
  }

  showItemName (item) { this.highlight = item ? { name: item.name, time: performance.now() } : null }

  // w and h are in GUI pixels.
  draw (ctx, state, w, h, now) {
    const { gui } = this
    const font = gui.font
    const hud = state.hud
    const tick = Math.floor(now / TICK)
    if (!state.hideHud && hud) {
      const survival = hud.gameMode !== 'creative' && hud.gameMode !== 'spectator'
      // Hotbar and items.
      gui.sprite(ctx, 'widgets', 0, 0, 182, 22, w / 2 - 91, h - 22)
      gui.sprite(ctx, 'widgets', 0, 22, 24, 22, w / 2 - 91 - 1 + state.slot * 20, h - 22 - 1)
      for (let i = 0; i < 9; i++) gui.item(ctx, hud.hotbar[i], w / 2 - 90 + i * 20 + 2, h - 16 - 3, now)
      if (survival) this.stats(ctx, hud, w, h, tick)
      // Experience bar and level.
      if (survival) {
        const x = w / 2 - 91
        gui.sprite(ctx, 'icons', 0, 64, 182, 5, x, h - 32 + 3)
        const fill = Math.floor((hud.xp?.progress || 0) * 183)
        if (fill > 0) gui.sprite(ctx, 'icons', 0, 69, fill, 5, x, h - 32 + 3)
        if (hud.xp?.level > 0) {
          const text = String(hud.xp.level)
          const lx = Math.floor((w - font.width(text)) / 2)
          const ly = h - 31 - 4
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) font.draw(ctx, text, lx + dx, ly + dy, 0x000000)
          font.draw(ctx, text, lx, ly, 0x80ff20)
        }
      }
      // Selected item name, fading after two seconds.
      if (this.highlight) {
        const left = 2000 - (now - this.highlight.time)
        const alpha = Math.min(1, left / 500)
        if (alpha > 0.03) font.drawCentered(ctx, this.highlight.name, w / 2, h - 59 + (survival ? 0 : 14), 0xffffff, { shadow: true, alpha })
      }
      // Action bar: three seconds, fading for the last second.
      if (this.actionbar) {
        const left = 3000 - (now - this.actionbar.time)
        const alpha = Math.min(1, left / 1000)
        if (alpha > 0.03) font.drawCentered(ctx, this.actionbar.text, w / 2, h - 68 - 4, 0xffffff, { alpha })
      }
      this.titles(ctx, w, h, now)
      if (state.sidebar) this.sidebar(ctx, state.sidebar, w, h)
    }
    this.chatLines(ctx, state, w, h, now)
    if (state.showTab && state.tablist) this.playerList(ctx, state.tablist, w, state.skinHeads)
    if (state.debug) this.debug(ctx, state.debug, w)
  }

  stats (ctx, hud, w, h, tick) {
    const { gui } = this
    const left = w / 2 - 91
    const right = w / 2 + 91
    const top = h - 39
    const health = Math.max(0, Math.ceil(hud.health ?? 20))
    if (this.lastHealth !== null && health < this.lastHealth) this.flash = tick + 10
    this.lastHealth = health
    const flashing = this.flash > tick && (this.flash - tick) / 3 % 2 === 1
    // Hearts shake when health is low.
    let seed = tick * 312871
    const shake = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % 2 }
    for (let i = 9; i >= 0; i--) {
      const x = left + i * 8
      const y = top + (health <= 4 ? shake() : 0)
      gui.sprite(ctx, 'icons', 16 + (flashing ? 9 : 0), 0, 9, 9, x, y)
      if (i * 2 + 1 < health) gui.sprite(ctx, 'icons', 52, 0, 9, 9, x, y)
      else if (i * 2 + 1 === health) gui.sprite(ctx, 'icons', 61, 0, 9, 9, x, y)
    }
    const armor = hud.armor || 0
    if (armor > 0) {
      for (let i = 0; i < 10; i++) {
        const x = left + i * 8
        const y = top - 10
        if (i * 2 + 1 < armor) gui.sprite(ctx, 'icons', 34, 9, 9, 9, x, y)
        else if (i * 2 + 1 === armor) gui.sprite(ctx, 'icons', 25, 9, 9, 9, x, y)
        else gui.sprite(ctx, 'icons', 16, 9, 9, 9, x, y)
      }
    }
    const food = hud.food ?? 20
    for (let i = 0; i < 10; i++) {
      const x = right - i * 8 - 9
      gui.sprite(ctx, 'icons', 16, 27, 9, 9, x, top)
      if (i * 2 + 1 < food) gui.sprite(ctx, 'icons', 52, 27, 9, 9, x, top)
      else if (i * 2 + 1 === food) gui.sprite(ctx, 'icons', 61, 27, 9, 9, x, top)
    }
    const air = hud.air ?? 20
    if (air < 20) {
      const full = Math.ceil((air - 2) * 10 / 20)
      const popping = Math.ceil(air * 10 / 20) - full
      for (let i = 0; i < full + popping; i++) gui.sprite(ctx, 'icons', i < full ? 16 : 25, 18, 9, 9, right - i * 8 - 9, top - 10)
    }
  }

  titles (ctx, w, h, now) {
    const t = this.title
    if (!t.title || !t.start) return
    const ticks = (now - t.start) / TICK
    const total = t.fadeIn + t.stay + t.fadeOut
    if (ticks > total) return
    let alpha = 1
    if (ticks < t.fadeIn) alpha = ticks / Math.max(1, t.fadeIn)
    else if (ticks > t.fadeIn + t.stay) alpha = (total - ticks) / Math.max(1, t.fadeOut)
    if (alpha <= 0.03) return
    const font = this.gui.font
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.save()
    ctx.scale(4, 4)
    font.draw(ctx, t.title, -font.width(t.title) / 2, -10, 0xffffff, { shadow: true, alpha })
    ctx.restore()
    if (t.subtitle) {
      ctx.scale(2, 2)
      font.draw(ctx, t.subtitle, -font.width(t.subtitle) / 2, 5, 0xffffff, { shadow: true, alpha })
    }
    ctx.restore()
  }

  // GuiNewChat: ten lines that fade after ten seconds, twenty while the chat is open.
  chatLines (ctx, state, w, h, now) {
    const font = this.gui.font
    const open = state.chatOpen
    const count = open ? 20 : 10
    const width = 320
    const lines = this.chat.slice(-count).reverse()
    ctx.save()
    ctx.translate(2, h - 48)
    lines.forEach((line, i) => {
      const age = (now - line.time) / TICK
      if (!open && age >= 200) return
      let opacity = open ? 1 : Math.min(1, Math.max(0, (1 - age / 200) * 10))
      opacity *= opacity
      if (opacity * 255 <= 3) return
      const y = -i * 9
      ctx.fillStyle = `rgba(0,0,0,${opacity / 2})`
      ctx.fillRect(-2, y - 9, width + 4, 9)
      font.draw(ctx, line.text, 0, y - 8, 0xffffff, { shadow: true, alpha: opacity })
    })
    ctx.restore()
    if (open) {
      ctx.fillStyle = argb(0x80000000)
      ctx.fillRect(2, h - 14, w - 4, 12)
      const text = state.chatText || ''
      const caret = Math.floor(now / 300) % 2 === 0
      const shown = font.width(text) > w - 12 ? '…' + text.slice(-Math.floor((w - 12) / 5)) : text
      const end = font.draw(ctx, shown, 4, h - 12, 0xe0e0e0, { shadow: true })
      if (caret) font.draw(ctx, '_', 4 + end, h - 12, 0xe0e0e0, { shadow: true })
    }
  }

  sidebar (ctx, board, w, h) {
    const font = this.gui.font
    const lines = board.lines
    let width = font.width(board.title)
    for (const line of lines) width = Math.max(width, font.width(line.text + ': §c' + line.score))
    const total = lines.length * 9
    const bottom = Math.floor(h / 2 + total / 3)
    const left = w - width - 3
    const right = w - 3 + 2
    // Lowest score sits at the bottom.
    ;[...lines].reverse().forEach((line, i) => {
      const y = bottom - (i + 1) * 9
      ctx.fillStyle = argb(0x50000000)
      ctx.fillRect(left - 2, y, right - (left - 2), 9)
      font.draw(ctx, line.text, left, y, 0xffffff)
      const score = '§c' + line.score
      font.draw(ctx, score, right - font.width(score), y, 0xffffff)
      if (i === lines.length - 1) {
        ctx.fillStyle = argb(0x60000000)
        ctx.fillRect(left - 2, y - 10, right - (left - 2), 9)
        ctx.fillStyle = argb(0x50000000)
        ctx.fillRect(left - 2, y - 1, right - (left - 2), 1)
        font.draw(ctx, board.title, left + width / 2 - font.width(board.title) / 2, y - 9, 0xffffff)
      }
    })
    if (!lines.length && board.title) {
      ctx.fillStyle = argb(0x60000000)
      ctx.fillRect(left - 2, bottom - 10, right - (left - 2), 9)
      font.draw(ctx, board.title, left + width / 2 - font.width(board.title) / 2, bottom - 9, 0xffffff)
    }
  }

  // GuiPlayerTabOverlay: up to 20 rows per column, ping bars and faces.
  playerList (ctx, list, w, heads) {
    const { gui } = this
    const font = gui.font
    const players = list.players
    const showHeads = list.heads
    let nameWidth = 0
    for (const p of players) nameWidth = Math.max(nameWidth, font.width(p.name))
    let rows = players.length
    let columns = 1
    while (rows > 20) { columns++; rows = Math.ceil(players.length / columns) }
    const column = Math.floor(Math.min(columns * ((showHeads ? 9 : 0) + nameWidth + 13), w - 50) / columns)
    const left = Math.floor(w / 2 - (column * columns + (columns - 1) * 5) / 2)
    let top = 10
    let total = column * columns + (columns - 1) * 5
    const header = list.header ? font.wrap(list.header, w - 50) : []
    const footer = list.footer ? font.wrap(list.footer, w - 50) : []
    for (const line of [...header, ...footer]) total = Math.max(total, font.width(line))
    if (header.length) {
      ctx.fillStyle = argb(0x80000000)
      ctx.fillRect(w / 2 - total / 2 - 1, top - 1, total + 2, header.length * 9)
      for (const line of header) { font.drawCentered(ctx, line, w / 2, top, 0xffffff, { shadow: true }); top += 9 }
      top++
    }
    ctx.fillStyle = argb(0x80000000)
    ctx.fillRect(w / 2 - total / 2 - 1, top - 1, total + 2, rows * 9)
    players.forEach((p, i) => {
      const col = Math.floor(i / rows)
      let x = left + col * column + col * 5
      const y = top + (i % rows) * 9
      ctx.fillStyle = argb(0x20ffffff)
      ctx.fillRect(x, y, column, 8)
      if (showHeads) {
        const face = heads?.(p)
        if (face) ctx.drawImage(face, x, y, 8, 8)
        x += 9
      }
      font.draw(ctx, p.spectator ? '§7§o' + p.name.replace(/§./g, '') : p.name, x, y, 0xffffff, { shadow: true })
      const ping = p.ping < 0 ? 5 : p.ping < 150 ? 0 : p.ping < 300 ? 1 : p.ping < 600 ? 2 : p.ping < 1000 ? 3 : 4
      gui.sprite(ctx, 'icons', 0, 176 + ping * 8, 10, 8, x - (showHeads ? 9 : 0) + column - 11, y)
    })
    if (footer.length) {
      top += rows * 9 + 1
      ctx.fillStyle = argb(0x80000000)
      ctx.fillRect(w / 2 - total / 2 - 1, top - 1, total + 2, footer.length * 9)
      for (const line of footer) { font.drawCentered(ctx, line, w / 2, top, 0xffffff, { shadow: true }); top += 9 }
    }
  }

  // GuiOverlayDebug: grey-backed lines on both sides.
  debug (ctx, info, w) {
    const font = this.gui.font
    const block = (lines, alignRight) => lines.forEach((line, i) => {
      if (!line) return
      const width = font.width(line)
      const x = alignRight ? w - 2 - width : 2
      const y = 2 + i * 9
      ctx.fillStyle = argb(0x90505050)
      ctx.fillRect(x - 1, y - 1, width + 1, 9)
      font.draw(ctx, line, x, y, 0xe0e0e0)
    })
    block(info.left, false)
    block(info.right, true)
  }
}
