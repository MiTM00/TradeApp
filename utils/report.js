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
    brand: '#DC2626', brand2: '#F87171', brandDark: '#991B1B', mint: '#FEF2F2', mint2: '#FEE2E2',
    price: '#E11D48', white: '#FFFFFF', amber: '#F59E0B'
  }
  const hex6 = c => String(c || '').replace('#', '').toUpperCase()
  const C_DEFAULT = Object.assign({}, C)
  // The PDF follows the app theme (opts.colors = { brand, brandDark }); without it: the default red
  function usePalette(col) {
    Object.assign(C, C_DEFAULT)
    if (col && /^#?[0-9a-f]{6}$/i.test(col.brand || '')) {
      const b = '#' + hex6(col.brand)
      Object.assign(C, { brand: b, brandDark: '#' + hex6(col.brandDark || col.brand), brand2: '#' + tint(b, 0.35), mint: '#' + tint(b, 0.94), mint2: '#' + tint(b, 0.85) })
    }
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
      const shops = new Set(list.filter(p => String(p.shopName || '').trim()).map(p => (p.marketName || '') + '|' + p.shopName))
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
      const sk = String(p.shopName || '').trim()
      if (sk) {
        if (!m.shops.has(sk)) m.shops.set(sk, { name: sk, location: p.location, products: [] })
        m.shops.get(sk).products.push(p)
      }
      m.products.push(p)
      const n = (p.images || []).length
      m.photos += n; photos += n
      if (p.location) located++
      if (String(p.shopName || '').trim()) shops.add(mName + '|' + String(p.shopName).trim())
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
    usePalette(opts.colors)
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
      m.products.forEach(p => add(CARD_H + 18, y => drawProductCard(ctx, load, p, y, m.best && m.best.indexOf(p) >= 0)))
    })

    // Photo gallery: every photo of every product, large, so the report always carries the pictures
    const withPhotos = (opts.sections ? [].concat.apply([], sections.map(sec => sec.products)) : sum.products).filter(p => (p.images || []).length)
    if (withPhotos.length) {
      add(30, () => {})
      add(70, y => {
        text(ctx, L('Photo gallery'), M, y + 50, { size: 34, weight: 'bold' })
        text(ctx, L('{n} photos', { n: withPhotos.reduce((a, p) => a + p.images.length, 0) }), W - M, y + 50, { size: 22, color: C.faint, align: 'right' })
      }, true)
      const GAP = 22, TW = (W - 2 * M - 2 * GAP) / 3
      withPhotos.forEach(p => {
        add(62, y => {
          ctx.fillStyle = C.brand; rr(ctx, M, y + 14, 6, 34, 3); ctx.fill()
          const sub = [p.marketName, p.shopName].filter(Boolean).join(' · ')
          const sw = sub ? text(ctx, sub, W - M, y + 40, { size: 20, color: C.sub, align: 'right', max: 420 }) : 0
          text(ctx, p.name || '—', M + 20, y + 41, { size: 26, weight: 'bold', max: W - 2 * M - sw - 50 })
        }, true)
        const imgs = p.images
        for (let r = 0; r < imgs.length; r += 3) {
          const row = imgs.slice(r, r + 3)
          add(TW + GAP, async y => {
            for (let i = 0; i < row.length; i++) {
              const x = M + i * (TW + GAP)
              ctx.save(); ctx.shadowColor = 'rgba(15,23,42,0.10)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4
              ctx.fillStyle = C.white; rr(ctx, x, y, TW, TW, 20); ctx.fill(); ctx.restore()
              contain(ctx, await load(row[i]), x + 8, y + 8, TW - 16, TW - 16, 14)
              if (imgs.length > 1) pill(ctx, (r + i + 1) + ' / ' + imgs.length, x + 18, y + TW - 52, { bg: 'rgba(15,23,42,0.62)', color: C.white, size: 17, weight: 'bold' })
            }
          })
        }
      })
    }

    // Paginate
    const pages = [[]]
    const mosaic = [].concat.apply([], (opts.sections ? [].concat.apply([], sections.map(sec => sec.products)) : sum.products).map(p => (p.images || []).slice(0, 1))).slice(0, 6)
    const top1 = mosaic.length ? MOSAIC_Y + MOSAIC_H + 36 : 640, topN = 170, limit = H - FOOT
    let y = top1
    blocks.forEach((b, i) => {
      let need = b.h
      for (let j = i; blocks[j] && blocks[j].keepNext && blocks[j + 1]; j++) need += blocks[j + 1].h // a heading stays with what follows it
      if (y + need > limit && pages[pages.length - 1].length) { pages.push([]); y = topN }
      pages[pages.length - 1].push({ b, y })
      y += b.h
    })

    const jpegs = []
    for (let pi = 0; pi < pages.length; pi++) {
      ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H)
      if (pi === 0) { drawCover(ctx, sum, date, opts); if (mosaic.length) await drawMosaic(ctx, load, mosaic) }
      else drawRunningHeader(ctx, date)
      for (const it of pages[pi]) await it.b.draw(it.y)
      // footer
      ctx.fillStyle = C.line; ctx.fillRect(M, H - 70, W - 2 * M, 1.5)
      ctx.fillStyle = C.brand; ctx.fillRect(M, H - 71, 90, 3.5)
      text(ctx, L('Generated {date} · Trade', { date }), M, H - 34, { size: 20, color: C.faint })
      text(ctx, L('Page {a} of {b}', { a: pi + 1, b: pages.length }), W - M, H - 34, { size: 20, color: C.faint, align: 'right' })
      jpegs.push(await env.toJpeg(canvas, 0.86))
      if (onProgress) onProgress((pi + 1) / pages.length)
    }
    const base = fileBase(opts, sum)
    return { bytes: Pdf.fromJpegs(jpegs, base.replace(/-/g, ' ')), pages: pages.length, fileName: base + '.pdf' }
  }

  // One product: big photo + the other photos beside it, the details, and the price panel
  const CARD_H = 318
  async function drawProductCard(ctx, load, p, y, best) {
    const x0 = M, w = W - 2 * M, h = CARD_H, imgs = p.images || []
    ctx.save(); ctx.shadowColor = 'rgba(15,23,42,0.09)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6
    ctx.fillStyle = C.white; rr(ctx, x0, y, w, h, 26); ctx.fill(); ctx.restore()
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.2; rr(ctx, x0, y, w, h, 26); ctx.stroke()

    // photos
    const P = h - 36, px0 = x0 + 18, py = y + 18
    cover(ctx, await load(imgs[0]), px0, py, P, P, 18)
    let tx = px0 + P + 24
    if (imgs.length > 1) {
      const TG = 10, TS = (P - 2 * TG) / 3, tx0 = px0 + P + 12
      for (let i = 1; i < Math.min(4, imgs.length); i++) {
        const ty = py + (i - 1) * (TS + TG)
        cover(ctx, await load(imgs[i]), tx0, ty, TS, TS, 12)
        if (i === 3 && imgs.length > 4) {
          ctx.fillStyle = 'rgba(15,23,42,0.55)'; rr(ctx, tx0, ty, TS, TS, 12); ctx.fill()
          text(ctx, '+' + (imgs.length - 4), tx0 + TS / 2, ty + TS / 2 + 12, { size: 32, weight: 'bold', color: C.white, align: 'center' })
        }
      }
      tx = tx0 + TS + 24
    }
    if (imgs.length > 1) pill(ctx, L('{n} photos', { n: imgs.length }), px0 + 12, py + P - 46, { bg: 'rgba(15,23,42,0.6)', color: C.white, size: 16, weight: 'bold' })

    // details
    const PW = 252, panelX = x0 + w - PW - 18, tw = panelX - tx - 20
    text(ctx, p.name || '—', tx, y + 62, { size: 34, weight: 'bold', max: tw })
    let ly = y + 84
    if (p.description) { text(ctx, String(p.description).replace(/\s+/g, ' '), tx, ly + 14, { size: 20, color: C.sub, max: tw }); ly += 26 }
    font(ctx, 19, 'bold')
    let px = tx
    px += pill(ctx, L('MOQ {n} {unit}', { n: int(p.minOrder), unit: L(p.unit) }), px, ly + 4, { bg: C.mint2, color: C.brand, size: 19, weight: 'bold' }) + 10
    if (p.size) { font(ctx, 19); pill(ctx, fit(ctx, L('Size {x}', { x: p.size }), Math.max(60, tw - (px - tx) - 30)), px, ly + 4, { bg: '#F1F5F9', color: '#475569', size: 19 }) }
    const line = (label, value, yy, color) => {
      ctx.fillStyle = C.brand2; ctx.beginPath(); ctx.arc(tx + 5, yy - 7, 5, 0, Math.PI * 2); ctx.fill()
      const lw = text(ctx, label, tx + 18, yy, { size: 20, weight: 'bold', color: C.sub })
      text(ctx, value, tx + 18 + lw + 12, yy, { size: 21, color: color || C.ink, max: tw - lw - 30 })
    }
    const loc = p.location ? [p.location.name, p.location.address].filter(Boolean).join(' · ') : L('No location')
    const reg = registeredAt(p)
    line(L('Shop'), (p.shopName || '—') + (p.shopWechat === 'yes' && p.wechatId ? '  ·  WeChat ' + p.wechatId : ''), y + h - 104)
    line(L('Location'), loc, y + h - 70, p.location ? C.ink : C.faint)
    line(L('Registered'), reg ? dateTimeLabel(reg) : '—', y + h - 36, C.sub)

    // price panel
    const g = ctx.createLinearGradient(panelX, y, panelX + PW, y + h)
    g.addColorStop(0, C.mint); g.addColorStop(1, C.mint2)
    ctx.fillStyle = g; rr(ctx, panelX, y + 18, PW, h - 36, 20); ctx.fill()
    const cx = panelX + PW / 2, dy = best ? 22 : 0
    if (best) { font(ctx, 17, 'bold'); const bw = ctx.measureText('★ ' + L('Best price')).width + 28; pill(ctx, '★ ' + L('Best price'), cx - bw / 2, y + 30, { bg: '#DCFCE7', color: '#15803D', size: 17, weight: 'bold' }) }
    text(ctx, L('Price'), cx, y + 86 + dy, { size: 19, color: C.sub, weight: '600', align: 'center' })
    text(ctx, (p.currency || '') + money(p.price), cx, y + 136 + dy, { size: 44, weight: 'bold', color: C.price, align: 'center', max: PW - 24 })
    text(ctx, L('per {unit}', { unit: L(p.unit) }), cx, y + 166 + dy, { size: 19, color: C.faint, align: 'center' })
    ctx.fillStyle = 'rgba(15,23,42,0.08)'; ctx.fillRect(panelX + 24, y + 196 + dy / 2, PW - 48, 1.5)
    text(ctx, L('Value at MOQ'), cx, y + 236, { size: 18, color: C.sub, align: 'center' })
    text(ctx, (p.currency || '') + money((Number(p.price) || 0) * (Number(p.minOrder) || 0)), cx, y + 272, { size: 28, weight: 'bold', align: 'center', max: PW - 24 })
  }

  // The whole photo inside the box (no cropping), on a soft background
  function contain(ctx, img, x, y, w, h, r) {
    ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip()
    ctx.fillStyle = '#F1F5F9'; ctx.fillRect(x, y, w, h)
    if (img) {
      const s = Math.min(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    } else text(ctx, L('No photo'), x + w / 2, y + h / 2 + 8, { size: 22, color: C.faint, align: 'center' })
    ctx.restore()
  }

  // Cover: a row of product photos under the numbers
  const MOSAIC_Y = 676, MOSAIC_H = 176
  async function drawMosaic(ctx, load, photos) {
    const n = photos.length, gap = 16, tw = Math.min(MOSAIC_H * 1.25, (W - 2 * M - gap * (n - 1)) / n)
    text(ctx, L('In this report'), M, MOSAIC_Y - 18, { size: 22, color: C.sub, weight: '600' })
    for (let i = 0; i < n; i++) {
      const x = M + i * (tw + gap)
      ctx.save(); ctx.shadowColor = 'rgba(15,23,42,0.14)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6
      ctx.fillStyle = C.white; rr(ctx, x, MOSAIC_Y, tw, MOSAIC_H, 20); ctx.fill(); ctx.restore()
      cover(ctx, await load(photos[i]), x, MOSAIC_Y, tw, MOSAIC_H, 20)
    }
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
  const amapLink = (loc, name) => 'https://uri.amap.com/marker?position=' + loc.longitude + ',' + loc.latitude + '&name=' + encodeURIComponent(String(name || loc.name || '').slice(0, 40)) + '&coordinate=gaode&callnative=1'
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
    const head = ['Product', 'Picture', 'Size', 'Minimum order', 'Price', 'Value at MOQ', 'Market', 'Shop', 'WeChat', 'Location', 'Date registered'].map(L)
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
    const cards = [[L('PRODUCTS'), sum.count, 0, 0], [L('MARKETS'), sum.marketCount, 1, 2], [L('SHOPS'), sum.shopCount, 3, 4], [L('TOTAL VALUE AT MOQ'), totalsStr, 5, NC - 3], [L('DUPLICATES'), (opts.duplicates || []).length, NC - 2, NC - 1]]
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
    const sLink = i => z(i, { font: { b: true, color: '2563EB' }, align: { indent: 1, wrap: true } })
    const sDup = i => z(i, { font: { b: true, sz: 12, color: 'B45309' }, align: { indent: 1, wrap: true } })
    const dupOf = new Map()
    ;(opts.duplicates || []).forEach((g, gi) => g.products.forEach(p => dupOf.set(p, gi + 1)))
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
        dupOf.has(p) ? { v: p.name + '\n' + L('Duplicate #{n}', { n: dupOf.get(p) }), s: sDup(i) } : { v: p.name, s: sName(i) },
        { v: jpg ? '' : L('No photo'), s: sMuted(i) },
        { v: p.size || '—', s: sCenter(i) },
        { v: moq, s: sMoq(i, p.unit) },
        { v: price, s: sPrice(i, p.currency, bestSet.has(p)) },
        { f: 'D' + (r + 1) + '*E' + (r + 1), v: Math.round(price * moq * 100) / 100, s: sValue(i, p.currency) },
        { v: p.marketName || '—', s: sText(i) },
        { v: (p.shopName || '—') + (p.shopNote ? '\n' + p.shopNote : ''), s: sText(i) },
        { v: p.shopWechat === 'yes' ? (p.wechatId || L('Yes')) : p.shopWechat === 'no' ? L('No WeChat') : '—', s: p.shopWechat === 'yes' ? sWx(i) : sCenter(i) },
        p.location ? { f: 'HYPERLINK("' + amapLink(p.location, p.shopName || p.name) + '","' + String(p.location.name || L('Open in Amap')).replace(/"/g, "'").slice(0, 80) + '")', v: String(p.location.name || L('Open in Amap')), s: sLink(i) } : { v: '—', s: sCenter(i) },
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
      cols: [30, 14, 14, 15, 14, 16, 24, 22, 16, 24, 19], rows, merges, images,
      conditional: lastData > firstData ? [
        { ref: 'D' + (firstData + 1) + ':D' + lastData, bar: K.soft },
        { ref: 'F' + (firstData + 1) + ':F' + lastData, bar: K.brand }
      ] : [],
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

    // ===== Duplicates sheet: each group side by side, every detail marked Same / Different =====
    async function duplicatesSheet() {
      const groups = opts.duplicates || []
      if (!groups.length) return []
      const maxN = Math.min(6, Math.max.apply(null, groups.map(g => g.products.length)))
      const DC = maxN + 2, dlast = Xlsx.colName(DC - 1)
      const drows = [], dmerges = [], dimages = []
      const dFull = (style, v, height) => {
        const cells = []
        for (let i = 0; i < DC; i++) cells.push({ v: i === 0 ? v : '', s: style })
        drows.push({ height, cells }); dmerges.push('A' + drows.length + ':' + dlast + drows.length)
      }
      dFull(banner, L('Duplicates'), 40)
      dFull(bannerSub, L('The same item registered more than once — compared side by side') + '   ·   ' + L('Generated {date}', { date }), 22)
      dFull(strip, '', 5)
      const same = st({ fill: K.greenBg, font: { b: true, color: K.green }, align: { h: 'center' } })
      const diff = st({ fill: 'FEF3C7', font: { b: true, color: 'B45309' }, align: { h: 'center' } })
      const lbl = st({ fill: K.tint, font: { b: true, color: K.dark }, align: { indent: 1 }, border: { bottom: 'thin:' + K.line } })
      const val = st({ font: { color: K.ink }, align: { indent: 1, wrap: true }, border: { bottom: 'thin:' + K.line } })
      const valD = st({ fill: 'FFFBEB', font: { b: true, color: K.ink }, align: { indent: 1, wrap: true }, border: { bottom: 'thin:' + K.line } })
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi], list = g.products.slice(0, maxN)
        drows.push({ height: 14, cells: [] })
        const cells = [{ v: '#' + (gi + 1) + '  ' + g.name, s: band }]
        for (let i = 1; i < DC; i++) cells.push({ v: i === DC - 1 ? L('{a} of {b} the same', { a: g.same, b: g.total }) : '', s: i === DC - 1 ? bandR : band })
        drows.push({ height: 28, cells }); dmerges.push('A' + drows.length + ':' + Xlsx.colName(DC - 2) + drows.length)
        drows.push({ height: 24, cells: [{ v: '', s: headerL }].concat(list.map((p, i) => ({ v: L('Registered') + ' ' + (i + 1) + (registeredAt(p) ? ' · ' + dateLabel(registeredAt(p)) : ''), s: header })), [{ v: L('Result'), s: header }]) })
        // photos
        const pr = drows.length
        drows.push({ height: 84, cells: [{ v: L('Photo'), s: lbl }].concat(list.map(() => ({ v: '', s: val })), [{ v: '', s: val }]) })
        for (let i = 0; i < list.length; i++) {
          const jpg = await thumbnail(env, load, (list[i].images || [])[0])
          if (jpg) dimages.push({ row: pr, col: i + 1, data: jpg, w: 100, h: 100, dx: 30, dy: 6, border: K.line })
        }
        g.rows.forEach(r => {
          if (r.key === 'photo') { drows[pr].cells[DC - 1] = { v: r.same ? '✓ ' + L('Same') : '≠ ' + L('Different'), s: r.same ? same : diff }; return }
          drows.push({ height: 26, cells: [{ v: L(r.label), s: lbl }].concat(r.values.slice(0, maxN).map(v => ({ v: v || '—', s: r.same ? val : valD })), [{ v: r.same ? '✓ ' + L('Same') : '≠ ' + L('Different'), s: r.same ? same : diff }]) })
        })
      }
      const cols = [20]; for (let i = 0; i < maxN; i++) cols.push(30); cols.push(16)
      return [{ name: L('Duplicates'), tabColor: 'F59E0B', gridLines: false, cols, rows: drows, merges: dmerges, images: dimages,
        footer: '&L&8Trade · ' + L('Duplicates') + '&R&8' + L('Page {a} of {b}', { a: '&P', b: '&N' }) }]
    }

    // Price range per currency
    srows.push({ height: 14, cells: [] })
    sec('Price range')
    srows.push({ height: 26, cells: [null].concat(['Currency', 'Lowest price', 'Average price', 'Highest price', 'Products'].map(L).map((v, i) => ({ v, s: i === 0 ? headerL : header }))) })
    const byCur = {}
    products.forEach(p => { const c = p.currency || '¥'; (byCur[c] = byCur[c] || []).push(Number(p.price) || 0) })
    Object.keys(byCur).forEach((c, i) => {
      const a = byCur[c], avg = a.reduce((x, y) => x + y, 0) / a.length
      srows.push({ height: 24, cells: [null,
        { v: c === '¥' ? L('Chinese yuan (¥)') : c === '$' ? L('US dollar ($)') : c, s: z(i, { font: { b: true, color: K.ink }, align: { indent: 1 } }) },
        { v: Math.min.apply(null, a), s: z(i, { font: { b: true, color: K.green }, align: { h: 'center' }, num: curFmt(c) }) },
        { v: Math.round(avg * 100) / 100, s: z(i, { font: { b: true, color: K.ink }, align: { h: 'center' }, num: curFmt(c) }) },
        { v: Math.max.apply(null, a), s: z(i, { font: { b: true, color: K.price }, align: { h: 'center' }, num: curFmt(c) }) },
        { v: a.length, s: z(i, { align: { h: 'center' }, num: '#,##0' }) }] })
    })

    const summary = { name: L('Summary'), tabColor: K.dark, gridLines: false, portrait: true, cols: [2.5, 32, 22, 12, 30, 34], rows: srows, merges: smerges, footer: '&L&8Trade · ' + heading.replace(/&/g, '&&') + '&R&8' + L('Page {a} of {b}', { a: '&P', b: '&N' }) }

    // ===== Photos sheet: every photo of every product (the Products sheet shows only the first) =====
    async function photosSheet() {
      const withP = list.filter(p => (p.images || []).length)
      if (!withP.length) return []
      const maxN = Math.min(10, Math.max.apply(null, withP.map(p => p.images.length)))
      const PC = maxN + 1, plast = Xlsx.colName(PC - 1)
      const prows = [], pmerges = [], pimages = []
      const pFull = (style, v, height) => {
        const cells = []
        for (let i = 0; i < PC; i++) cells.push({ v: i === 0 ? v : '', s: style })
        prows.push({ height, cells }); pmerges.push('A' + prows.length + ':' + plast + prows.length)
      }
      pFull(banner, L('Photo gallery'), 40)
      pFull(bannerSub, L('{n} photos', { n: withP.reduce((a, p) => a + p.images.length, 0) }) + '   ·   ' + L('Generated {date}', { date }), 22)
      pFull(strip, '', 5)
      prows.push({ height: 10, cells: [] })
      const nameS = i => z(i, { font: { b: true, sz: 12, color: K.ink }, align: { indent: 1, wrap: true, v: 'center' } })
      for (let i = 0; i < withP.length; i++) {
        const p = withP[i], r = prows.length
        const cells = [{ v: p.name + '\n' + [p.marketName, p.shopName].filter(Boolean).join(' · '), s: nameS(i) }]
        for (let c = 1; c < PC; c++) cells.push({ v: '', s: z(i) })
        prows.push({ height: 96, cells })
        for (let k = 0; k < Math.min(maxN, p.images.length); k++) {
          const jpg = await thumbnail(env, load, p.images[k])
          if (jpg) pimages.push({ row: r, col: k + 1, data: jpg, w: 112, h: 112, dx: 10, dy: 6, border: K.line })
        }
      }
      const cols = [28]; for (let i = 0; i < maxN; i++) cols.push(19)
      return [{ name: L('Photos'), tabColor: K.soft, gridLines: false, cols, rows: prows, merges: pmerges, images: pimages, freezeRow: 4,
        footer: '&L&8Trade · ' + L('Photo gallery') + '&R&8' + L('Page {a} of {b}', { a: '&P', b: '&N' }) }]
    }

    const allSheets = [productsSheet].concat(await photosSheet(), [summary], await duplicatesSheet())
    return {
      bytes: Xlsx.build(allSheets, { title: heading }, ST),
      sheets: allSheets.length,
      fileName: fileBase(opts, sum) + '.xlsx'
    }
  }

  return { summarize, buildPdf, buildExcel, money, int, ymd, stamp, totalsText, totalsOf, registeredAt, dateLabel, dateTimeLabel, monthShort, periodKey, periodLabel, byPeriod, NO_MARKET }
})
