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
console.log('Built', out)
