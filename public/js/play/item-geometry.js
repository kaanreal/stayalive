import * as THREE from '/vendor/three.js'

function builder () {
  const positions = []; const uvs = []; const indices = []; const colors = []
  return {
    quad (corners, uv, color = [1, 1, 1]) {
      const start = positions.length / 3
      for (const corner of corners) positions.push(...corner)
      uvs.push(...uv)
      for (let i = 0; i < 4; i++) colors.push(...color)
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
    },
    finish () {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geometry.setIndex(indices)
      geometry.computeVertexNormals()
      return geometry
    }
  }
}

// Generated item models have two faces and a one-pixel rim around opaque pixels.
export function spriteGeometry (image) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const width = canvas.width; const height = canvas.height
  const solid = (x, y) => x >= 0 && x < width && y >= 0 && y < height && pixels[(y * width + x) * 4 + 3] > 0
  const mesh = builder()
  const front = 1 / 32; const back = -front
  mesh.quad([[-0.5, -0.5, front], [0.5, -0.5, front], [0.5, 0.5, front], [-0.5, 0.5, front]], [0, 0, 1, 0, 1, 1, 0, 1])
  mesh.quad([[0.5, -0.5, back], [-0.5, -0.5, back], [-0.5, 0.5, back], [0.5, 0.5, back]], [1, 0, 0, 0, 0, 1, 1, 1])
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue
      const left = x / width - 0.5; const right = (x + 1) / width - 0.5
      const top = 0.5 - y / height; const bottom = 0.5 - (y + 1) / height
      const u = (x + 0.5) / width; const v = 1 - (y + 0.5) / height
      const uv = [u, v, u, v, u, v, u, v]
      if (!solid(x - 1, y)) mesh.quad([[left, bottom, back], [left, bottom, front], [left, top, front], [left, top, back]], uv)
      if (!solid(x + 1, y)) mesh.quad([[right, bottom, front], [right, bottom, back], [right, top, back], [right, top, front]], uv)
      if (!solid(x, y - 1)) mesh.quad([[left, top, front], [right, top, front], [right, top, back], [left, top, back]], uv)
      if (!solid(x, y + 1)) mesh.quad([[left, bottom, back], [right, bottom, back], [right, bottom, front], [left, bottom, front]], uv)
    }
  }
  return mesh.finish()
}

export function blockGeometry (model, tint = 0xffffff) {
  const mesh = builder()
  const color = new THREE.Color(tint).toArray()
  for (const element of model.elements || []) {
    const [x0, y0, z0] = element.from.map(value => value / 16 - 0.5)
    const [x1, y1, z1] = element.to.map(value => value / 16 - 0.5)
    const faces = {
      south: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      north: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
      east: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
      west: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      up: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
      down: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]
    }
    for (const [name, face] of Object.entries(element.faces)) {
      const { u, v, su, sv } = face.texture
      const uv = [u, 1 - v - sv, u + su, 1 - v - sv, u + su, 1 - v, u, 1 - v]
      let corners = faces[name]
      if (element.rotation) {
        const origin = new THREE.Vector3(...element.rotation.origin.map(value => value / 16 - 0.5))
        const axis = new THREE.Vector3()
        axis[element.rotation.axis] = 1
        const rotation = new THREE.Quaternion().setFromAxisAngle(axis, element.rotation.angle * Math.PI / 180)
        corners = corners.map(corner => new THREE.Vector3(...corner).sub(origin).applyQuaternion(rotation).add(origin).toArray())
      }
      if (element.modelRotation) corners = corners.map(corner => new THREE.Vector3(...corner).applyAxisAngle(new THREE.Vector3(0, 1, 0), -element.modelRotation * Math.PI / 180).toArray())
      mesh.quad(corners, uv, face.tintindex === 0 ? color : undefined)
    }
  }
  return mesh.finish()
}
