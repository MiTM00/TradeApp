// Minimal ZIP writer (store / no compression) + UTF-8 encoder.
// Works in the mini program (require) and in the browser preview (window.TradeZip).
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.TradeZip = factory()
})(this, function () {
  function utf8(str) {
    const out = []
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i)
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        const d = str.charCodeAt(i + 1)
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++ }
      }
      if (c < 0x80) out.push(c)
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    }
    return new Uint8Array(out)
  }

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })()

  function crc32(bytes) {
    let c = 0xffffffff
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  function concat(chunks) {
    let len = 0
    chunks.forEach(c => { len += c.length })
    const out = new Uint8Array(len)
    let o = 0
    chunks.forEach(c => { out.set(c, o); o += c.length })
    return out
  }

  // files: [{ name: 'a/b.xml', data: Uint8Array | string }]
  function zip(files) {
    const chunks = [], central = []
    let offset = 0
    const now = new Date()
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

    files.forEach(f => {
      const name = utf8(f.name)
      const data = typeof f.data === 'string' ? utf8(f.data) : f.data
      const crc = crc32(data)
      const h = new DataView(new ArrayBuffer(30))
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true)
      h.setUint16(8, 0, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true)
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true)
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true)
      chunks.push(new Uint8Array(h.buffer), name, data)

      const c = new DataView(new ArrayBuffer(46))
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true)
      c.setUint16(10, 0, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true)
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true)
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true)
      central.push(new Uint8Array(c.buffer), name)
      offset += 30 + name.length + data.length
    })

    const cd = concat(central)
    const e = new DataView(new ArrayBuffer(22))
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true)
    e.setUint32(12, cd.length, true); e.setUint32(16, offset, true)
    return concat(chunks.concat([cd, new Uint8Array(e.buffer)]))
  }

  return { zip, utf8, concat, crc32 }
})
