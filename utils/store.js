// Data storage on the phone (wx storage + files in USER_DATA_PATH).
// The data stays until the mini program is deleted from WeChat — use Settings → Backup to keep a copy.
const Similar = require('./similar')

const KEY = 'products', MKEY = 'markets', SKEY = 'settings'

// ---------- products ----------
function all() {
  return wx.getStorageSync(KEY) || []
}

function saveAll(list) {
  wx.setStorageSync(KEY, list)
}

function get(id) {
  return all().find(p => p.id === id)
}

function upsert(product) {
  const list = all()
  const i = list.findIndex(p => p.id === product.id)
  if (i >= 0) list[i] = product
  else list.unshift(product)
  saveAll(list)
}

function unlink(path) {
  try { wx.getFileSystemManager().unlinkSync(path) } catch (e) {}
}

function remove(id) {
  const p = get(id)
  if (p) (p.images || []).forEach(unlink)
  saveAll(all().filter(x => x.id !== id))
}

// Move a temporary image to a permanent file
function persistImage(path, i) {
  const base = wx.env.USER_DATA_PATH
  if (path.indexOf(base) === 0) return Promise.resolve(path)
  const ext = (path.match(/\.\w+$/) || ['.jpg'])[0]
  const dest = `${base}/img_${Date.now()}_${i}${ext}`
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().saveFile({
      tempFilePath: path,
      filePath: dest,
      success: r => resolve(r.savedFilePath || dest),
      fail: reject
    })
  })
}

// Delete images that were removed during an edit
function cleanupImages(oldImages, newImages) {
  (oldImages || []).filter(p => newImages.indexOf(p) < 0).forEach(unlink)
}

// ---------- photo fingerprints (for "same look") ----------
let hashCanvas = null
function hashImage(src) {
  return new Promise(resolve => {
    try {
      if (!hashCanvas) hashCanvas = wx.createOffscreenCanvas({ type: '2d', width: Similar.HASH_W, height: Similar.HASH_H })
      const img = hashCanvas.createImage()
      img.onload = () => {
        try { resolve(Similar.hashImage(hashCanvas.getContext('2d'), img)) } catch (e) { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = src
    } catch (e) { resolve(null) }
  })
}
async function hashImages(paths) {
  const out = []
  for (const p of paths || []) { const h = await hashImage(p); if (h) out.push(h) }
  return out
}
// Fill in fingerprints for products saved before this feature existed
async function ensureHashes() {
  const list = all()
  let changed = false
  for (const p of list) {
    const imgs = p.images || []
    if (p.hashes && p.hashes.length === imgs.length && p.hashes.every(h => h.length >= 22)) continue
    p.hashes = await hashImages(imgs)
    changed = true
  }
  if (changed) saveAll(list)
  return list
}

// ---------- markets (registered list) ----------
const norm = s => String(s || '').trim().replace(/\s+/g, ' ')

function markets() {
  let list = wx.getStorageSync(MKEY)
  if (!Array.isArray(list)) {
    // First run: register the markets products already use
    const seen = {}
    list = []
    all().forEach(p => {
      const n = norm(p.marketName)
      if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; list.push(newMarket(n)) }
    })
    wx.setStorageSync(MKEY, list)
  }
  return list.slice().sort((a, b) => a.name.localeCompare(b.name))
}
function newMarket(name, note, from) {
  return { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: norm(name), note: norm(note), createdAt: Date.now(), addedFrom: from || '' }
}
function findMarket(name) {
  const n = norm(name).toLowerCase()
  return markets().find(m => m.name.toLowerCase() === n)
}
// Returns the registered market with this name, adding it if needed
function ensureMarket(name, note, from) {
  if (!norm(name)) return null
  const ex = findMarket(name)
  if (ex) return ex
  const m = newMarket(name, note, from)
  wx.setStorageSync(MKEY, markets().concat(m))
  return m
}
function updateMarket(id, name, note) {
  const list = markets(), m = list.find(x => x.id === id)
  if (!m) return
  const old = m.name
  m.name = norm(name); m.note = norm(note)
  wx.setStorageSync(MKEY, list)
  if (old !== m.name) saveAll(all().map(p => p.marketName === old ? Object.assign(p, { marketName: m.name }) : p))
}
function removeMarket(id) {
  wx.setStorageSync(MKEY, markets().filter(m => m.id !== id))
}
function marketUsage(name) {
  return all().filter(p => p.marketName === name)
}

// ---------- settings ----------
function settings() {
  const s = wx.getStorageSync(SKEY) || {}
  if (!s.lang) {
    // First run: follow the phone's language
    let l = 'en'
    try { const sys = (wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()).language || ''; l = /^zh/i.test(sys) ? 'zh' : /^so/i.test(sys) ? 'so' : 'en' } catch (e) {}
    s.lang = l
  }
  return Object.assign({ theme: 'jade', noanim: false }, s)
}
function setSetting(k, v) { const s = settings(); s[k] = v; wx.setStorageSync(SKEY, s); return s }

// ---------- backup / restore ----------
// One JSON file with every product, market and photo (photos as base64)
function backup() {
  const fs = wx.getFileSystemManager()
  const products = all().map(p => Object.assign({}, p, {
    images: (p.images || []).map(src => {
      try { return 'data:image/jpeg;base64,' + fs.readFileSync(src, 'base64') } catch (e) { return null }
    }).filter(Boolean)
  }))
  const data = { app: 'trade', version: 1, exportedAt: Date.now(), products, markets: markets(), settings: { theme: settings().theme } }
  const d = new Date(), pad = n => (n < 10 ? '0' : '') + n
  const name = 'Trade-backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json'
  const path = wx.env.USER_DATA_PATH + '/' + name
  fs.writeFileSync(path, JSON.stringify(data), 'utf8')
  setSetting('lastBackup', Date.now())
  return { path, name, count: products.length }
}

// Merge a backup file: existing products are kept, matching ids are replaced
function restore(text) {
  const data = JSON.parse(text)
  if (!data || data.app !== 'trade' || !Array.isArray(data.products)) throw new Error('This is not a Trade backup file')
  const fs = wx.getFileSystemManager(), base = wx.env.USER_DATA_PATH
  const list = all()
  data.products.forEach((p, pi) => {
    p.images = (p.images || []).map((src, i) => {
      const m = /^data:image\/\w+;base64,(.*)$/.exec(src || '')
      if (!m) return src
      const path = `${base}/img_${Date.now()}_${pi}_${i}.jpg`
      try { fs.writeFileSync(path, m[1], 'base64'); return path } catch (e) { return null }
    }).filter(Boolean)
    const at = list.findIndex(x => x.id === p.id)
    if (at >= 0) { cleanupImages(list[at].images, p.images); list[at] = p } else list.push(p)
  })
  saveAll(list)
  ;(data.markets || []).forEach(m => { if (!findMarket(m.name)) wx.setStorageSync(MKEY, markets().concat(m)) })
  return { products: data.products.length, markets: (data.markets || []).length }
}

module.exports = {
  all, get, upsert, remove, persistImage, cleanupImages,
  hashImages, ensureHashes,
  markets, findMarket, ensureMarket, updateMarket, removeMarket, marketUsage, norm,
  settings, setSetting, backup, restore
}
