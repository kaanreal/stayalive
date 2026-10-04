// Thin wrappers around the local StayAlive HTTP API (see server.js).
export async function post (action, body) {
  const response = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw Error(result.error || 'Request failed.')
  return result
}

export async function getMap (id, radius, layer) {
  const response = await fetch('/api/map?' + new URLSearchParams({ id, radius, layer }))
  const result = await response.json()
  if (!response.ok) throw Error(result.error || 'Map could not load.')
  return result
}
