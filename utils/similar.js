// Find products that look like the same item: by name and/or by photo.
// Photo matching uses a 64-bit "difference hash" of each photo (computed when the product is saved).
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.TradeSimilar = factory()
})(this, function () {
  const HASH_W = 9, HASH_H = 8
  // Tuned to be sensitive: it is better to show a possible match to compare than to miss one
  const NAME_MIN = 0.6 // Dice similarity of character pairs
  const PHOTO_MAX = 14 // max differing bits out of 64

  function norm(s) {
    s = String(s || '').toLowerCase()
    if (s.normalize) s = s.normalize('NFKC')
    return s.replace(/[\s\-_.,/\\|()[\]{}'"!?:;+*#&]+/g, ' ').trim()
  }

  function pairs(s) {
    const t = s.replace(/ /g, '')
    const out = new Map()
    for (let i = 0; i < t.length - 1; i++) {
      const k = t.substr(i, 2)
      out.set(k, (out.get(k) || 0) + 1)
    }
    return { map: out, n: Math.max(0, t.length - 1) }
  }

  // Meaningful words: drop very short ones and plain numbers; "shoes" and "shoe" count as the same word
  function words(s) {
    return s.split(' ').filter(w => w.length >= 2 && !/^\d+$/.test(w)).map(w => w.length < 4 || /ss$/.test(w) ? w : w.replace(/(x|ch|sh)es$/, '$1').replace(/s$/, ''))
  }

  function nameScore(a, b) {
    a = norm(a); b = norm(b)
    if (!a || !b) return 0
    if (a === b) return 1
    const short = a.length <= b.length ? a : b, long = short === a ? b : a
    const minLen = /[぀-鿿가-힯]/.test(short) ? 2 : 4 // CJK words are shorter
    if (short.replace(/ /g, '').length >= minLen && long.indexOf(short) >= 0) return 0.9
    // Same words in another order or with extra words ("shoes sports" = "sports shoes", "red sports shoes 2025")
    const wa = words(a), wb = words(b)
    if (wa.length && wb.length) {
      const sw = wa.length <= wb.length ? wa : wb, lw = sw === wa ? wb : wa
      const hit = sw.filter(w => lw.some(x => x === w || (w.length >= 4 && x.length >= 4 && (x.startsWith(w) || w.startsWith(x))))).length
      if (hit === sw.length && (sw.length >= 2 || sw[0].length >= minLen + 1)) return 0.88
      if (sw.length >= 2 && hit / sw.length >= 0.66) return 0.75
    }
    const pa = pairs(a), pb = pairs(b)
    if (!pa.n || !pb.n) return 0
    let common = 0
    pa.map.forEach((c, k) => { common += Math.min(c, pb.map.get(k) || 0) })
    return 2 * common / (pa.n + pb.n)
  }

  const hx = n => (n < 16 ? '0' : '') + n.toString(16)
  // RGBA pixels of a HASH_W x HASH_H image -> 16 hex chars of shape + 6 hex chars of average colour
  function hashFromRGBA(data) {
    const g = [], avg = [0, 0, 0], N = HASH_W * HASH_H
    for (let i = 0; i < N; i++) {
      g.push(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114)
      for (let c = 0; c < 3; c++) avg[c] += data[i * 4 + c] / N
    }
    let hex = ''
    for (let y = 0; y < HASH_H; y++) {
      let byte = 0
      for (let x = 0; x < HASH_W - 1; x++) byte = (byte << 1) | (g[y * HASH_W + x] < g[y * HASH_W + x + 1] ? 1 : 0)
      hex += hx(byte)
    }
    return hex + avg.map(v => hx(Math.round(v))).join('')
  }

  // Draw an image into a canvas context and return its hash
  function hashImage(ctx, img) {
    ctx.clearRect(0, 0, HASH_W, HASH_H)
    ctx.drawImage(img, 0, 0, HASH_W, HASH_H)
    return hashFromRGBA(ctx.getImageData(0, 0, HASH_W, HASH_H).data)
  }

  const COLOR_MAX = 64 // max distance between average colours (0-441)
  function distance(h1, h2) {
    if (!h1 || !h2 || h1.length < 16 || h2.length < 16) return 64
    if (h1.length >= 22 && h2.length >= 22) {
      let cd = 0
      for (let c = 0; c < 3; c++) cd += Math.pow(parseInt(h1.substr(16 + c * 2, 2), 16) - parseInt(h2.substr(16 + c * 2, 2), 16), 2)
      if (Math.sqrt(cd) > COLOR_MAX) return 64
    }
    let d = 0
    for (let i = 0; i < 16; i += 2) {
      let x = parseInt(h1.substr(i, 2), 16) ^ parseInt(h2.substr(i, 2), 16)
      while (x) { d += x & 1; x >>= 1 }
    }
    return d
  }

  function photoMatch(a, b) {
    const ha = a.hashes || [], hb = b.hashes || []
    let best = 64
    ha.forEach(x => hb.forEach(y => { best = Math.min(best, distance(x, y)) }))
    return best <= PHOTO_MAX ? best : -1
  }

  // mode: 'both' | 'name' | 'photo'. Returns groups of 2+ products, biggest first.
  function groups(products, mode) {
    mode = mode || 'both'
    const n = products.length, parent = products.map((_, i) => i), why = products.map(() => ({}))
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = products[i], b = products[j]
        let hit = false
        if (mode !== 'photo' && nameScore(a.name, b.name) >= NAME_MIN) { hit = true; why[i].name = why[j].name = 1 }
        if (mode !== 'name' && photoMatch(a, b) >= 0) { hit = true; why[i].photo = why[j].photo = 1 }
        if (hit) parent[find(i)] = find(j)
      }
    }
    const map = new Map()
    products.forEach((p, i) => {
      const r = find(i)
      if (!map.has(r)) map.set(r, { products: [], byName: false, byPhoto: false })
      const g = map.get(r)
      g.products.push(p)
      if (why[i].name) g.byName = true
      if (why[i].photo) g.byPhoto = true
    })
    return Array.from(map.values()).filter(g => g.products.length > 1).map(g => {
      const list = g.products.slice().sort((a, b) => a.currency.localeCompare(b.currency) || a.price - b.price)
      const shops = new Set(list.map(p => (p.marketName || '') + '|' + p.shopName))
      const byCur = {}
      list.forEach(p => {
        const c = byCur[p.currency] || (byCur[p.currency] = { currency: p.currency, min: p.price, max: p.price, cheapest: p })
        if (p.price < c.min) { c.min = p.price; c.cheapest = p }
        if (p.price > c.max) c.max = p.price
      })
      const named = list.slice().sort((a, b) => a.name.length - b.name.length)[0]
      return {
        name: named.name, products: list, shopCount: shops.size,
        prices: Object.keys(byCur).map(k => byCur[k]),
        cover: (list.find(p => p.images && p.images.length) || {}).images,
        by: g.byName && g.byPhoto ? 'name + photo' : g.byPhoto ? 'photo' : 'name'
      }
    }).sort((a, b) => b.products.length - a.products.length || a.name.localeCompare(b.name))
  }

  // ---------- Duplicates: the SAME item registered more than once ----------
  // Stricter than groups(): same name and a close photo, or a near-identical photo, or same name + same shop.
  const DUP_PHOTO = 8, DUP_PHOTO_ONLY = 4, DUP_NAME = 0.88
  const shopKey = p => (String(p.marketName || '').trim() + '|' + String(p.shopName || '').trim()).toLowerCase()
  function isDuplicate(a, b) {
    const name = nameScore(a.name, b.name), photo = photoMatch(a, b)
    const hasPhotos = (a.hashes || []).length && (b.hashes || []).length
    if (hasPhotos && photo >= 0 && photo <= DUP_PHOTO_ONLY) return true
    if (name >= DUP_NAME && hasPhotos && photo >= 0 && photo <= DUP_PHOTO) return true
    if (name >= 0.97 && (!hasPhotos || shopKey(a) === shopKey(b))) return true
    return false
  }
  // The closest registered product to a new one (or null): { product, photo, name }
  function closest(item, products) {
    let best = null
    products.forEach(p => {
      if (p === item || (item.id && p.id === item.id)) return
      if (!isDuplicate(item, p)) return
      const ph = photoMatch(item, p), sc = (ph >= 0 ? 64 - ph : 0) + nameScore(item.name, p.name) * 40
      if (!best || sc > best.sc) best = { product: p, photo: ph, name: nameScore(item.name, p.name), sc }
    })
    return best
  }
  // Field-by-field comparison of products that are the same item
  const FIELDS = [
    ['name', 'Product name', p => String(p.name || '').trim()],
    ['size', 'Size', p => String(p.size || '').trim()],
    ['price', 'Price', p => (p.currency || '') + (Number(p.price) || 0).toFixed(2)],
    ['moq', 'Minimum order', p => (Number(p.minOrder) || 0) + ' ' + (p.unit || '')],
    ['market', 'Market', p => String(p.marketName || '').trim()],
    ['shop', 'Shop', p => String(p.shopName || '').trim()],
    ['wechat', 'WeChat', p => p.shopWechat === 'yes' ? String(p.wechatId || 'yes') : p.shopWechat || ''],
    ['location', 'Location', p => p.location ? (+p.location.latitude).toFixed(4) + ',' + (+p.location.longitude).toFixed(4) : ''],
    ['photo', 'Photo', null]
  ]
  function compare(list) {
    return FIELDS.map(([key, label, get]) => {
      if (!get) {
        let same = true
        for (let i = 1; i < list.length; i++) if (!(photoMatch(list[0], list[i]) >= 0 && photoMatch(list[0], list[i]) <= DUP_PHOTO)) same = false
        return { key, label, values: list.map(() => ''), same }
      }
      const vals = list.map(get), n = vals.map(v => norm(v))
      return { key, label, values: vals, same: n.every(v => v === n[0]) }
    })
  }
  function duplicates(products) {
    const n = products.length, parent = products.map((_, i) => i)
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]))
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (isDuplicate(products[i], products[j])) parent[find(i)] = find(j)
    const map = new Map()
    products.forEach((p, i) => { const r = find(i); if (!map.has(r)) map.set(r, []); map.get(r).push(p) })
    return Array.from(map.values()).filter(l => l.length > 1).map(list => {
      list = list.slice().sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
      const rows = compare(list)
      return { name: list[0].name, products: list, rows, same: rows.filter(r => r.same).length, total: rows.length }
    }).sort((a, b) => b.products.length - a.products.length || b.same - a.same)
  }

  return { HASH_W, HASH_H, nameScore, hashFromRGBA, hashImage, distance, groups, duplicates, closest, compare, isDuplicate }
})
