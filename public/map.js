let mapData = null
let mapRequest = 0
let mapOptions = ''
let mapTimer
const mapCanvas = $('map')
const mapContext = mapCanvas.getContext('2d')

function updateMapAccounts () {
  const key = JSON.stringify(state.accounts.map(a => [a.id, a.username, a.label, Boolean(a.position)]))
  if (key === mapOptions) return
  mapOptions = key
  const previous = $('map-account').value
  $('map-account').innerHTML = '<option value="">Choose an account</option>' + state.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.username || a.label)}${a.position ? '' : ' (disconnected)'}</option>`).join('')
  $('map-account').value = state.accounts.some(a => a.id === previous) ? previous : ''
  if (!$('map-account').value) $('map-account').value = state.accounts.find(a => a.position)?.id || ''
  if ($('map-account').value !== previous) refreshMap(true)
}

async function refreshMap (reset = false) {
  clearTimeout(mapTimer)
  const request = ++mapRequest
  const id = $('map-account').value
  if (reset || !id) { mapData = null; drawMap() }
  if (!id) { $('map-status').textContent = 'Choose a connected account to load its map.'; $('map-status').hidden = false; return }
  const query = new URLSearchParams({ id, radius: $('map-radius').value, layer: $('map-layer').value })
  try {
    const response = await fetch('/api/map?' + query)
    const result = await response.json()
    if (request !== mapRequest) return
    if (!response.ok) throw Error(result.error || 'Map could not load.')
    mapData = result
    $('map-status').hidden = result.tiles.some(Boolean)
    $('map-status').textContent = 'Waiting for chunk data...'
    drawMap()
  } catch (error) {
    if (request !== mapRequest) return
    mapData = null
    drawMap()
    $('map-status').textContent = error.message
    $('map-status').hidden = false
  } finally {
    if (request === mapRequest) mapTimer = setTimeout(refreshMap, 2000)
  }
}

function blockColor (name) {
  if (/water|ice/.test(name)) return '#6e9fac'
  if (/lava|fire|magma/.test(name)) return '#cc7744'
  if (/snow|quartz/.test(name)) return '#dfdfd4'
  if (/sand|end_stone/.test(name)) return '#cec08a'
  if (/grass|leaves|moss/.test(name)) return '#859d65'
  if (/log|wood|planks|chest|crafting/.test(name)) return '#a18b67'
  if (/dirt|mud|terracotta/.test(name)) return '#9e8166'
  if (/netherrack|nether_brick/.test(name)) return '#975e58'
  return '#a2a99b'
}

function drawMap () {
  const ctx = mapContext
  const width = mapCanvas.width
  ctx.fillStyle = '#27382f'
  ctx.fillRect(0, 0, width, width)
  if (!mapData) return
  const { size, origin, tiles, player, route } = mapData
  const cell = width / size
  tiles.forEach((tile, index) => {
    if (!tile) return
    const x = index % size
    const z = Math.floor(index / size)
    ctx.fillStyle = blockColor(tile.block)
    ctx.fillRect(x * cell, z * cell, Math.ceil(cell), Math.ceil(cell))
    const neighbor = z > 0 ? tiles[index - size] : null
    if (neighbor && neighbor.height !== tile.height) {
      ctx.fillStyle = neighbor.height > tile.height ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.12)'
      ctx.fillRect(x * cell, z * cell, Math.ceil(cell), Math.ceil(cell))
    }
  })
  ctx.strokeStyle = 'rgba(255,255,255,.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= size; i++) {
    if ((origin.x + i) % 16 === 0) { ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, width) }
    if ((origin.z + i) % 16 === 0) { ctx.moveTo(0, i * cell); ctx.lineTo(width, i * cell) }
  }
  ctx.stroke()
  const screen = p => [(p.x - origin.x + 0.5) * cell, (p.z - origin.z + 0.5) * cell]
  ctx.strokeStyle = '#edaa63'
  ctx.fillStyle = '#edaa63'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])
  ctx.beginPath()
  route.points.forEach((p, index) => { const [x, z] = screen(p); if (index) ctx.lineTo(x, z); else ctx.moveTo(x, z) })
  if (route.mode === 'loop' && route.points.length) { const [x, z] = screen(route.points[0]); ctx.lineTo(x, z) }
  ctx.stroke()
  ctx.setLineDash([])
  route.points.forEach(p => { const [x, z] = screen(p); ctx.beginPath(); ctx.arc(x, z, 5, 0, Math.PI * 2); ctx.fill() })
  const x = (player.x - origin.x) * cell
  const z = (player.z - origin.z) * cell
  ctx.save()
  ctx.translate(x, z)
  ctx.rotate(Math.PI - player.yaw)
  ctx.beginPath()
  ctx.moveTo(0, 12); ctx.lineTo(-8, -8); ctx.lineTo(8, -8); ctx.closePath()
  ctx.fillStyle = '#5cb8e6'; ctx.fill()
  ctx.strokeStyle = '#f5fbff'; ctx.lineWidth = 2; ctx.stroke()
  ctx.restore()
  ctx.fillStyle = '#f4f5e9'
  ctx.font = 'bold 15px Segoe UI'
  ctx.fillText('N ↑', 12, 23)
}

function mapPoint (event) {
  if (!mapData) return null
  const rect = mapCanvas.getBoundingClientRect()
  const x = Math.floor((event.clientX - rect.left) / rect.width * mapData.size)
  const z = Math.floor((event.clientY - rect.top) / rect.height * mapData.size)
  if (x < 0 || z < 0 || x >= mapData.size || z >= mapData.size) return null
  return { x: mapData.origin.x + x, z: mapData.origin.z + z, tile: mapData.tiles[z * mapData.size + x] }
}

mapCanvas.addEventListener('mousemove', event => {
  const p = mapPoint(event)
  if (!p) return
  $('map-hover').textContent = p.tile ? `${p.x} ${p.tile.y} ${p.z} · ${p.tile.block.replaceAll('_', ' ')}${p.tile.walkable ? '' : ' · no standing space'}` : `${p.x} / ${p.z} · unloaded`
  mapCanvas.style.cursor = p.tile?.walkable ? 'crosshair' : 'not-allowed'
})
mapCanvas.addEventListener('mouseleave', () => { $('map-hover').textContent = 'North is up. Hover for coordinates.' })
mapCanvas.addEventListener('click', event => run(async () => {
  const p = mapPoint(event)
  if (!p?.tile?.walkable) throw Error('Click a loaded surface with space to stand.')
  const result = await api('map-walk', { id: $('map-account').value, x: p.x, z: p.z, layer: $('map-layer').value })
  notice(`Walking to ${result.point.x} ${result.point.y} ${result.point.z}.`)
  await refreshMap()
}))
for (const id of ['map-account', 'map-layer', 'map-radius']) $(id).addEventListener('change', () => refreshMap(true))
drawMap()
