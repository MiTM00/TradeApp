// Builds a static copy of the web app in /dist, ready to upload to any HTTPS host
// (GitHub Pages, Netlify, Cloudflare Pages…): node preview/build.js
const fs = require('fs'), path = require('path')
const root = path.join(__dirname, '..'), out = path.join(root, 'dist')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'utils'), { recursive: true })
fs.mkdirSync(path.join(out, 'icons'), { recursive: true })
;['index.html', 'remote.js', 'manifest.webmanifest', 'sw.js'].forEach(f => fs.copyFileSync(path.join(__dirname, f), path.join(out, f)))
fs.readdirSync(path.join(__dirname, 'icons')).forEach(f => fs.copyFileSync(path.join(__dirname, 'icons', f), path.join(out, 'icons', f)))
;['zip', 'pdf', 'xlsx', 'report', 'icons', 'themes', 'similar', 'i18n', 'jsqr'].forEach(f => fs.copyFileSync(path.join(root, 'utils', f + '.js'), path.join(out, 'utils', f + '.js')))
fs.writeFileSync(path.join(out, '.nojekyll'), '')
// index.html loads hub-config.js (where to find the computer). Without a computer it is empty, so the app runs on its own.
const hub = process.env.TRADE_HUB_REPO ? process.env.TRADE_HUB_REPO.split('/') : null
fs.writeFileSync(path.join(out, 'hub-config.js'), hub
  ? 'window.TRADE_HUB = ' + JSON.stringify({ owner: hub[0], repo: hub[1] }) + ';\n'
  : '// No computer configured: the app works fully on the phone\n')
// Live update: one id for this build (from the content of every file), put into index.html and sw.js and written to
// version.json — the iPhone compares it every 30 s and updates itself when it changes
const crypto = require('crypto')
const files = []
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : files.push(f) })
walk(out)
const h = crypto.createHash('sha256')
files.sort().forEach(f => { h.update(path.relative(out, f)); h.update(fs.readFileSync(f)) })
const id = h.digest('hex').slice(0, 12)
const put = (f, from, to) => { const p = path.join(out, f), s = fs.readFileSync(p, 'utf8'); if (!s.includes(from)) throw new Error(f + ': ' + from + ' not found'); fs.writeFileSync(p, s.replace(from, to)) }
put('index.html', "const BUILD = 'dev';", "const BUILD = '" + id + "';")
const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8').replace(/const CACHE = '[^']*'/, "const CACHE = 'trade-" + id + "'")
fs.writeFileSync(path.join(out, 'sw.js'), sw)
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ v: id, at: Date.now() }))
console.log('Built', out, 'version', id)
