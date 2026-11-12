// Small .xlsx writer: styles built on demand, frozen header, auto-filter, merged cells, formulas,
// tab colours, print titles and embedded JPEG pictures.
// Works in the mini program (require) and in the browser (window.TradeXlsx).
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./zip'))
  else root.TradeXlsx = factory(root.TradeZip)
})(this, function (Z) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    // strip control characters that are not allowed in XML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  const argb = c => 'FF' + String(c || '000000').replace('#', '').toUpperCase()

  // ---------- styles ----------
  // style({ font: { b, i, sz, color, name }, fill: 'RRGGBB', border: { top|bottom|left|right|all: 'thin:RRGGBB' },
  //         align: { h, v, wrap, indent }, num: 'format code' }) -> style id
  function Styles() {
    const fonts = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
    const borders = [], numFmts = [], xfs = [], seen = {}
    const index = (list, xml) => { let i = list.indexOf(xml); if (i < 0) { list.push(xml); i = list.length - 1 } return i }
    const fontXml = f => '<font>' + (f.b ? '<b/>' : '') + (f.i ? '<i/>' : '') + '<sz val="' + (f.sz || 11) + '"/><color rgb="' + argb(f.color || '1F2937') + '"/><name val="' + (f.name || 'Calibri') + '"/><family val="2"/></font>'
    const side = (tag, v) => {
      if (!v) return '<' + tag + '/>'
      const [st, col] = v.split(':')
      return '<' + tag + ' style="' + st + '"><color rgb="' + argb(col || 'E5E7EB') + '"/></' + tag + '>'
    }
    const borderXml = b => {
      b = b || {}
      return '<border>' + side('left', b.left || b.all) + side('right', b.right || b.all) + side('top', b.top || b.all) + side('bottom', b.bottom || b.all) + '<diagonal/></border>'
    }
    index(fonts, fontXml({}))
    index(borders, borderXml())
    function style(o) {
      o = o || {}
      const key = JSON.stringify(o)
      if (seen[key] != null) return seen[key]
      const fontId = index(fonts, fontXml(o.font || {}))
      const fillId = o.fill ? index(fills, '<fill><patternFill patternType="solid"><fgColor rgb="' + argb(o.fill) + '"/><bgColor indexed="64"/></patternFill></fill>') : 0
      const borderId = index(borders, borderXml(o.border))
      let numId = 0
      if (typeof o.num === 'number') numId = o.num
      else if (o.num) { let i = numFmts.indexOf(o.num); if (i < 0) { numFmts.push(o.num); i = numFmts.length - 1 } numId = 164 + i }
      const a = o.align || {}
      const align = '<alignment' + (a.h ? ' horizontal="' + a.h + '"' : '') + ' vertical="' + (a.v || 'center') + '"' + (a.wrap ? ' wrapText="1"' : '') + (a.indent ? ' indent="' + a.indent + '"' : '') + '/>'
      xfs.push('<xf numFmtId="' + numId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId + '" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' + align + '</xf>')
      return (seen[key] = xfs.length) // +1 for the default xf at index 0
    }
    function xml() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        (numFmts.length ? '<numFmts count="' + numFmts.length + '">' + numFmts.map((f, i) => '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + esc(f) + '"/>').join('') + '</numFmts>' : '') +
        '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts>' +
        '<fills count="' + fills.length + '">' + fills.join('') + '</fills>' +
        '<borders count="' + borders.length + '">' + borders.join('') + '</borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="' + (xfs.length + 1) + '"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' + xfs.join('') + '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    }
    return { style, xml }
  }

  function colName(i) {
    let s = ''
    i++
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) }
    return s
  }

  // cell: null | value | { v, s, f }  (f = formula without "=", v = cached result)
  function cellXml(cell, r, c) {
    if (cell == null) return ''
    const o = typeof cell === 'object' ? cell : { v: cell }
    const ref = colName(c) + (r + 1)
    const s = o.s != null ? ' s="' + o.s + '"' : ''
    if (o.f) return '<c r="' + ref + '"' + s + '><f>' + esc(o.f) + '</f>' + (typeof o.v === 'number' ? '<v>' + o.v + '</v>' : '') + '</c>'
    if (o.v == null || o.v === '') return '<c r="' + ref + '"' + s + '/>'
    if (typeof o.v === 'number' && isFinite(o.v)) return '<c r="' + ref + '"' + s + '><v>' + o.v + '</v></c>'
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(o.v) + '</t></is></c>'
  }

  const EMU = 9525 // per pixel

  function sheetXml(sh, hasDrawing) {
    const nCols = Math.max(1, sh.cols ? sh.cols.length : 1)
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    x += '<sheetPr>' + (sh.tabColor ? '<tabColor rgb="' + argb(sh.tabColor) + '"/>' : '') + '<pageSetUpPr fitToPage="1"/></sheetPr>'
    x += '<dimension ref="A1:' + colName(nCols - 1) + Math.max(1, sh.rows.length) + '"/>'
    x += '<sheetViews><sheetView workbookViewId="0"' + (sh.gridLines === false ? ' showGridLines="0"' : '') + (sh.selected ? ' tabSelected="1"' : '') + (sh.zoom ? ' zoomScale="' + sh.zoom + '"' : '') + '>'
    if (sh.freezeRow) {
      x += '<pane ySplit="' + sh.freezeRow + '" topLeftCell="A' + (sh.freezeRow + 1) + '" activePane="bottomLeft" state="frozen"/>'
    }
    x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18" customHeight="1"/>'
    if (sh.cols) {
      x += '<cols>' + sh.cols.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>'
    }
    x += '<sheetData>'
    sh.rows.forEach((row, r) => {
      const cells = row.cells || row
      x += '<row r="' + (r + 1) + '"' + (row.height ? ' ht="' + row.height + '" customHeight="1"' : '') + '>'
      cells.forEach((cell, c) => { x += cellXml(cell, r, c) })
      x += '</row>'
    })
    x += '</sheetData>'
    if (sh.autoFilter) x += '<autoFilter ref="' + sh.autoFilter + '"/>'
    if (sh.merges && sh.merges.length) x += '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map(m => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>'
    x += '<pageMargins left="0.4" right="0.4" top="0.55" bottom="0.55" header="0.25" footer="0.25"/>'
    x += '<pageSetup paperSize="9" orientation="' + (sh.portrait ? 'portrait' : 'landscape') + '" fitToWidth="1" fitToHeight="0"/>'
    if (sh.footer) x += '<headerFooter><oddFooter>' + esc(sh.footer) + '</oddFooter></headerFooter>'
    if (hasDrawing) x += '<drawing r:id="rId1"/>'
    return x + '</worksheet>'
  }

  function drawingXml(images) {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    images.forEach((im, i) => {
      const cx = im.w * EMU, cy = im.h * EMU
      x += '<xdr:oneCellAnchor><xdr:from><xdr:col>' + im.col + '</xdr:col><xdr:colOff>' + ((im.dx || 0) * EMU) + '</xdr:colOff>' +
        '<xdr:row>' + im.row + '</xdr:row><xdr:rowOff>' + ((im.dy || 0) * EMU) + '</xdr:rowOff></xdr:from>' +
        '<xdr:ext cx="' + cx + '" cy="' + cy + '"/>' +
        '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (i + 2) + '" name="Picture ' + (i + 1) + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
        '<xdr:blipFill><a:blip r:embed="rId' + (i + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
        '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 8000"/></a:avLst></a:prstGeom>' +
        (im.border ? '<a:ln w="9525"><a:solidFill><a:srgbClr val="' + im.border + '"/></a:solidFill></a:ln>' : '') + '</xdr:spPr></xdr:pic>' +
        '<xdr:clientData/></xdr:oneCellAnchor>'
    })
    return x + '</xdr:wsDr>'
  }

  const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const DOC_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const rels = list => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + REL_NS + '">' +
    list.map(r => '<Relationship Id="' + r.id + '" Type="' + DOC_NS + '/' + r.type + '" Target="' + r.target + '"/>').join('') + '</Relationships>'

  // sheets: [{ name, cols, rows, freezeRow, autoFilter, merges, tabColor, printTitleRows: [from, to], footer, images: [{ row, col, data, w, h, dx, dy }] }]
  // styles: the Styles() object the cells were styled with
  function build(sheets, meta, styles) {
    const files = []
    const overrides = [
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    ]
    let media = 0, drawings = 0
    const wbRels = []

    sheets.forEach((sh, i) => {
      const n = i + 1
      const imgs = (sh.images || []).filter(im => im && im.data)
      overrides.push('<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
      wbRels.push({ id: 'rId' + n, type: 'worksheet', target: 'worksheets/sheet' + n + '.xml' })
      files.push({ name: 'xl/worksheets/sheet' + n + '.xml', data: sheetXml(sh, imgs.length > 0) })
      if (imgs.length) {
        const d = ++drawings
        overrides.push('<Override PartName="/xl/drawings/drawing' + d + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>')
        files.push({ name: 'xl/worksheets/_rels/sheet' + n + '.xml.rels', data: rels([{ id: 'rId1', type: 'drawing', target: '../drawings/drawing' + d + '.xml' }]) })
        const imgRels = imgs.map((im, k) => {
          const m = ++media
          files.push({ name: 'xl/media/image' + m + '.jpeg', data: im.data })
          return { id: 'rId' + (k + 1), type: 'image', target: '../media/image' + m + '.jpeg' }
        })
        files.push({ name: 'xl/drawings/drawing' + d + '.xml', data: drawingXml(imgs) })
        files.push({ name: 'xl/drawings/_rels/drawing' + d + '.xml.rels', data: rels(imgRels) })
      }
    })
    wbRels.push({ id: 'rId' + (sheets.length + 1), type: 'styles', target: 'styles.xml' })

    files.unshift({
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="jpeg" ContentType="image/jpeg"/>' + overrides.join('') + '</Types>'
    })
    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + REL_NS + '">' +
      '<Relationship Id="rId1" Type="' + DOC_NS + '/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' })
    const iso = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    files.push({ name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc((meta && meta.title) || 'Report') + '</dc:title><dc:creator>Trade</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created></cp:coreProperties>' })

    const names = []
    sheets.forEach((sh, i) => {
      const q = '\'' + esc(sh.name.slice(0, 31)).replace(/'/g, '\'\'') + '\''
      if (sh.autoFilter) names.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">' + q + '!$' + sh.autoFilter.replace(/([A-Z]+)(\d+):([A-Z]+)(\d+)/, '$1$$$2:$$$3$$$4') + '</definedName>')
      if (sh.printTitleRows) names.push('<definedName name="_xlnm.Print_Titles" localSheetId="' + i + '">' + q + '!$' + sh.printTitleRows[0] + ':$' + sh.printTitleRows[1] + '</definedName>')
    })
    files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + DOC_NS + '"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      sheets.map((sh, i) => '<sheet name="' + esc(sh.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
      '</sheets>' + (names.length ? '<definedNames>' + names.join('') + '</definedNames>' : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' })
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: rels(wbRels) })
    files.push({ name: 'xl/styles.xml', data: (styles || Styles()).xml() })
    return Z.zip(files)
  }

  return { build, Styles, colName }
})
