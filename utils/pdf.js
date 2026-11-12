// Minimal PDF writer: one full-page JPEG per A4 page.
// The report pages are drawn on a canvas (so Chinese text, emoji and photos all work)
// and each page image is wrapped into the PDF here.
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./zip'))
  else root.TradePdf = factory(root.TradeZip)
})(this, function (Z) {
  const A4 = { w: 595.28, h: 841.89 }

  // Read width/height from the JPEG SOF marker
  function jpegSize(b) {
    let i = 2
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      const len = (b[i + 2] << 8) | b[i + 3]
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
      }
      i += 2 + len
    }
    throw new Error('Invalid JPEG')
  }

  function pdfString(s) {
    // UTF-16BE hex string so any language works in the document title
    let hex = 'FEFF'
    for (let i = 0; i < s.length; i++) hex += ('0000' + s.charCodeAt(i).toString(16)).slice(-4)
    return '<' + hex.toUpperCase() + '>'
  }

  // pages: Uint8Array[] (JPEG bytes)
  function fromJpegs(pages, title) {
    const chunks = [], offsets = []
    let pos = 0
    const push = d => { const b = typeof d === 'string' ? Z.utf8(d) : d; chunks.push(b); pos += b.length }
    const obj = (n, body) => { offsets[n] = pos; push(n + ' 0 obj\n'); body(); push('\nendobj\n') }

    push('%PDF-1.4\n%')
    push(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a])) // binary marker comment

    const n = pages.length
    // object numbers: 1 catalog, 2 pages, 3 info, then per page: page, content, image
    const kids = []
    for (let i = 0; i < n; i++) kids.push((4 + i * 3) + ' 0 R')

    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
    obj(2, () => push('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>'))
    obj(3, () => push('<< /Title ' + pdfString(title || 'Report') + ' /Producer (Trade mini program) >>'))

    pages.forEach((jpg, i) => {
      const pn = 4 + i * 3, cn = pn + 1, im = pn + 2
      const size = jpegSize(jpg)
      // Keep the image aspect ratio on an A4-width page
      const pw = A4.w, ph = Math.round(A4.w * size.h / size.w * 100) / 100
      obj(pn, () => push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + cn + ' 0 R >>'))
      const content = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q'
      obj(cn, () => { push('<< /Length ' + content.length + ' >>\nstream\n'); push(content); push('\nendstream') })
      obj(im, () => {
        push('<< /Type /XObject /Subtype /Image /Width ' + size.w + ' /Height ' + size.h +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n')
        push(jpg)
        push('\nendstream')
      })
    })

    const total = 4 + n * 3
    const xref = pos
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n'
    for (let i = 1; i < total; i++) x += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n'
    push(x)
    push('trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n')
    return Z.concat(chunks)
  }

  return { fromJpegs, jpegSize }
})
