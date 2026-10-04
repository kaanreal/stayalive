/* global importScripts */
// Keep atlas bounds beside the meshing work, away from input and camera updates.
const send = self.postMessage.bind(self)
let epoch = 0
let atlasAlpha = null
self.postMessage = (data, transfer = []) => {
  data.epoch = epoch
  if (data.type === 'geometry') {
    const g = data.geometry
    const rects = new Float32Array(g.uvs.length * 2)
    for (let v = 0; v < g.uvs.length / 2; v += 4) {
      let minU = Infinity; let minV = Infinity; let maxU = -Infinity; let maxV = -Infinity
      for (let k = v; k < v + 4; k++) {
        const u = g.uvs[k * 2]; const w = g.uvs[k * 2 + 1]
        minU = Math.min(minU, u); minV = Math.min(minV, w)
        maxU = Math.max(maxU, u); maxV = Math.max(maxV, w)
      }
      for (let k = v; k < v + 4; k++) rects.set([minU, minV, maxU, maxV], k * 4)
    }
    g.uvRects = rects
    transfer.push(rects.buffer)
    const buckets = new Map()
    for (let i = 0; i < g.indices.length; i += 3) {
      const triangle = [g.indices[i], g.indices[i + 1], g.indices[i + 2]]
      const bounds = [0, 1, 2].map(axis => {
        const values = triangle.map(index => g.positions[index * 3 + axis])
        return [Math.max(0, Math.min(3, Math.floor((Math.min(...values) + 8) / 4))), Math.max(0, Math.min(3, Math.floor((Math.max(...values) + 8) / 4)))]
      })
      for (let x = bounds[0][0]; x <= bounds[0][1]; x++) for (let y = bounds[1][0]; y <= bounds[1][1]; y++) for (let z = bounds[2][0]; z <= bounds[2][1]; z++) {
        const key = `${x},${y},${z}`
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(...triangle)
      }
    }
    g.collision = [...buckets].map(([key, indices]) => {
      const array = new Uint32Array(indices)
      transfer.push(array.buffer)
      return { cell: key.split(',').map(Number), indices: array }
    })
    const opaque = []; const translucent = []
    for (let i = 0; i < g.indices.length; i += 3) {
      const vertex = g.indices[i]
      const rect = rects.subarray(vertex * 4, vertex * 4 + 4)
      const x = Math.floor((rect[0] + rect[2]) * 0.5 * (atlasAlpha?.size || 1))
      const y = Math.floor((rect[1] + rect[3]) * 0.5 * (atlasAlpha?.size || 1))
      const target = atlasAlpha?.tiles[y * atlasAlpha.size + x] ? translucent : opaque
      target.push(g.indices[i], g.indices[i + 1], g.indices[i + 2])
    }
    g.opaqueCount = opaque.length
    g.indices = new Uint32Array([...opaque, ...translucent])
    transfer.push(g.indices.buffer)
  }
  send(data, transfer)
}
importScripts('/play/worker.js' + self.location.search)
const handle = self.onmessage
self.onmessage = event => {
  if (event.data.type === 'atlasAlpha') { atlasAlpha = event.data; return }
  if (event.data.type === 'reset') epoch = event.data.epoch
  handle(event)
}
