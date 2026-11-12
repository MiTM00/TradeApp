// Report: summary numbers + PDF and Excel export.
// Platform-specific parts are passed in as `env`:
//   env.canvas            a Canvas 2D object (getContext('2d'), width/height settable)
//   env.loadImage(src)    -> Promise<image drawable on env.canvas | null>
//   env.toJpeg(canvas, q) -> Promise<Uint8Array>
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pdf'), require('./xlsx'), require('./i18n'))
  else root.TradeReport = factory(root.TradePdf, root.TradeXlsx, root.TradeI18n)
})(this, function (Pdf, Xlsx, I18n) {
  const L = (k, v) => I18n.t(k, v) // text in the current language
  const LP = (n, w) => I18n.plural(n, w)
  const marketName = n => n === NO_MARKET ? L(NO_MARKET) : n
  const NO_MARKET = 'No market'

  const C = {
    ink: '#0F172A', sub: '#64748B', faint: '#94A3B8', line: '#E2E8F0', bg: '#F8FAFC',
    brand: '#0F766E', brand2: '#14B8A6', brandDark: '#134E4A', mint: '#F0FDFA', mint2: '#CCFBF1',
    price: '#E11D48', white: '#FFFFFF', amber: '#F59E0B'
  }
  const FONT = '-apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", Arial, sans-serif'

  function pad(n) { return (n < 10 ? '0' : '') + n }
  function ymd(t) { const d = new Date(t || Date.now()); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
  function stamp(t) { const d = new Date(t || Date.now()); return ymd(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) }
  const months = () => I18n.MONTHS[I18n.getLang()] || I18n.MONTHS.en
  // Date the product was registered: set automatically on first save.
  // Older products saved before createdAt existed use their id, which is the save timestamp.
  function registeredAt(p) {
    const t = Number(p.createdAt) || Number(p.id)
    return t > 946684800000 ? t : 0 // ignore anything before year 2000
  }
  function dateLabel(t) {
    if (!t) return '—'
    const d = new Date(t)
    if (I18n.getLang() === 'zh') return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
    return d.getDate() + ' ' + months().short[d.getMonth()] + ' ' + d.getFullYear()
  }
  function monthShort(i) { return months().short[i] }
  function dateTimeLabel(t) { if (!t) return '—'; const d = new Date(t); return dateLabel(t) + (I18n.getLang() === 'zh' ? ' ' : ', ') + pad(d.getHours()) + ':' + pad(d.getMinutes()) }
  // Excel stores dates as days since 1899-12-30 (local time)
  function excelDate(t) { return (t - new Date(t).getTimezoneOffset() * 60000) / 86400000 + 25569 }
  function money(n) {
    const neg = n < 0, s = Math.abs(Math.round(n * 100) / 100).toFixed(2)
    const [i, f] = s.split('.')
    return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + f
  }
  function int(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

  // ---------- periods (daily / monthly / yearly) ----------
  function periodKey(t, kind) {
    if (!t) return ''
    const d = new Date(t)
    if (kind === 'year') return String(d.getFullYear())
    if (kind === 'month') return d.getFullYear() + '-' + pad(d.getMonth() + 1)
    return ymd(d)
  }
  function periodLabel(key, kind) {
    if (!key) return L('No date')
    const p = key.split('-').map(Number)
    const zh = I18n.getLang() === 'zh'
    if (kind === 'year') return zh ? p[0] + '年' : String(p[0])
    if (kind === 'month') return zh ? p[0] + '年' + p[1] + '月' : months().long[p[1] - 1] + ' ' + p[0]
    const d = new Date(p[0], p[1] - 1, p[2]), today = new Date()
    const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    if (key === ymd(today)) return L('Today, {date}', { date: dateLabel(d.getTime()) })
    if (key === ymd(y)) return L('Yesterday, {date}', { date: dateLabel(d.getTime()) })
    return dateLabel(d.getTime())
  }
  function totalsOf(list) {
    const m = new Map()
    list.forEach(p => m.set(p.currency, (m.get(p.currency) || 0) + (Number(p.price) || 0) * (Number(p.minOrder) || 0)))
    return Array.from(m, ([currency, value]) => ({ currency, value }))
  }
  // Groups products by the day / month / year they were registered, newest first
  function byPeriod(products, kind) {
    const map = new Map()
    products.forEach(p => {
      const k = periodKey(registeredAt(p), kind)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(p)
    })
    return Array.from(map, ([key, list]) => {
      const markets = new Set(list.map(p => (p.marketName || '').trim()).filter(Boolean))
      const shops = new Set(list.map(p => (p.marketName || '') + '|' + p.shopName))
      return { key, kind, label: periodLabel(key, kind), products: list, count: list.length, marketCount: markets.size, shopCount: shops.size, totals: totalsOf(list) }
    }).sort((a, b) => (b.key || '').localeCompare(a.key || ''))
  }

  function summarize(products) {
    const markets = new Map(), shops = new Set(), totals = new Map()
    let photos = 0, located = 0
    const sorted = products.slice().sort((a, b) =>
      (!a.marketName) - (!b.marketName) || (a.marketName || '').localeCompare(b.marketName || '') || (a.shopName || '').localeCompare(b.shopName || '') || (a.name || '').localeCompare(b.name || ''))
    sorted.forEach(p => {
      const mName = (p.marketName || '').trim() || NO_MARKET
      if (!markets.has(mName)) markets.set(mName, { name: mName, shops: new Map(), products: [], photos: 0, totals: new Map() })
      const m = markets.get(mName)
      if (!m.shops.has(p.shopName)) m.shops.set(p.shopName, { name: p.shopName, location: p.location, products: [] })
      m.shops.get(p.shopName).products.push(p)
      m.products.push(p)
      const n = (p.images || []).length
      m.photos += n; photos += n
      if (p.location) located++
      shops.add(mName + '|' + p.shopName)
      const v = (Number(p.price) || 0) * (Number(p.minOrder) || 0)
      totals.set(p.currency, (totals.get(p.currency) || 0) + v)
      m.totals.set(p.currency, (m.totals.get(p.currency) || 0) + v)
    })
    const list = Array.from(markets.values()).map(m => ({
      name: m.name, products: m.products, photos: m.photos,
      shops: Array.from(m.shops.values()),
      totals: Array.from(m.totals, ([currency, value]) => ({ currency, value }))
    })).sort((a, b) => (a.name === NO_MARKET) - (b.name === NO_MARKET) || b.products.length - a.products.length)
    return {
      count: products.length,
      marketCount: list.filter(m => m.name !== NO_MARKET).length,
      shopCount: shops.size,
      photoCount: photos,
      located,
      totals: Array.from(totals, ([currency, value]) => ({ currency, value })),
      markets: list,
      products: sorted,
      generatedAt: Date.now()
    }
  }

  function totalsText(totals) {
    return totals.length ? totals.map(t => t.currency + money(t.value)).join('  ·  ') : '—'
  }

  // ---------- canvas helpers ----------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
  function font(ctx, size, weight) { ctx.font = (weight || 'normal') + ' ' + size + 'px ' + FONT }
  function fit(ctx, text, maxW) {
    text = String(text == null ? '' : text)
    if (ctx.measureText(text).width <= maxW) return text
    let lo = 0, hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid
      else hi = mid - 1
    }
    return text.slice(0, lo) + '…'
  }
  function text(ctx, s, x, y, o) {
    font(ctx, o.size, o.weight)
    ctx.fillStyle = o.color || C.ink
    ctx.textAlign = o.align || 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(o.max ? fit(ctx, s, o.max) : String(s), x, y)
    const w = ctx.measureText(o.max ? fit(ctx, s, o.max) : String(s)).width
    ctx.textAlign = 'left'
    return w
  }
  function pill(ctx, s, x, y, o) {
    font(ctx, o.size || 22, o.weight || '600')
    const w = ctx.measureText(s).width + 28, h = (o.size || 22) + 18
    ctx.fillStyle = o.bg; rr(ctx, x, y, w, h, h / 2); ctx.fill()
    ctx.fillStyle = o.color; ctx.textBaseline = 'middle'; ctx.fillText(s, x + 14, y + h / 2 + 1); ctx.textBaseline = 'alphabetic'
    return w
  }
  function cover(ctx, img, x, y, w, h, r) {
    ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip()
    if (img) {
      const iw = img.width, ih = img.height, s = Math.max(w / iw, h / ih)
      const sw = w / s, sh = h / s
      ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h)
    } else {
      const g = ctx.createLinearGradient(x, y, x + w, y + h)
      g.addColorStop(0, '#F1F5F9'); g.addColorStop(1, '#E2E8F0')
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h)
      text(ctx, L('No photo'), x + w / 2, y + h / 2 + 8, { size: 22, color: C.faint, align: 'center' })
    }
    ctx.restore()
  }

  function makeLoader(env) {
    const cache = {}
    return src => {
      if (!src) return Promise.resolve(null)
      if (!cache[src]) cache[src] = env.loadImage(src).catch(() => null)
      return cache[src]
    }
  }

  // ---------- PDF ----------
  const W = 1240, H = 1754, M = 72, FOOT = 90

  async function buildPdf(products, env, onProgress, opts) {
    opts = opts || {}
    const sum = summarize(products)
    const sections = opts.sections || sum.markets.map(m => ({
      name: marketName(m.name), sub: LP(m.products.length, 'product') + ' · ' + LP(m.shops.length, 'shop'), products: m.products
    }))
    const load = makeLoader(env)
    const canvas = env.canvas
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')
    const date = stamp(sum.generatedAt)

    // Flow of blocks; each has a height and a draw(y) function
    const blocks = []
    const add = (h, draw, keepNext) => blocks.push({ h, draw, keepNext })

    if (!opts.sections) {
    add(70, y => text(ctx, L('Markets overview'), M, y + 50, { size: 34, weight: 'bold' }), true)
    add(60, y => {
      ctx.fillStyle = C.mint; rr(ctx, M, y, W - 2 * M, 52, 12); ctx.fill()
      const cols = [M + 24, M + 560, M + 700, M + 850]
      ;['Market', 'Shops', 'Products', 'Value at MOQ'].map(L).forEach((h, i) => text(ctx, h, cols[i], y + 34, { size: 22, weight: 'bold', color: C.brand }))
    }, true)
    const maxP = Math.max.apply(null, sum.markets.map(m => m.products.length).concat(1))
    sum.markets.forEach(m => add(72, y => {
      const cols = [M + 24, M + 560, M + 700, M + 850]
      text(ctx, marketName(m.name), cols[0], y + 34, { size: 26, weight: '600', max: 500, color: m.name === NO_MARKET ? C.faint : C.ink })
      ctx.fillStyle = C.line; rr(ctx, cols[0], y + 48, 480, 8, 4); ctx.fill()
      ctx.fillStyle = C.brand2; rr(ctx, cols[0], y + 48, Math.max(8, 480 * m.products.length / maxP), 8, 4); ctx.fill()
      text(ctx, int(m.shops.length), cols[1], y + 42, { size: 26 })
      text(ctx, int(m.products.length), cols[2], y + 42, { size: 26 })
      text(ctx, totalsText(m.totals), cols[3], y + 42, { size: 24, weight: '600', max: W - M - cols[3] - 10 })
      ctx.fillStyle = C.line; ctx.fillRect(M, y + 71, W - 2 * M, 1)
    }))
    add(40, () => {})
    }
    add(70, y => text(ctx, opts.sectionsTitle || L('Products'), M, y + 50, { size: 34, weight: 'bold' }), true)

    sections.forEach(m => {
      add(80, y => {
        const g = ctx.createLinearGradient(M, 0, W - M, 0)
        g.addColorStop(0, C.brand); g.addColorStop(1, C.brandDark)
        ctx.fillStyle = g; rr(ctx, M, y + 8, W - 2 * M, 60, 16); ctx.fill()
        const sw = text(ctx, m.sub, W - M - 26, y + 48, { size: 22, color: C.mint2, align: 'right' })
        text(ctx, m.name, M + 26, y + 48, { size: 26, weight: 'bold', color: C.white, max: W - 2 * M - sw - 70 })
      }, true)
      m.products.forEach(p => add(232, async y => {
        const x0 = M, w = W - 2 * M, h = 216
        ctx.save(); ctx.shadowColor = 'rgba(15,23,42,0.08)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4
        ctx.fillStyle = C.white; rr(ctx, x0, y, w, h, 22); ctx.fill(); ctx.restore()
        ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; rr(ctx, x0, y, w, h, 22); ctx.stroke()

        cover(ctx, await load((p.images || [])[0]), x0 + 18, y + 18, 180, 180, 16)
        if ((p.images || []).length > 1) pill(ctx, L('{n} photos', { n: p.images.length }), x0 + 28, y + 160, { bg: 'rgba(15,23,42,0.6)', color: C.white, size: 18 })

        const tx = x0 + 224, rightW = 270, tw = w - 224 - rightW - 20
        text(ctx, p.name, tx, y + 52, { size: 32, weight: 'bold', max: tw })
        let px = tx
        px += pill(ctx, L('MOQ {n} {unit}', { n: int(p.minOrder), unit: L(p.unit) }), px, y + 68, { bg: C.mint2, color: C.brand }) + 10
        if (p.size) pill(ctx, L('Size {x}', { x: fit(ctx, p.size, tw - (px - tx) - 90) }), px, y + 68, { bg: '#F1F5F9', color: '#475569' })

        const line = (label, value, ly, color) => {
          const lw = text(ctx, label, tx, ly, { size: 22, weight: 'bold', color: C.brand })
          text(ctx, value, tx + lw + 14, ly, { size: 22, color: color || C.ink, max: tw - lw - 14 })
        }
        line(L('Shop'), p.shopName + (p.shopWechat === 'yes' && p.wechatId ? '  ·  WeChat: ' + p.wechatId : ''), y + 150)
        const loc = p.location ? [p.location.name, p.location.address].filter(Boolean).join(' · ') : L('No location')
        line(L('Location'), loc, y + 176, p.location ? C.sub : C.faint)
        const reg = registeredAt(p)
        line(L('Registered'), reg ? dateTimeLabel(reg) : '—', y + 202, C.sub)

        const rx = x0 + w - 28
        ctx.fillStyle = C.line; ctx.fillRect(x0 + w - rightW - 10, y + 24, 1.5, h - 48)
        if (m.best && m.best.indexOf(p) >= 0) pill(ctx, L('Best price'), x0 + w - rightW + 10, y + 16, { bg: '#DCFCE7', color: '#15803D', size: 18, weight: 'bold' })
        text(ctx, p.currency + money(p.price), rx, y + 76, { size: 40, weight: 'bold', color: C.price, align: 'right' })
        text(ctx, L('per {unit}', { unit: L(p.unit) }), rx, y + 104, { size: 22, color: C.faint, align: 'right' })
        text(ctx, L('Value at MOQ'), rx, y + 158, { size: 20, color: C.sub, align: 'right' })
        text(ctx, p.currency + money(p.price * p.minOrder), rx, y + 192, { size: 28, weight: 'bold', align: 'right' })
      }))
    })

    // Paginate
    const pages = [[]]
    const top1 = 640, topN = 170, limit = H - FOOT
    let y = top1
    blocks.forEach((b, i) => {
      let need = b.h
      if (b.keepNext && blocks[i + 1]) need += blocks[i + 1].h
      if (y + need > limit && pages[pages.length - 1].length) { pages.push([]); y = topN }
      pages[pages.length - 1].push({ b, y })
      y += b.h
    })

    const jpegs = []
    for (let pi = 0; pi < pages.length; pi++) {
      ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H)
      if (pi === 0) drawCover(ctx, sum, date, opts)
      else drawRunningHeader(ctx, date)
      for (const it of pages[pi]) await it.b.draw(it.y)
      // footer
      ctx.fillStyle = C.line; ctx.fillRect(M, H - 70, W - 2 * M, 1.5)
      text(ctx, L('Generated {date} · Trade', { date }), M, H - 34, { size: 20, color: C.faint })
      text(ctx, L('Page {a} of {b}', { a: pi + 1, b: pages.length }), W - M, H - 34, { size: 20, color: C.faint, align: 'right' })
      jpegs.push(await env.toJpeg(canvas, 0.86))
      if (onProgress) onProgress((pi + 1) / pages.length)
    }
    const base = fileBase(opts, sum)
    return { bytes: Pdf.fromJpegs(jpegs, base.replace(/-/g, ' ')), pages: pages.length, fileName: base + '.pdf' }
  }

  function fileBase(opts, sum) {
    return (opts.fileTag ? 'Report-' + opts.fileTag : 'Sourcing-Report-' + ymd(sum.generatedAt)).replace(/[^\w.-]+/g, '-')
  }

  function drawCover(ctx, sum, date, opts) {
    opts = opts || {}
    const g = ctx.createLinearGradient(0, 0, W, 420)
    g.addColorStop(0, C.brand); g.addColorStop(1, C.brandDark)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 420)
    // soft decorative circles
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.beginPath(); ctx.arc(W - 120, 60, 220, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(W - 330, 380, 120, 0, Math.PI * 2); ctx.fill()

    text(ctx, (opts.kicker || L('Sourcing report')).toUpperCase(), M, 120, { size: 24, weight: 'bold', color: C.mint2 })
    text(ctx, opts.title || L('Products & Shops'), M, 200, { size: 68, weight: 'bold', color: C.white, max: W - 2 * M })
    text(ctx, L('Generated {date}', { date }), M, 252, { size: 26, color: 'rgba(255,255,255,0.8)' })

    const kpis = [[L('Products'), sum.count], [L('Markets'), sum.marketCount], [L('Shops'), sum.shopCount], [L('Photos'), sum.photoCount]]
    const gap = 24, cw = (W - 2 * M - gap * 3) / 4, ky = 330
    kpis.forEach((k, i) => {
      const x = M + i * (cw + gap)
      ctx.save(); ctx.shadowColor = 'rgba(15,23,42,0.12)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8
      ctx.fillStyle = C.white; rr(ctx, x, ky, cw, 160, 24); ctx.fill(); ctx.restore()
      ctx.fillStyle = C.brand2; rr(ctx, x + 24, ky + 26, 40, 6, 3); ctx.fill()
      text(ctx, k[0], x + 24, ky + 72, { size: 24, color: C.sub, weight: '600' })
      text(ctx, int(k[1]), x + 24, ky + 134, { size: 52, weight: 'bold' })
    })

    text(ctx, L('Total value at minimum order'), M, 560, { size: 24, color: C.sub, weight: '600' })
    let x = M
    if (!sum.totals.length) text(ctx, '—', x, 606, { size: 30, weight: 'bold' })
    sum.totals.forEach(t => {
      x += pill(ctx, t.currency + ' ' + money(t.value), x, 576, { bg: C.mint, color: C.brand, size: 28, weight: 'bold' }) + 14
    })
  }

  function drawRunningHeader(ctx, date) {
    ctx.fillStyle = C.brand; ctx.fillRect(0, 0, W, 10)
    text(ctx, L('Products & Shops — Sourcing Report'), M, 92, { size: 26, weight: 'bold', color: C.brand })
    text(ctx, date, W - M, 92, { size: 22, color: C.faint, align: 'right' })
    ctx.fillStyle = C.line; ctx.fillRect(M, 120, W - 2 * M, 1.5)
  }

  // ---------- Excel ----------
  const THUMB = 152

  async function thumbnail(env, load, src) {
    const img = await load(src)
    if (!img) return null
    const canvas = env.canvas
    canvas.width = THUMB; canvas.height = THUMB
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, THUMB, THUMB)
    cover(ctx, img, 0, 0, THUMB, THUMB, 0)
    return env.toJpeg(canvas, 0.85)
  }

  // Mix a hex colour with white (k = 0 → colour, 1 → white)
  function tint(hex, k) {
    const h = String(hex || '#0F766E').replace('#', '')
    return [0, 2, 4].map(i => {
      const v = Math.round(parseInt(h.substr(i, 2), 16) * (1 - k) + 255 * k)
      return (v < 16 ? '0' : '') + v.toString(16)
    }).join('').toUpperCase()
  }
  const hex6 = c => String(c || '').replace('#', '').toUpperCase()
  const curFmt = c => '"' + String(c).replace(/"/g, '') + '"#,##0.00'

  // opts.colors = { brand, brandDark } (the app theme); defaults to Jade
  async function buildExcel(products, env, onProgress, opts) {
    opts = opts || {}
    const sum = summarize(products)
    const load = makeLoader(env)
    const date = stamp(sum.generatedAt)
    const heading = opts.title ? opts.title + ' — ' + (opts.kicker || L('Sourcing report')) : L('Products & Shops — Sourcing Report')
    const col = opts.colors || {}
    const K = {
      brand: hex6(col.brand || C.brand), dark: hex6(col.brandDark || C.brandDark),
      tint: tint(col.brand || C.brand, 0.93), tint2: tint(col.brand || C.brand, 0.82), soft: tint(col.brand || C.brand, 0.6),
      ink: '0F172A', sub: '64748B', faint: '94A3B8', line: 'E2E8F0', zebra: 'F8FAFC', white: 'FFFFFF', price: 'E11D48', green: '16A34A', greenBg: 'DCFCE7'
    }
    const ST = Xlsx.Styles(), st = ST.style
    const fill = (f, extra) => Object.assign({ fill: f }, extra || {})

    // shared looks
    const banner = st({ fill: K.dark, font: { b: true, sz: 20, color: K.white }, align: { indent: 1 } })
    const bannerSub = st({ fill: K.dark, font: { sz: 11, color: K.soft }, align: { indent: 1 } })
    const strip = st({ fill: K.brand })
    const kpiLabel = st({ fill: K.tint, font: { b: true, sz: 9, color: K.sub }, align: { indent: 1, v: 'bottom' }, border: { top: 'medium:' + K.brand } })
    const kpiValue = st({ fill: K.tint, font: { b: true, sz: 18, color: K.dark }, align: { indent: 1, h: 'left' }, num: '#,##0' })
    const kpiText = st({ fill: K.tint, font: { b: true, sz: 14, color: K.dark }, align: { indent: 1, h: 'left', wrap: true } })
    const header = st({ fill: K.brand, font: { b: true, color: K.white }, align: { h: 'center', wrap: true }, border: { bottom: 'medium:' + K.dark } })
    const headerL = st({ fill: K.brand, font: { b: true, color: K.white }, align: { indent: 1, wrap: true }, border: { bottom: 'medium:' + K.dark } })
    const section = st({ font: { b: true, sz: 13, color: K.dark }, align: { v: 'bottom' }, border: { bottom: 'medium:' + K.brand } })
    const blank = st({})
    const z = (i, o) => st(Object.assign({ fill: i % 2 ? K.zebra : K.white, border: { bottom: 'thin:' + K.line } }, o))

    // ===== Products sheet =====
    const grouped = !!(opts.sections && opts.sections.length)
    const head = ['Product', 'Picture', 'Size', 'Minimum order', 'Price', 'Value at MOQ', 'Market', 'Shop', 'WeChat', 'Date registered'].map(L)
    const NC = head.length, last = Xlsx.colName(NC - 1)
    const rows = [], merges = [], images = []
    const fullRow = (style, v, height) => {
      const cells = [{ v, s: style }]
      for (let i = 1; i < NC; i++) cells.push({ v: '', s: style })
      rows.push({ height, cells }); merges.push('A' + rows.length + ':' + last + rows.length)
    }
    const list = grouped ? [].concat.apply([], opts.sections.map(sec => sec.products)) : sum.products.slice().sort((a, b) => registeredAt(b) - registeredAt(a))
    fullRow(banner, opts.title ? opts.title : L('Products & Shops'), 40)
    fullRow(bannerSub, (opts.kicker || L('Sourcing report')) + '   ·   ' + LP(list.length, 'product') + '   ·   ' + L('Generated {date}', { date }), 22)
    fullRow(strip, '', 5)
    rows.push({ height: 8, cells: [] })
    // KPI cards: [label, value, from col, to col]
    const totalsStr = sum.totals.length ? sum.totals.map(t => t.currency + ' ' + money(t.value)).join('   ') : '—'
    const cards = [[L('PRODUCTS'), sum.count, 0, 0], [L('MARKETS'), sum.marketCount, 1, 2], [L('SHOPS'), sum.shopCount, 3, 4], [L('TOTAL VALUE AT MOQ'), totalsStr, 5, NC - 1]]
    const lab = [], val = []
    cards.forEach(c => {
      for (let i = c[2]; i <= c[3]; i++) { lab[i] = { v: i === c[2] ? c[0] : '', s: kpiLabel }; val[i] = { v: i === c[2] ? c[1] : '', s: typeof c[1] === 'number' ? kpiValue : kpiText } }
      if (c[3] > c[2]) { merges.push(Xlsx.colName(c[2]) + (rows.length + 1) + ':' + Xlsx.colName(c[3]) + (rows.length + 1)); merges.push(Xlsx.colName(c[2]) + (rows.length + 2) + ':' + Xlsx.colName(c[3]) + (rows.length + 2)) }
    })
    rows.push({ height: 20, cells: lab }); rows.push({ height: 34, cells: val })
    rows.push({ height: 12, cells: [] })
    const HEAD = rows.length // 0-based index of the header row
    rows.push({ height: 32, cells: head.map((v, i) => ({ v, s: i === 0 || i >= 6 ? headerL : header })) })

    const unitFmt = {}
    const sName = i => z(i, { font: { b: true, sz: 12, color: K.ink }, align: { indent: 1, wrap: true } })
    const sCenter = i => z(i, { font: { color: K.ink }, align: { h: 'center', wrap: true } })
    const sMuted = i => z(i, { font: { color: K.faint, i: true }, align: { h: 'center' } })
    const sText = i => z(i, { font: { color: K.ink }, align: { indent: 1, wrap: true } })
    const sWx = i => z(i, { font: { b: true, color: K.green }, align: { indent: 1, wrap: true } })
    const dateFmt = I18n.getLang() === 'zh' ? 'yyyy"年"m"月"d"日" hh:mm' : I18n.getLang() === 'so' ? 'dd/mm/yyyy hh:mm' : 'dd mmm yyyy, hh:mm'
    const sDate = i => z(i, { font: { color: K.sub }, align: { h: 'center' }, num: dateFmt })
    const sMoq = (i, unit) => z(i, { font: { b: true, color: K.brand }, align: { h: 'center' }, num: unitFmt[unit] || (unitFmt[unit] = '#,##0" ' + String(L(unit)).replace(/"/g, '') + '"') })
    const sPrice = (i, cur, best) => z(i, best ? { fill: K.greenBg, font: { b: true, sz: 12, color: K.green }, align: { h: 'right', indent: 1 }, num: curFmt(cur) } : { font: { b: true, sz: 12, color: K.price }, align: { h: 'right', indent: 1 }, num: curFmt(cur) })
    const sValue = (i, cur) => z(i, { font: { b: true, color: K.ink }, align: { h: 'right', indent: 1 }, num: curFmt(cur) })
    const band = st({ fill: K.tint2, font: { b: true, sz: 12, color: K.dark }, align: { indent: 1 }, border: { top: 'thin:' + K.soft, bottom: 'thin:' + K.soft } })
    const bandR = st({ fill: K.tint2, font: { color: K.dark }, align: { h: 'right', indent: 1 }, border: { top: 'thin:' + K.soft, bottom: 'thin:' + K.soft } })

    const bestSet = new Set()
    ;(opts.sections || []).forEach(sec => (sec.best || []).forEach(p => bestSet.add(p)))
    const firstData = rows.length
    let done = 0, zi = 0
    const addProduct = async p => {
      const r = rows.length, i = zi++
      const jpg = await thumbnail(env, load, (p.images || [])[0])
      if (jpg) images.push({ row: r, col: 1, data: jpg, w: 78, h: 78, dx: 12, dy: 6, border: K.line })
      const reg = registeredAt(p), price = Number(p.price) || 0, moq = Number(p.minOrder) || 0
      rows.push({ height: 68, cells: [
        { v: p.name, s: sName(i) },
        { v: jpg ? '' : L('No photo'), s: sMuted(i) },
        { v: p.size || '—', s: sCenter(i) },
        { v: moq, s: sMoq(i, p.unit) },
        { v: price, s: sPrice(i, p.currency, bestSet.has(p)) },
        { f: 'D' + (r + 1) + '*E' + (r + 1), v: Math.round(price * moq * 100) / 100, s: sValue(i, p.currency) },
        { v: p.marketName || '—', s: sText(i) },
        { v: p.shopName + (p.shopNote ? '\n' + p.shopNote : ''), s: sText(i) },
        { v: p.shopWechat === 'yes' ? (p.wechatId || L('Yes')) : p.shopWechat === 'no' ? L('No WeChat') : '—', s: p.shopWechat === 'yes' ? sWx(i) : sCenter(i) },
        reg ? { v: excelDate(reg), s: sDate(i) } : { v: '—', s: sCenter(i) }
      ] })
      if (onProgress) onProgress(++done / list.length)
    }
    if (grouped) {
      for (const sec of opts.sections) {
        const cells = [{ v: sec.name, s: band }]
        for (let i = 1; i < NC; i++) cells.push({ v: i === NC - 1 ? sec.sub || '' : '', s: i === NC - 1 ? bandR : band })
        rows.push({ height: 26, cells }); merges.push('A' + rows.length + ':' + Xlsx.colName(NC - 2) + rows.length)
        zi = 0
        for (const p of sec.products) await addProduct(p)
      }
    } else {
      for (const p of list) await addProduct(p)
    }
    const lastData = rows.length
    // Totals per currency
    rows.push({ height: 8, cells: [] })
    const tLab = st({ fill: K.dark, font: { b: true, color: K.soft }, align: { h: 'right', indent: 1 } })
    totalsOf(list).forEach(t => {
      const tVal = st({ fill: K.dark, font: { b: true, sz: 13, color: K.white }, align: { h: 'right', indent: 1 }, num: curFmt(t.currency) })
      const cells = []
      for (let i = 0; i < NC; i++) cells.push({ v: i === 0 ? L('Total value at minimum order ({c})', { c: t.currency }) : '', s: i === 5 ? tVal : tLab })
      cells[5].v = Math.round(t.value * 100) / 100
      rows.push({ height: 28, cells }); merges.push('A' + rows.length + ':E' + rows.length)
    })

    const productsSheet = {
      name: L('Products'), selected: true, tabColor: K.brand, gridLines: false,
      cols: [30, 14, 14, 15, 14, 16, 26, 24, 18, 19], rows, merges, images,
      freezeRow: HEAD + 1, printTitleRows: [HEAD + 1, HEAD + 1],
      autoFilter: grouped ? null : 'A' + (HEAD + 1) + ':' + last + Math.max(HEAD + 2, lastData),
      footer: '&L&8Trade · ' + heading.replace(/&/g, '&&') + '&R&8' + L('Page {a} of {b}', { a: '&P', b: '&N' })
    }
    if (!list.length) productsSheet.autoFilter = null
    void firstData

    // ===== Summary sheet =====
    const srows = [], smerges = [], SC = 6, slast = Xlsx.colName(SC - 1)
    const sFull = (style, v, height) => {
      const cells = []
      for (let i = 0; i < SC; i++) cells.push({ v: i === 1 ? v : '', s: style })
      srows.push({ height, cells }); smerges.push('B' + srows.length + ':' + slast + srows.length)
    }
    sFull(banner, opts.title ? L('{title} — Summary', { title: opts.title }) : L('Summary'), 40)
    sFull(bannerSub, (opts.kicker || L('Sourcing report')) + '   ·   ' + L('Generated {date}', { date }), 22)
    sFull(strip, '', 5)
    srows.push({ height: 10, cells: [] })
    const scards = [[L('PRODUCTS'), sum.count], [L('MARKETS'), sum.marketCount], [L('SHOPS'), sum.shopCount], [L('PHOTOS'), sum.photoCount], [L('WITH LOCATION'), sum.located]]
    srows.push({ height: 20, cells: [null].concat(scards.map(c => ({ v: c[0], s: kpiLabel }))) })
    srows.push({ height: 36, cells: [null].concat(scards.map(c => ({ v: c[1], s: kpiValue }))) })
    srows.push({ height: 14, cells: [] })
    const sec = t => { srows.push({ height: 28, cells: [null].concat([L(t), '', '', '', ''].map(v => ({ v, s: section }))) }); srows.push({ height: 6, cells: [] }) }

    sec('Total value at minimum order')
    if (!sum.totals.length) srows.push({ height: 22, cells: [null, { v: L('No products yet'), s: st({ font: { i: true, color: K.faint } }) }] })
    sum.totals.forEach((t, i) => {
      srows.push({ height: 30, cells: [null,
        { v: t.currency === '¥' ? L('Chinese yuan (¥)') : t.currency === '$' ? L('US dollar ($)') : t.currency, s: z(i, { font: { b: true, color: K.ink }, align: { indent: 1 } }) },
        { v: Math.round(t.value * 100) / 100, s: z(i, { font: { b: true, sz: 14, color: K.price }, align: { h: 'left', indent: 1 }, num: curFmt(t.currency) }) },
        { v: '', s: z(i) }, { v: '', s: z(i) }, { v: '', s: z(i) }] })
      smerges.push('C' + srows.length + ':' + slast + srows.length)
    })
    srows.push({ height: 14, cells: [] })

    sec('By market')
    srows.push({ height: 26, cells: [null].concat(['Market', 'Shops', 'Products', 'Share of products', 'Value at MOQ'].map(L).map((v, i) => ({ v, s: i === 0 || i >= 3 ? headerL : header }))) })
    const maxP = Math.max.apply(null, sum.markets.map(m => m.products.length).concat(1))
    sum.markets.forEach((m, i) => {
      const n = Math.max(1, Math.round(m.products.length / maxP * 12))
      srows.push({ height: 22, cells: [null,
        { v: marketName(m.name), s: z(i, { font: { b: true, color: m.name === NO_MARKET ? K.faint : K.ink }, align: { indent: 1 } }) },
        { v: m.shops.length, s: z(i, { align: { h: 'center' }, num: '#,##0' }) },
        { v: m.products.length, s: z(i, { font: { b: true, color: K.brand }, align: { h: 'center' }, num: '#,##0' }) },
        { v: new Array(n + 1).join('█') + ' ' + Math.round(m.products.length / Math.max(1, sum.count) * 100) + '%', s: z(i, { font: { color: K.brand, sz: 10 }, align: { indent: 1 } }) },
        { v: totalsText(m.totals), s: z(i, { font: { b: true, color: K.ink }, align: { indent: 1 } }) }] })
    })
    srows.push({ height: 14, cells: [] })

    sec('By shop')
    srows.push({ height: 26, cells: [null].concat(['Market', 'Shop', 'Products', 'Location', 'Address'].map(L).map((v, i) => ({ v, s: i === 2 ? header : headerL }))) })
    let si = 0
    sum.markets.forEach(m => m.shops.forEach(sh => {
      const i = si++
      srows.push({ height: 22, cells: [null,
        { v: marketName(m.name), s: z(i, { font: { color: K.sub }, align: { indent: 1 } }) },
        { v: sh.name, s: z(i, { font: { b: true, color: K.ink }, align: { indent: 1, wrap: true } }) },
        { v: sh.products.length, s: z(i, { align: { h: 'center' }, num: '#,##0' }) },
        { v: sh.location ? sh.location.name : '—', s: z(i, { font: { color: sh.location ? K.ink : K.faint }, align: { indent: 1, wrap: true } }) },
        { v: sh.location ? sh.location.address : '', s: z(i, { font: { color: K.sub, sz: 10 }, align: { indent: 1, wrap: true } }) }] })
    }))
    void blank; void fill

    const summary = { name: L('Summary'), tabColor: K.dark, gridLines: false, portrait: true, cols: [2.5, 32, 22, 12, 30, 34], rows: srows, merges: smerges, footer: '&L&8Trade · ' + heading.replace(/&/g, '&&') + '&R&8' + L('Page {a} of {b}', { a: '&P', b: '&N' }) }

    return {
      bytes: Xlsx.build([productsSheet, summary], { title: heading }, ST),
      fileName: fileBase(opts, sum) + '.xlsx'
    }
  }

  return { summarize, buildPdf, buildExcel, money, int, ymd, stamp, totalsText, totalsOf, registeredAt, dateLabel, dateTimeLabel, monthShort, periodKey, periodLabel, byPeriod, NO_MARKET }
})
