// Permanent data store on the computer + sync for every device (phone, tablet, another computer).
// Each product / market / wish is one JSON file in data/, written safely (temp file + rename).
// A full copy is saved every day in data/backups/ (the last 60 days, plus the first copy of every month, forever).
// Nothing is ever lost: every older version of a record goes to data/history/ (last 10 per record) and every
// deleted record is kept in data/deleted/ — whatever a device sends, and whatever app update comes later.
//
// Safe even if the files are changed by another Trade server on the same folder: before every read or write the
// store checks data/sync.json and reloads from disk when someone else changed it. Revision numbers that clash
// (two servers that gave out the same number) are repaired at load, so every device receives every record.
const fs = require('fs'), path = require('path'), crypto = require('crypto')

const DIR = process.env.TRADE_DATA_DIR || path.join(__dirname, '..', 'data')
const KINDS = ['products', 'markets', 'wishes', 'trash']
const META = () => path.join(DIR, 'sync.json')

function ensureDirs() {
  KINDS.forEach(k => fs.mkdirSync(path.join(DIR, k), { recursive: true }))
  fs.mkdirSync(path.join(DIR, 'backups'), { recursive: true })
}
const KEEP_VERSIONS = 10
// Keep the version that is about to be replaced: history/<kind>/<id>/<time>.json, deleted/<kind>/<id>-<time>.json
function archive(kind, old, deleting) {
  if (!old || old.deleted) return
  try {
    const stamp = String(Number(old.updatedAt) || Date.now())
    if (deleting) {
      const d = path.join(DIR, 'deleted', kind); fs.mkdirSync(d, { recursive: true })
      writeSafe(path.join(d, old.id + '-' + stamp + '.json'), JSON.stringify(old))
    }
    const h = path.join(DIR, 'history', kind, old.id); fs.mkdirSync(h, { recursive: true })
    writeSafe(path.join(h, stamp + '.json'), JSON.stringify(old))
    const all = fs.readdirSync(h).filter(f => f.endsWith('.json')).sort((a, b) => parseInt(a) - parseInt(b))
    all.slice(0, Math.max(0, all.length - KEEP_VERSIONS)).forEach(f => { try { fs.unlinkSync(path.join(h, f)) } catch (e) {} })
  } catch (e) { console.log('Data: could not keep the old version of ' + kind + '/' + old.id + ': ' + e.message) }
}
function writeSafe(file, text) {
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 7) + '.tmp'
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}
const safeId = id => /^[\w-]{1,80}$/.test(String(id || ''))
const mtime = f => { try { return fs.statSync(f).mtimeMs } catch (e) { return 0 } }

// ---- state: revision counter, sync key, devices ----
let meta = null, cache = null, seen = 0 // seen = mtime of sync.json when we last read or wrote it
function saveMeta() { writeSafe(META(), JSON.stringify(meta, null, 2)); seen = mtime(META()) }

function loadAll() {
  ensureDirs()
  try { meta = JSON.parse(fs.readFileSync(META(), 'utf8')) } catch (e) { meta = null }
  let dirty = false
  if (!meta || !meta.key) { meta = { key: crypto.randomBytes(12).toString('base64url'), rev: 0, devices: {}, createdAt: Date.now() }; dirty = true }
  if (!meta.epoch) { meta.epoch = crypto.randomBytes(6).toString('base64url'); dirty = true }
  meta.devices = meta.devices || {}
  cache = {}
  const all = []
  KINDS.forEach(k => {
    cache[k] = new Map()
    fs.readdirSync(path.join(DIR, k)).filter(f => f.endsWith('.json')).forEach(f => {
      try { const r = JSON.parse(fs.readFileSync(path.join(DIR, k, f), 'utf8')); if (r && safeId(r.id)) { cache[k].set(r.id, r); all.push([k, r]) } } catch (e) {}
    })
  })
  // Repair: every record needs its own revision number, not above the counter
  const revs = new Set(); let clash = false
  all.forEach(([, r]) => { const v = Number(r._rev) || 0; if (!v || revs.has(v) || v > meta.rev) clash = true; revs.add(v) })
  if (clash) {
    all.sort((a, b) => (Number(a[1]._rev) || 0) - (Number(b[1]._rev) || 0) || (Number(a[1].updatedAt) || 0) - (Number(b[1].updatedAt) || 0))
    meta.rev = Math.max(meta.rev, ...all.map(x => Number(x[1]._rev) || 0))
    all.forEach(([k, r]) => { r._rev = ++meta.rev; writeSafe(path.join(DIR, k, r.id + '.json'), JSON.stringify(r)) })
    console.log('Data: repaired revision numbers of ' + all.length + ' records — every device will receive them again')
    dirty = true
  }
  if (dirty) saveMeta(); else seen = mtime(META())
}
// Reload when another process changed the data folder since we last looked
function fresh() {
  if (!cache || mtime(META()) !== seen) loadAll()
  return cache
}
function loadMeta() { fresh(); return meta }

// Newer change wins. A deleted record stays as a small "tombstone" so other devices learn about the delete.
function put(kind, rec) {
  if (!KINDS.includes(kind) || !rec || !safeId(rec.id)) return false
  const c = cache[kind], old = c.get(rec.id)
  const t = Number(rec.updatedAt) || 0
  if (old && (Number(old.updatedAt) || 0) > t) return false
  if (old && (Number(old.updatedAt) || 0) === t && JSON.stringify(old) === JSON.stringify(Object.assign({}, rec, { _rev: old._rev }))) return false
  const r = rec.deleted ? { id: rec.id, deleted: true, updatedAt: t } : Object.assign({}, rec)
  archive(kind, old, !!rec.deleted)
  r._rev = ++meta.rev
  c.set(r.id, r)
  writeSafe(path.join(DIR, kind, r.id + '.json'), JSON.stringify(r))
  return true
}

function changesSince(rev) {
  const out = {}
  KINDS.forEach(k => { out[k] = Array.from(cache[k].values()).filter(r => (r._rev || 0) > rev) })
  return out
}

// POST /api/sync — send local changes, receive everything newer than `since`
function sync(body) {
  fresh()
  if (!body || !validKey(body.key)) { const e = new Error('Wrong sync key'); e.status = 403; throw e }
  let since = Number(body.since) || 0
  // A device that knows a different data folder (reset, restored, moved) or a counter we never reached gets everything again
  if ((body.epoch && body.epoch !== meta.epoch) || since > meta.rev) since = 0
  let applied = 0
  KINDS.forEach(k => (Array.isArray(body[k]) ? body[k] : []).forEach(r => { if (put(k, r)) applied++ }))
  if (body.device && safeId(body.device)) {
    meta.devices[body.device] = { name: String(body.deviceName || 'Device').slice(0, 60), lastSeen: Date.now() }
  }
  saveMeta()
  if (applied) { snapshot(false); wake() }
  return Object.assign({ rev: meta.rev, epoch: meta.epoch, applied, full: since === 0 }, changesSince(since))
}

// Records read from GitHub (the phone's main copy): [[kind, record], …] → how many were newer than ours
function applyMany(list) {
  fresh()
  let applied = 0
  list.forEach(([k, r]) => { if (put(k, r)) applied++ })
  if (applied) { saveMeta(); snapshot(false); wake() }
  return applied
}
// Every record (deleted ones as tombstones), for saving to GitHub
function allRecords() { const c = fresh(), out = []; KINDS.forEach(k => c[k].forEach(r => out.push([k, r]))); return out }

function stats() {
  const c = fresh()
  const live = k => Array.from(c[k].values()).filter(r => !r.deleted).length
  return { rev: meta.rev, products: live('products'), markets: live('markets'), wishes: live('wishes'), devices: Object.entries(meta.devices).map(([id, d]) => Object.assign({ id }, d)).sort((a, b) => b.lastSeen - a.lastSeen) }
}

// Daily full copy (one file per day); old days beyond 60 are removed
let lastSnap = ''
function snapshot(force) {
  const day = new Date().toISOString().slice(0, 10)
  if (!force && day === lastSnap) return
  const c = fresh(), data = { app: 'trade', version: 1, exportedAt: Date.now() }
  KINDS.forEach(k => { data[k] = Array.from(c[k].values()).filter(r => !r.deleted).map(r => { const x = Object.assign({}, r); delete x._rev; return x }) })
  writeSafe(path.join(DIR, 'backups', 'trade-' + day + '.json'), JSON.stringify(data))
  lastSnap = day
  // Remove days older than the last 60 — except the first copy of each month, which is kept forever
  const files = fs.readdirSync(path.join(DIR, 'backups')).filter(f => /^trade-\d{4}-\d\d-\d\d\.json$/.test(f)).sort()
  const months = new Map() // "2026-11" → first file of that month (files are sorted)
  files.forEach(f => { if (!months.has(f.slice(6, 13))) months.set(f.slice(6, 13), f) })
  const firstOfMonth = new Set(months.values())
  files.slice(0, Math.max(0, files.length - 60)).filter(f => !firstOfMonth.has(f)).forEach(f => { try { fs.unlinkSync(path.join(DIR, 'backups', f)) } catch (e) {} })
}

// Live sync: a device waits here (long poll) and is answered as soon as another device sends a change
const waiting = new Set()
const listeners = []
function onChange(fn) { listeners.push(fn) }
function wake() { const all = [...waiting]; waiting.clear(); all.forEach(fn => fn()); listeners.forEach(fn => { try { fn() } catch (e) {} }) }
function waitForChange(rev, ms) {
  fresh()
  if (meta.rev > rev) return Promise.resolve(true)
  return new Promise(resolve => {
    const done = v => { clearTimeout(timer); waiting.delete(fn); resolve(v) }
    const fn = () => done(true)
    const timer = setTimeout(() => done(meta.rev > rev), ms)
    waiting.add(fn)
  })
}

// Daily copies on the computer: list (newest first) and read one
const backupInfo = new Map() // file → { mtime, counts }
function backups() {
  ensureDirs()
  const dir = path.join(DIR, 'backups')
  return fs.readdirSync(dir).filter(f => /^trade-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().reverse().map(f => {
    const p = path.join(dir, f), st = fs.statSync(p)
    let info = backupInfo.get(f)
    if (!info || info.mtime !== st.mtimeMs) {
      let counts = {}
      try { const d = JSON.parse(fs.readFileSync(p, 'utf8')); KINDS.forEach(k => { counts[k] = (d[k] || []).length }); counts.photos = (d.products || []).reduce((n, x) => n + (x.images || []).length, 0) } catch (e) {}
      info = { mtime: st.mtimeMs, counts }
      backupInfo.set(f, info)
    }
    return Object.assign({ file: f, day: f.slice(6, 16), size: st.size, savedAt: st.mtimeMs }, info.counts)
  })
}
function readBackup(file) {
  if (!/^trade-\d{4}-\d\d-\d\d\.json$/.test(String(file || ''))) return null
  try { return fs.readFileSync(path.join(DIR, 'backups', file), 'utf8') } catch (e) { return null }
}

// Phones that made their own pairing code (the iPhone is the main device): the computer accepts those codes too
function keys() { const m = loadMeta(); return [m.key].concat(m.phoneKeys || []) }
function validKey(k) { return !!k && keys().includes(String(k)) }
function addPhoneKey(k) {
  const m = loadMeta()
  if (k === m.key || (m.phoneKeys || []).includes(k)) return false
  m.phoneKeys = (m.phoneKeys || []).concat(k); saveMeta(); return true
}

// Linked phones (like WhatsApp linked devices): the phone scanned this computer's QR code and sent its own code.
// The phone keeps the main copy of the data; this computer mirrors it. Unlinking removes the code, so that phone
// can no longer read or change anything here (its own data stays on the phone).
function linkPhone(code, info) {
  addPhoneKey(code)
  const m = loadMeta()
  m.phones = m.phones || {}
  m.phones[code] = Object.assign({}, m.phones[code], { name: String(info.name || 'Phone').slice(0, 60), device: safeId(info.device) ? info.device : '', linkedAt: Date.now() })
  saveMeta()
}
function phones(fp) {
  const m = loadMeta()
  return (m.phoneKeys || []).map(code => {
    const p = (m.phones || {})[code] || {}, d = p.device && m.devices[p.device]
    return { id: fp(code), name: (d && d.name) || p.name || 'Phone', linkedAt: p.linkedAt || 0, lastSeen: (d && d.lastSeen) || 0 }
  }).sort((a, b) => b.linkedAt - a.linkedAt)
}
function unlinkPhone(id, fp) {
  const m = loadMeta(), code = (m.phoneKeys || []).find(c => fp(c) === id)
  if (!code) return false
  const p = (m.phones || {})[code]
  m.phoneKeys = m.phoneKeys.filter(c => c !== code)
  if (m.phones) delete m.phones[code]
  if (p && p.device) delete m.devices[p.device]
  saveMeta(); wake()
  return true
}

module.exports = { applyMany, allRecords, onChange, sync, stats, snapshot, backups, readBackup, waitForChange, key: () => loadMeta().key, keys, validKey, addPhoneKey, linkPhone, phones, unlinkPhone, DIR, KINDS }
