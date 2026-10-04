const { test } = require('node:test')
const assert = require('node:assert/strict')

test('player inventory keeps crafting, armor and offhand separate from storage', async () => {
  const { inventoryLayout } = await import('../public/js/play/mechanics.js')
  for (const count of [45, 46]) {
    const layout = inventoryLayout(count, null)
    assert.equal(new Set(layout.slots.map(s => s.slot)).size, count)
    assert.equal(layout.slots.length, count)
    assert.deepEqual(layout.slots.find(s => s.slot === 0), { slot: 0, x: 154, y: 28 })
    assert.deepEqual(layout.slots.find(s => s.slot === 36), { slot: 36, x: 8, y: 142 })
    assert.equal(layout.slots.some(s => s.slot === 45), count === 46)
  }
})

test('container layouts retain server slot indices and fit within the screen', async () => {
  const { inventoryLayout } = await import('../public/js/play/mechanics.js')
  for (const [kind, start] of [['chest', 9], ['chest', 27], ['chest', 54], ['crafting', 10], ['furnace', 3], ['hopper', 5], ['dispenser', 9]]) {
    const layout = inventoryLayout(start + 36, { kind, slots: start })
    assert.equal(layout.slots.length, start + 36)
    assert.equal(new Set(layout.slots.map(s => s.slot)).size, start + 36)
    assert.ok(layout.slots.every(s => s.x >= 0 && s.x + 16 <= layout.width && s.y >= 0 && s.y + 16 <= layout.height))
    assert.deepEqual(layout.slots.find(s => s.slot === start), { slot: start, x: 8, y: layout.inventoryY })
  }
})

test('Minecraft chat colors reset formatting and leave markup as text', async () => {
  const { textRuns } = await import('../public/js/play/mechanics.js')
  assert.deepEqual(textRuns('\u00a7aHello \u00a7lworld\u00a7c!\u00a7r <img src=x>'), [
    { text: 'Hello ', color: '#55ff55' }, { text: 'world', color: '#55ff55', bold: true },
    { text: '!', color: '#ff5555' }, { text: ' <img src=x>' }
  ])
  assert.deepEqual(textRuns('trailing \u00a7'), [{ text: 'trailing \u00a7' }])
  assert.deepEqual(textRuns('\u00a7x\u00a7f\u00a7f\u00a78\u00a78\u00a70\u00a70RGB\u00a7r plain'), [{ text: 'RGB', color: '#ff8800' }, { text: ' plain' }])
})
