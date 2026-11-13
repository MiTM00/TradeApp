// What the iPhone saved in its private GitHub repository, fetched now — for Claude Code (and anyone) working on Trade.
// `npm run data` prints a summary. Claude Code runs it by itself (.claude/settings.json hooks):
//   --hook     at the start of a session: always prints the summary (it goes into Claude's context)
//   --changes  before each message: fetches, prints only when the iPhone saved something new
// When the Trade server is running it asks the server to fetch (one writer per data folder); otherwise it fetches itself.
// If nothing is in the repository yet it says so: "NOT DONE YET (wali lama samayn)".
const fs = require('fs'), path = require('path')
const store = require('./datastore')
const github = require('./github')

const mode = process.argv.includes('--changes') ? 'changes' : process.argv.includes('--hook') ? 'hook' : 'cli'
const STATE = path.join(store.DIR, 'github.json')
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')).shas || {} } catch (e) { return {} } }

function serverPort() {
  try {
    const l = JSON.parse(fs.readFileSync(path.join(store.DIR, 'server.lock'), 'utf8'))
    process.kill(l.pid, 0); return l.port
  } catch (e) { return 0 }
}

async function fetchNow() {
  const port = serverPort()
  if (port) {
    try {
      const r = await fetch('http://localhost:' + port + '/api/github/sync', { method: 'POST', signal: AbortSignal.timeout(25000) })
      if (r.ok) return await r.json()
    } catch (e) {}
  }
  if (port) return github.status() // server busy or old version: read what it already has, never write next to it
  await github.run()
  return github.status()
}

const when = t => t ? new Date(Number(t)).toISOString().replace('T', ' ').slice(0, 16) : ''
function summary(st, shas) {
  const inRepo = k => Object.keys(shas).filter(p => p.startsWith(k + '/')).length
  const recs = store.allRecords()
  const live = k => recs.filter(([kind, r]) => kind === k && !r.deleted).map(([, r]) => r)
  const products = live('products').sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  const out = []
  out.push('Trade data from the iPhone repository ' + st.owner + '/' + st.repo + (st.last ? ' (fetched ' + when(st.last) + ' UTC)' : ''))
  if (st.error) out.push('Warning: ' + st.error + ' — showing the last copy fetched.')
  out.push('In the repository: ' + ['products', 'markets', 'wishes', 'trash'].map(k => inRepo(k) + ' ' + k).join(', '))
  out.push('Local copy in data/: ' + products.length + ' products, ' + live('markets').length + ' markets, ' + live('wishes').length + ' wishes, ' + live('trash').length + ' in Trash')
  products.slice(0, 40).forEach(p => {
    const price = p.price != null && p.price !== '' ? ' · ' + (p.currency || '¥') + p.price + (p.minOrder ? ' (MOQ ' + p.minOrder + ' ' + (p.unit || '') + ')' : '') : ''
    out.push('- ' + (p.name || '(no name)') + price + (p.marketName ? ' · ' + p.marketName : '') + (p.shopName ? ' · shop ' + p.shopName : '') + ' · ' + when(p.updatedAt) + '  [data/products/' + p.id + '.json]')
  })
  if (products.length > 40) out.push('… and ' + (products.length - 40) + ' more in data/products/')
  return out.join('\n')
}

;(async () => {
  const before = JSON.stringify(readState())
  let st
  try { st = await fetchNow() } catch (e) { st = Object.assign(github.status(), { error: e.message }) }
  const shas = readState()
  const changed = JSON.stringify(shas) !== before
  const notYet = !st.configured
    ? 'NOT DONE YET (wali lama samayn): this computer is not connected to the iPhone\'s GitHub repository, so no iPhone data has been read. On the iPhone: Settings → Storage → GitHub → Link for the computer, then open that link on this computer (or link the iPhone by scanning the QR code).'
    : !Object.keys(shas).some(p => /^(products|markets|wishes|trash)\//.test(p))
      ? (st.error ? 'NOT DONE YET (wali lama samayn): could not read ' + st.owner + '/' + st.repo + ' — ' + st.error
        : 'NOT DONE YET (wali lama samayn): the repository ' + st.owner + '/' + st.repo + ' has nothing from the iPhone yet.')
      : ''
  if (mode === 'changes') {
    if (changed && !notYet) console.log('The iPhone saved new data to the repository; data/ is now up to date.\n' + summary(st, shas))
  } else console.log(notYet || summary(st, shas))
  process.exit(0)
})()
