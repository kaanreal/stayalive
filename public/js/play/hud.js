import { textRuns } from './mechanics.js'

export function minecraftText (element, text) {
  element.replaceChildren()
  for (const run of textRuns(text ?? '')) {
    const span = document.createElement('span')
    span.textContent = run.text
    if (run.color) span.style.color = run.color
    if (run.bold) span.style.fontWeight = 'bold'
    if (run.italic) span.style.fontStyle = 'italic'
    span.style.textDecoration = [run.underline && 'underline', run.strike && 'line-through'].filter(Boolean).join(' ')
    element.append(span)
  }
}

const icons = new Image()
icons.src = '/play/textures/1.16.4/gui/icons.png'
let latest
icons.onload = () => { if (latest) survivalHud(latest) }

function bar (id, value, row, empty, full, half, reverse = false) {
  const canvas = document.getElementById(id)
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false
  if (!icons.complete || !icons.naturalWidth) return
  for (let i = 0; i < 10; i++) {
    const x = (reverse ? 9 - i : i) * 16
    ctx.drawImage(icons, empty, row, 9, 9, x, 0, 18, 18)
    const points = value - i * 2
    if (points > 0) ctx.drawImage(icons, points >= 2 ? full : half, row, 9, 9, x, 0, 18, 18)
  }
  canvas.setAttribute('aria-label', `${id.slice(4)} ${value} of 20`)
}

export function survivalHud (hud) {
  latest = hud
  document.body.classList.toggle('creative', ['creative', 'spectator'].includes(hud.gameMode))
  bar('hud-health', Math.ceil(hud.health || 0), 0, 16, 52, 61)
  bar('hud-food', hud.food || 0, 27, 16, 52, 61, true)
  bar('hud-armor', hud.armor || 0, 9, 16, 34, 25)
  bar('hud-air', hud.air || 0, 18, 25, 16, 25, true)
  document.getElementById('hud-armor').hidden = !hud.armor
  document.getElementById('hud-air').hidden = hud.air >= 20
  const xp = document.getElementById('hud-xp')
  const ctx = xp.getContext('2d')
  ctx.clearRect(0, 0, 364, 10)
  ctx.imageSmoothingEnabled = false
  if (icons.complete && icons.naturalWidth) {
    ctx.drawImage(icons, 0, 64, 182, 5, 0, 0, 364, 10)
    const width = Math.floor(182 * Math.max(0, Math.min(1, hud.xp.progress)))
    if (width) ctx.drawImage(icons, 0, 69, width, 5, 0, 0, width * 2, 10)
  }
  document.getElementById('hud-level').textContent = hud.xp.level || ''
}

export function sidebar (board) {
  const element = document.getElementById('scoreboard')
  element.hidden = !board
  element.replaceChildren()
  if (!board) return
  const title = document.createElement('header')
  minecraftText(title, board.title)
  element.append(title)
  for (const line of board.lines) {
    const row = document.createElement('div')
    const name = document.createElement('span')
    minecraftText(name, line.text)
    const score = document.createElement('b')
    score.textContent = line.score
    row.append(name, score)
    element.append(row)
  }
}

export function playerList (data) {
  const element = document.getElementById('player-list')
  element.replaceChildren()
  for (const [tag, text] of [['header', data.header], ['footer', data.footer]]) {
    if (!text) continue
    const block = document.createElement(tag)
    minecraftText(block, text)
    element.append(block)
  }
  const list = document.createElement('div')
  list.className = 'tab-players'
  list.style.gridTemplateColumns = `repeat(${Math.max(1, Math.ceil(data.players.length / 20))}, minmax(140px, 1fr))`
  for (const player of data.players) {
    const row = document.createElement('div')
    if (player.spectator) row.classList.add('spectator')
    const name = document.createElement('span')
    minecraftText(name, player.name)
    const ping = document.createElement('small')
    ping.textContent = `${player.ping} ms`
    row.append(name, ping)
    list.append(row)
  }
  element.insertBefore(list, element.querySelector('footer'))
}

let titleTimer
let titleTimes = { fadeIn: 10, stay: 70, fadeOut: 20 }
export function serverTitle (data) {
  const element = document.getElementById('server-title')
  if (data.type === 'times') {
    for (const key of ['fadeIn', 'stay', 'fadeOut']) if (Number.isFinite(data[key]) && data[key] >= 0) titleTimes[key] = data[key]
    return
  }
  if (data.type === 'clear') {
    clearTimeout(titleTimer)
    element.hidden = true
    element.replaceChildren()
    return
  }
  let line = element.querySelector(data.type === 'title' ? 'h1' : 'p')
  if (!line) {
    line = document.createElement(data.type === 'title' ? 'h1' : 'p')
    if (data.type === 'title') element.prepend(line)
    else element.append(line)
  }
  minecraftText(line, data.text)
  if (data.type !== 'title') return
  clearTimeout(titleTimer)
  const total = Math.max(1, titleTimes.fadeIn + titleTimes.stay + titleTimes.fadeOut) * 50
  element.hidden = false
  element.getAnimations().forEach(animation => animation.cancel())
  element.animate([{ opacity: 0 }, { opacity: 1, offset: titleTimes.fadeIn * 50 / total }, { opacity: 1, offset: (titleTimes.fadeIn + titleTimes.stay) * 50 / total }, { opacity: 0 }], { duration: total })
  titleTimer = setTimeout(() => { element.hidden = true }, total)
}
