// Generates the app icons (PNG) used by the installable web app: node preview/make-icons.js
const fs = require('fs'), path = require('path'), zlib = require('zlib')

function crc32(buf) {
  let c, crc = 0xFFFFFFFF
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4) }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
// Box glyph from utils/icons.js (24x24 grid)
const P = [[21, 8], [12, 3], [3, 8], [3, 16], [12, 21], [21, 16]]
const SEGS = P.map((p, i) => [p, P[(i + 1) % P.length]]).concat([[[3, 8], [12, 13]], [[12, 13], [21, 8]], [[12, 13], [12, 21]]])
const C1 = [20, 184, 166], C2 = [19, 78, 74] // brand-2 -> brand-dark

function draw(size, maskable) {
  const buf = Buffer.alloc(size * size * 4), S = 3 // supersampling
  const radius = maskable ? 0 : size * 0.22
  const glyph = (maskable ? 0.42 : 0.5) * size, off = (size - glyph) / 2, stroke = 2.1
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let bg = 0, fg = 0
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S
      // rounded square
      const cx = Math.max(radius, Math.min(size - radius, px)), cy = Math.max(radius, Math.min(size - radius, py))
      if (Math.hypot(px - cx, py - cy) <= radius || radius === 0) bg++
      const gx = (px - off) / glyph * 24, gy = (py - off) / glyph * 24
      if (SEGS.some(s => segDist(gx, gy, s[0][0], s[0][1], s[1][0], s[1][1]) <= stroke / 2 + 0.05)) fg++
    }
    const a = bg / (S * S), f = fg / (S * S), t = (x + y) / (2 * size)
    const i = (y * size + x) * 4
    for (let c = 0; c < 3; c++) buf[i + c] = Math.round((C1[c] * (1 - t) + C2[c] * t) * (1 - f) + 255 * f)
    buf[i + 3] = Math.round(255 * a)
  }
  return png(size, buf)
}

const dir = path.join(__dirname, 'icons')
fs.mkdirSync(dir, { recursive: true })
;[[192, false], [512, false], [180, true], [512, true]].forEach(([s, m]) => {
  const name = m && s === 512 ? 'icon-maskable-512.png' : 'icon-' + s + '.png'
  fs.writeFileSync(path.join(dir, name), draw(s, m))
  console.log('wrote', name)
})
