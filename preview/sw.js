// Service worker: keeps the app working offline once it has been opened.
// Network first for the app files (so updates arrive), cache as fallback.
const CACHE = 'trade-v31'
const SHELL = [
  './', 'index.html', 'remote.js', 'hub-config.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'utils/zip.js', 'utils/pdf.js', 'utils/xlsx.js', 'utils/report.js', 'utils/icons.js', 'utils/themes.js', 'utils/similar.js', 'utils/i18n.js', 'utils/jsqr.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'trade-models' && k !== CACHE + '-tiles').map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Sync, pairing, AI and backups always go to the computer — never answered from the cache
  if (url.origin === location.origin && url.pathname.includes('/api/')) return
  // Where the computer is now (written by the computer on GitHub Pages): always fresh, never kept
  if (url.origin === location.origin && url.pathname.includes('/hub/')) return
  // Map tiles: cache first (saves data), app files: network first
  const tile = /autonavi\.com/.test(url.host)
  // Photo auto-crop detector (scripts + model files): downloaded once, then always from the phone
  const model = /cdn\.jsdelivr\.net/.test(url.host) || (url.host === 'storage.googleapis.com' && url.pathname.startsWith('/tfjs-models/'))
  if (model) {
    e.respondWith(caches.open('trade-models').then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r }))))
    return
  }
  if (url.origin !== location.origin && !tile && !/cdnjs\.cloudflare\.com/.test(url.host)) return
  if (tile) {
    e.respondWith(caches.open(CACHE + '-tiles').then(c => c.match(req).then(hit => hit || fetch(req).then(r => { c.put(req, r.clone()); return r }))))
    return
  }
  // Saved copy: used when there is no network, the address is gone (an old iPhone tunnel answers with an error page)
  // or the network is too slow — so the installed app always opens.
  const saved = () => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html').then(h => h || caches.match('./')) : undefined))
  const net = fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r }
    return saved().then(hit => hit || r)
  })
  const slow = new Promise(ok => setTimeout(ok, url.origin === location.origin ? 4000 : 8000)).then(() => saved().then(hit => hit || net))
  e.respondWith(Promise.race([net.catch(() => saved().then(hit => hit || Response.error())), slow]))
})
