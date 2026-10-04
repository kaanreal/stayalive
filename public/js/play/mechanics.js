// Coordinates are GUI pixels, before the browser scales the screen.
export function inventoryLayout (count, window) {
  const slots = []
  const add = (slot, x, y) => { if (slot < count) slots.push({ slot, x, y }) }
  const grid = (from, length, x, y, columns) => {
    for (let i = 0; i < length; i++) add(from + i, x + i % columns * 18, y + Math.floor(i / columns) * 18)
  }
  if (!window) {
    grid(5, 4, 8, 8, 1)
    grid(1, 4, 98, 18, 2)
    add(0, 154, 28)
    add(45, 77, 62)
    grid(9, 27, 8, 84, 9)
    grid(36, 9, 8, 142, 9)
    return { width: 176, height: 166, texture: 'inventory', slots, inventoryY: 84 }
  }
  const start = window.slots
  let height = 166
  let texture = window.kind === 'crafting' ? 'crafting_table' : window.kind
  let inventoryY = 84
  if (window.kind === 'crafting') { grid(1, 9, 30, 17, 3); add(0, 124, 35) }
  else if (window.kind === 'furnace') { add(0, 56, 17); add(1, 56, 53); add(2, 116, 35) }
  else if (window.kind === 'dispenser') grid(0, start, 62, 17, 3)
  else if (window.kind === 'hopper') { grid(0, start, 44, 20, 5); height = 133; inventoryY = 51 }
  else {
    const rows = Math.ceil(start / 9)
    grid(0, start, 8, 18, 9)
    inventoryY = rows * 18 + 31
    height = rows * 18 + 114
    texture = 'generic_54'
  }
  grid(start, 27, 8, inventoryY, 9)
  grid(start + 27, 9, 8, inventoryY + 58, 9)
  return { width: 176, height, texture, slots, inventoryY }
}

const colors = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#ffaa00', '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff']
export function textRuns (text) {
  text = String(text)
  const runs = []
  let style = {}
  let content = ''
  const flush = () => { if (content) runs.push({ text: content, ...style }); content = '' }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\u00a7' && text[i + 1]?.toLowerCase() === 'x' && /^(?:\u00a7[0-9a-f]){6}$/i.test(text.slice(i + 2, i + 14))) {
      flush()
      style = { color: '#' + text.slice(i + 2, i + 14).replace(/\u00a7/g, '') }
      i += 13
      continue
    }
    const code = text[i + 1]?.toLowerCase()
    if (c !== '\u00a7' || !/[0-9a-fk-or]/.test(code || '')) { content += c; continue }
    flush(); i++
    if (/[0-9a-f]/.test(code)) style = { color: colors[parseInt(code, 16)] }
    else if (code === 'r') style = {}
    else if (code === 'l') style.bold = true
    else if (code === 'o') style.italic = true
    else if (code === 'n') style.underline = true
    else if (code === 'm') style.strike = true
  }
  flush()
  return runs
}
