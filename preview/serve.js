// Server for the web app: node preview/serve.js [port]
// Serves preview/ plus the shared modules in /utils (used by both the mini program and the web app).
// Listens on the local network too, so a phone on the same Wi-Fi can open it.
// Also sends report emails (POST /api/email/send) through the email account set up in the app (Settings → Email).
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os')
const mailer = require('./mailer')
const store = require('./datastore')
const scanner = require('./scanner')
const pages = require('./publish')
const github = require('./github')
const root = __dirname, utils = path.join(__dirname, '..', 'utils')
const args = process.argv.slice(2)
const port = Number(args.find(a => /^\d+$/.test(a)) || process.env.PORT || 5173)
// --iphone: also open a secure (https) address through Cloudflare (no account needed), so an iPhone can install the app
// Also on when the app is published on GitHub Pages (npm run pages): iPhones reach this computer at that address
const IPHONE = args.includes('--iphone') || !!pages.config()
let publicUrl = ''
// Email account settings (contains the app password — keep this file private)
const CONFIG = process.env.TRADE_EMAIL_CONFIG || path.join(__dirname, '..', 'email.config.json')
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml'
}

// AI scanner key (keep this file private)
const AI_CONFIG = process.env.TRADE_AI_CONFIG || path.join(__dirname, '..', 'ai.config.json')
function readAi() { try { return JSON.parse(fs.readFileSync(AI_CONFIG, 'utf8')) } catch (e) { return null } }
const aiReady = () => !!((readAi() || {}).apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
function lanUrls() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => 'http://' + i.address + ':' + port + '/')
}
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch (e) { return null } }
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)) }
function body(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('Too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(new Error('Bad request')) } })
    req.on('error', reject)
  })
}
const APK_ORIGIN = 'https://appassets.androidplatform.net'
// A request through a tunnel (cloudflared, ngrok…) also arrives from 127.0.0.1, but it comes from the internet:
// the proxy adds forwarding headers, so such a request is never treated as this computer.
const PROXY_HEADERS = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded']
const isLocal = req => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress) && !PROXY_HEADERS.some(h => req.headers[h])

// Short pairing code: 6 digits shown on the computer, valid 10 minutes. A phone types it and gets the sync key.
// After 5 wrong tries the code changes and typing is blocked for 2 minutes.
let pin = null, pinBlockedUntil = 0
function currentPin() {
  if (!pin || pin.exp < Date.now()) pin = { code: String(require('crypto').randomInt(0, 1e6)).padStart(6, '0'), exp: Date.now() + 10 * 60e3, tries: 0 }
  return pin
}

// Linking like WhatsApp: the computer shows ONE QR code = its address + a one-time token that changes every minute.
// The phone scans it inside Trade and sends its own code; from then on that phone is linked (one scan, nothing to type).
// The previous token stays valid 30 s more, so a scan made just as the code changes still works.
let linkTok = null, linkPrev = null, linkFails = 0, linkBlockedUntil = 0, lastLinked = null
function currentLink() {
  if (!linkTok || linkTok.exp < Date.now()) {
    linkPrev = linkTok && { token: linkTok.token, exp: Date.now() + 30e3 }
    linkTok = { token: require('crypto').randomBytes(12).toString('base64url'), exp: Date.now() + 60e3 }
  }
  return linkTok
}
const PHONE_CODE = /^[A-Z0-9]{16}$/
function linkPhone(code, b) {
  store.linkPhone(code, { name: b.deviceName, device: b.device })
  lastLinked = { name: String(b.deviceName || 'Phone').slice(0, 60), at: Date.now() }
  if (publicUrl && pages.config()) pages.publishAddress([code], publicUrl).catch(e => console.log('iPhone: address not published:', e.message))
  console.log('Phone linked: ' + lastLinked.name)
}

async function api(req, res, url) {
  const cfg = readConfig()
  // Devices other than this computer must show the sync key (from pairing)
  const keyOk = () => isLocal(req) || store.validKey(req.headers['x-trade-key'])
  // ---- sync: the computer keeps every product forever and shares it with your devices ----
  // Found by the phone app when the computer's address changed: says "Trade is here" and which computer it is
  // (a fingerprint of the pairing key — the key itself is never shown), plus every address of this computer
  if (url === '/api/sync/hello' && req.method === 'GET') {
    return json(res, 200, { trade: true, id: pages.fingerprint(store.key()), ids: store.keys().map(pages.fingerprint), urls: lanUrls() })
  }
  if (url === '/api/sync/info' && req.method === 'GET') {
    if (!isLocal(req)) return json(res, 200, { computer: false }) // only the computer shows its key
    const p = currentPin(), l = currentLink()
    const hub = pages.config()
    return json(res, 200, Object.assign({ key: store.key(), urls: lanUrls(), publicUrl, port, dataDir: store.DIR, pin: p.code, pinExp: p.exp, hubUrl: hub ? hub.url : '',
      link: l.token, linkExp: l.exp, phones: store.phones(pages.fingerprint), lastLinked, computer: os.hostname() }, store.stats()))
  }
  // The phone scanned the QR code: token from the code + the phone's own code → linked
  if (url === '/api/sync/link' && req.method === 'POST') {
    const b = await body(req, 2e3)
    if (Date.now() < linkBlockedUntil) return json(res, 429, { error: 'Too many tries — wait a minute and scan again' })
    const tok = String(b.token || ''), code = String(b.phoneKey || '')
    const ok = [linkTok, linkPrev].some(x => x && x.exp > Date.now() && x.token === tok)
    if (!ok) {
      if (++linkFails >= 10) { linkFails = 0; linkBlockedUntil = Date.now() + 60e3 }
      return json(res, 410, { error: 'This QR code has expired — scan the new one on the computer' })
    }
    if (!PHONE_CODE.test(code)) return json(res, 400, { error: 'Update Trade on the phone and scan again' })
    linkTok = linkPrev = null; linkFails = 0 // used: the computer shows a new code
    linkPhone(code, b)
    return json(res, 200, { ok: true, computer: os.hostname() })
  }
  // Unlink a phone (only on the computer): it can no longer read or change the data here; its own copy stays on it
  if (url === '/api/sync/unlink' && req.method === 'POST') {
    if (!isLocal(req)) return json(res, 403, { error: 'Unlink phones on the computer that runs Trade' })
    const b = await body(req, 1e3)
    return json(res, 200, { ok: store.unlinkPhone(String(b.id || ''), pages.fingerprint) })
  }
  // The code shown on an iPhone (Settings → Use on another device), typed or scanned here on the computer.
  // From then on that phone's own code opens this computer's data too.
  if (url === '/api/sync/adopt' && req.method === 'POST') {
    if (!isLocal(req)) return json(res, 403, { error: 'Type the phone code on the computer that runs Trade' })
    const b = await body(req, 1e3)
    const code = String(b.code || '').toUpperCase().replace(/^TRADE-PHONE:/, '').replace(/[^A-Z0-9]/g, '')
    if (!/^[A-Z0-9]{16}$/.test(code)) return json(res, 400, { error: 'The phone code has 16 letters and numbers (e.g. ABCD-EFGH-JKMN-PQRS)' })
    const added = store.addPhoneKey(code)
    if (publicUrl && pages.config()) pages.publishAddress([code], publicUrl).catch(e => console.log('iPhone: address not published:', e.message))
    console.log(added ? 'Phone connected with its own code' : 'Phone code was already connected')
    return json(res, 200, { ok: true, added, reachable: !!publicUrl })
  }
  if (url === '/api/sync/pin' && req.method === 'POST') {
    const b = await body(req, 1e3)
    if (Date.now() < pinBlockedUntil) return json(res, 429, { error: 'Too many wrong codes — wait 2 minutes and use the new code on the computer' })
    const p = currentPin()
    if (String(b.pin || '').replace(/\D/g, '') === p.code) {
      pin = null
      // A phone that sends its own code is linked with it (same as scanning the QR code)
      if (PHONE_CODE.test(String(b.phoneKey || ''))) { linkPhone(b.phoneKey, b); return json(res, 200, { key: b.phoneKey, computer: os.hostname() }) }
      return json(res, 200, { key: store.key() })
    }
    if (++p.tries >= 5) { pin = null; pinBlockedUntil = Date.now() + 120e3 }
    return json(res, 403, { error: 'Wrong code' })
  }
  // Daily copies kept on the computer
  if (url === '/api/backups' && req.method === 'GET') {
    if (!keyOk()) return json(res, 403, { error: 'Wrong sync key' })
    return json(res, 200, { backups: store.backups() })
  }
  if (url.startsWith('/api/backups/') && req.method === 'GET') {
    if (!keyOk()) return json(res, 403, { error: 'Wrong sync key' })
    const text = store.readBackup(url.slice('/api/backups/'.length))
    if (!text) return json(res, 404, { error: 'Not found' })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(text)
  }
  if (url === '/api/sync/status' && req.method === 'GET') {
    if (!keyOk()) return json(res, 403, { error: 'Wrong sync key' })
    return json(res, 200, store.stats())
  }
  // Live sync: answers as soon as the data on the computer is newer than `rev` (or after 25 s with changed: false)
  if (url === '/api/sync/wait' && req.method === 'GET') {
    if (!keyOk()) return json(res, 403, { error: 'Wrong sync key' })
    const rev = Number(new URL(req.url, 'http://x').searchParams.get('rev')) || 0
    let gone = false
    req.on('close', () => { gone = true })
    const changed = await store.waitForChange(rev, 25000)
    if (gone) return
    return json(res, 200, { changed })
  }
  if (url === '/api/sync' && req.method === 'POST') {
    const b = await body(req, 200 * 1024 * 1024)
    try { return json(res, 200, store.sync(b)) } catch (e) { return json(res, e.status || 400, { error: e.message }) }
  }
  // ---- GitHub: the phone's main copy, read and written here too ----
  if (url === '/api/github/status' && req.method === 'GET') {
    if (!isLocal(req)) return json(res, 403, { error: 'Only on the computer' })
    return json(res, 200, github.status())
  }
  if (url === '/api/github/config' && req.method === 'POST') {
    if (!isLocal(req)) return json(res, 403, { error: 'Set up GitHub on the computer that runs Trade' })
    const b = await body(req, 1e4)
    if (b.clear) { github.clear(); return json(res, 200, { ok: true }) }
    try { await github.setup(b); return json(res, 200, { ok: true }) } catch (e) { return json(res, e.status || 400, { error: e.message }) }
  }
  if (url === '/api/github/sync' && req.method === 'POST') {
    if (!isLocal(req)) return json(res, 403, { error: 'Only on the computer' })
    await github.run(); return json(res, 200, github.status())
  }
  // ---- AI scanner ----
  if (url === '/api/ai/status' && req.method === 'GET') {
    return json(res, 200, { configured: aiReady(), canConfigure: isLocal(req), model: scanner.MODEL })
  }
  if (url === '/api/ai/config' && req.method === 'POST') {
    if (!isLocal(req)) return json(res, 403, { error: 'Set up the AI scanner on the computer that runs the app' })
    const b = await body(req, 1e4)
    if (b.clear) { try { fs.unlinkSync(AI_CONFIG) } catch (e) {} return json(res, 200, { ok: true }) }
    const k = String(b.apiKey || '').trim()
    if (!/^sk-ant-[\w-]{20,}$/.test(k)) return json(res, 400, { error: 'This does not look like a Claude API key (it starts with sk-ant-)' })
    try { await scanner.check(k) } catch (e) { return json(res, e.status || 400, { error: e.message }) }
    fs.writeFileSync(AI_CONFIG, JSON.stringify({ apiKey: k }, null, 2))
    return json(res, 200, { ok: true })
  }
  if (url === '/api/scan' && req.method === 'POST') {
    if (!keyOk()) return json(res, 403, { error: 'Pair this device first (Settings → Use on another device)' })
    if (!aiReady()) return json(res, 400, { error: 'The AI scanner is not set up. Add the key in Settings → AI scanner.' })
    const b = await body(req, 40 * 1024 * 1024)
    try {
      const t0 = Date.now()
      const r = await scanner.scan((readAi() || {}).apiKey, b.images, b.lang)
      console.log('Scan:', r.name_en, '|', r.size, '(' + (Date.now() - t0) + ' ms)')
      return json(res, 200, r)
    } catch (e) { console.log('Scan failed:', e.message); return json(res, e.status || 500, { error: e.message }) }
  }
  if (url === '/api/email/status' && req.method === 'GET') {
    return json(res, 200, { available: true, configured: !!(cfg && cfg.from && (cfg.host || mailer.PRESETS[cfg.provider])), from: cfg && cfg.from, provider: cfg && cfg.provider, canConfigure: isLocal(req) })
  }
  if (url === '/api/email/config' && req.method === 'POST') {
    // Only from this computer, so nobody else on the Wi-Fi can change the account
    if (!isLocal(req)) return json(res, 403, { error: 'Set up email on the computer that runs the app (http://localhost:' + port + ')' })
    const b = await body(req, 1e5)
    if (b.clear) { try { fs.unlinkSync(CONFIG) } catch (e) {} return json(res, 200, { ok: true }) }
    if (!mailer.EMAIL.test(b.from || '')) return json(res, 400, { error: 'Enter a valid email address' })
    const next = {
      provider: b.provider || 'custom', from: b.from.trim(), fromName: (b.fromName || 'Trade').trim(), user: (b.user || b.from).trim(),
      pass: b.pass ? String(b.pass) : (cfg && cfg.from === b.from.trim() ? cfg.pass : '')
    }
    if (next.provider === 'custom') Object.assign(next, { host: String(b.host || '').trim(), port: Number(b.port) || 587, secure: Number(b.port) === 465, starttls: Number(b.port) !== 465 })
    if (!next.pass) return json(res, 400, { error: 'Enter the app password' })
    if (next.provider === 'custom' && !next.host) return json(res, 400, { error: 'Enter the SMTP server' })
    fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2))
    return json(res, 200, { ok: true })
  }
  if (url === '/api/email/send' && req.method === 'POST') {
    if (!keyOk()) return json(res, 403, { error: 'Pair this device first (Settings → Use on another device)' })
    if (!cfg) return json(res, 400, { error: 'Email is not set up. Open Settings → Email.' })
    const b = await body(req, 30 * 1024 * 1024)
    if (!b.data || !b.filename) return json(res, 400, { error: 'No file to send' })
    try {
      const r = await mailer.send(cfg, {
        to: b.to, subject: String(b.subject || b.filename).slice(0, 200), text: String(b.text || ''), title: b.title, stats: b.stats, brand: b.brand, attachedText: b.attachedText,
        filename: path.basename(String(b.filename)), contentType: b.contentType || 'application/octet-stream', data: String(b.data)
      })
      console.log('Email sent to', r.accepted.join(', '), '-', b.filename)
      return json(res, 200, { ok: true, accepted: r.accepted })
    } catch (e) {
      console.log('Email failed:', e.message)
      return json(res, 502, { error: e.message })
    }
  }
  json(res, 404, { error: 'Not found' })
}

// Only one Trade server per data folder: two servers writing the same files is what made devices miss products
const LOCK = path.join(store.DIR, 'server.lock')
function takeLock() {
  try {
    const old = JSON.parse(fs.readFileSync(LOCK, 'utf8'))
    if (old.pid !== process.pid) { try { process.kill(old.pid, 0); return old } catch (e) {} } // still running?
  } catch (e) {}
  fs.mkdirSync(store.DIR, { recursive: true })
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, port, startedAt: Date.now() }))
  const free = () => { try { if (JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid === process.pid) fs.unlinkSync(LOCK) } catch (e) {} }
  process.on('exit', free)
  ;['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].forEach(sig => process.on(sig, () => process.exit(0)))
  return null
}
const other = takeLock()
if (other) {
  console.log('Trade is already running for this data folder: http://localhost:' + other.port + ' (process ' + other.pid + ').')
  console.log('Open that address, or close the other window first. Two servers on the same data make devices miss products.')
  process.exit(1)
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (url.startsWith('/api/')) {
    // The Android app (Trade.apk) has the app files built in and calls the API from its own origin
    // …and so does the app published on GitHub Pages (the iPhone app)
    const hub = pages.config(), origin = req.headers.origin
    // (the iPhone app published by the GitHub Actions workflow lives on <owner>.github.io; every call still needs the key or the QR token)
    if (origin && (origin === APK_ORIGIN || (hub && origin === hub.origin) || /^https:\/\/[\w-]+\.github\.io$/i.test(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, x-trade-key', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '86400' })
        return res.end()
      }
    }
    return api(req, res, url).catch(e => json(res, 400, { error: e.message }))
  }
  // Only the copy on GitHub Pages has a hub address (written by npm run pages)
  if (url === '/hub-config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' }); return res.end('') }
  let base = root, rel = url === '/' ? 'index.html' : url
  if (url.startsWith('/utils/')) { base = utils; rel = url.slice('/utils/'.length) }
  const p = path.join(base, rel)
  if (!p.startsWith(base) || /mailer\.js|serve\.js|build\.js|make-icons\.js|datastore\.js|scanner\.js|publish\.js|autostart\.js|github\.js/.test(rel)) { res.writeHead(403); return res.end() }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found') }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    res.end(data)
  })
})
server.on('error', e => {
  console.log(e.code === 'EADDRINUSE' ? 'Port ' + port + ' is used by another program. Close it, or start Trade on another port: node preview/serve.js 5180' : 'Server error: ' + e.message)
  process.exit(1)
})
server.listen(port, '0.0.0.0', () => {
  console.log('Trade web app: http://localhost:' + port)
  Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal)
    .forEach(i => console.log('On your phone (same Wi-Fi): http://' + i.address + ':' + port))
  const c = readConfig()
  console.log(c ? 'Email: sending from ' + c.from : 'Email: not set up (Settings → Email)')
  const st = store.stats()
  console.log('Data is kept in ' + store.DIR + ' (' + st.products + ' products, ' + st.wishes + ' wishes), daily copies in data/backups')
  console.log(aiReady() ? 'AI scanner: ready' : 'AI scanner: not set up (Settings → AI scanner)')
  store.snapshot(true)
  console.log(github.config() ? 'GitHub: saving to ' + github.config().owner + '/' + github.config().repo : 'GitHub: not set up (Settings → Your data → GitHub)')
  github.start()
  if (IPHONE) startTunnel()
  // Every update of the app reaches the iPhones by itself: the newest version is put on GitHub Pages at start
  if (pages.config()) pages.publishApp().then(r => console.log('iPhone app: ' + r)).catch(e => console.log('iPhone app not updated:', e.message))
})

// Secure address for iPhones: https://<random>.trycloudflare.com → this computer. It changes every time Trade starts.
let stopping = false
process.on('exit', () => { stopping = true })
function startTunnel() {
  const { spawn } = require('child_process')
  const cf = process.env.CLOUDFLARED || 'cloudflared'
  console.log('iPhone: opening a secure address…')
  let p
  try { p = spawn(cf, ['tunnel', '--no-autoupdate', '--url', 'http://localhost:' + port], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) }
  catch (e) { return console.log('iPhone: cloudflared is not installed — https://developers.cloudflare.com/cloudflared/') }
  const read = d => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d))
    if (m && !publicUrl) {
      publicUrl = m[0] + '/'
      console.log('\niPhone address: ' + publicUrl)
      console.log('Open it in Safari on the iPhone (or scan the QR code in Trade → Settings on this computer), then Share → Add to Home Screen.\n')
      // iPhones installed from GitHub Pages find this computer here (encrypted with each pairing code)
      if (pages.config()) pages.publishAddress(store.keys(), publicUrl).then(() => console.log('iPhone: address published')).catch(e => console.log('iPhone: address not published:', e.message))
    }
  }
  p.stdout.on('data', read); p.stderr.on('data', read)
  p.on('error', () => console.log('iPhone: cloudflared is not installed — https://developers.cloudflare.com/cloudflared/'))
  p.on('exit', code => {
    publicUrl = ''
    if (code) console.log('iPhone: the secure address closed (code ' + code + ')')
    if (!stopping && code !== null) setTimeout(startTunnel, 15000) // a new address; iPhones find it by themselves
  })
  process.on('exit', () => { try { p.kill() } catch (e) {} })
}
