// GitHub as the main copy of the data. The phone saves every record straight to a PRIVATE repository
// (<kind>/<id>.json, see Cloud in index.html); the Trade server on the computer reads and writes the same files,
// so the computer has everything the phone saved even when they were never on the same Wi-Fi.
// The usual phone ↔ computer sync over the network keeps working next to it. Newest change wins everywhere.
// Settings (owner, repo, token) are in github.config.json — keep that file private.
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const store = require('./datastore')

const CFG = process.env.TRADE_GITHUB_CONFIG || path.join(__dirname, '..', 'github.config.json')
const STATE = () => path.join(store.DIR, 'github.json') // sha of every file as last seen, so only changes are fetched
const PATH_RE = /^(products|markets|wishes|trash)\/([\w-]{1,80})\.json$/

function config() { try { const c = JSON.parse(fs.readFileSync(CFG, 'utf8')); return c && c.owner && c.repo && c.token ? c : null } catch (e) { return null } }
let state = null
function loadState() { if (!state) { try { state = JSON.parse(fs.readFileSync(STATE(), 'utf8')) } catch (e) { state = {} } state.shas = state.shas || {} } return state }
function saveState() { const tmp = STATE() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, STATE()) }

const status = { configured: false, last: 0, error: '', busy: false }
let etag = ''

async function api(c, p, opts) {
  opts = opts || {}
  return fetch((process.env.TRADE_GITHUB_API || 'https://api.github.com') + '/repos/' + c.owner + '/' + c.repo + p, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'trade-app' }, opts.headers)
  }))
}
// Same text as the phone writes: the record without the computer's revision number
const text = r => { const x = Object.assign({}, r); delete x._rev; return JSON.stringify(x) }
const blobSha = s => { const b = Buffer.from(s, 'utf8'); return crypto.createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex') }

// Checks the token and that the repository is private; saves the settings
async function setup(b) {
  let owner = String(b.owner || '').trim(), repo = String(b.repo || '').trim().replace(/\.git$/, ''), token = String(b.token || '').trim()
  const m = /github\.com\/([\w.-]+)\/([\w.-]+)/.exec(owner); if (m) { owner = m[1]; repo = repo || m[2].replace(/\.git$/, '') }
  const fail = msg => { const e = new Error(msg); e.status = 400; throw e }
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) fail('Type the GitHub user name and the repository name')
  if (!/^(github_pat_|ghp_|gho_)\w{20,}$/.test(token)) fail('This does not look like a GitHub token (it starts with github_pat_)')
  const r = await api({ owner, repo, token }, '')
  if (r.status === 401) fail('GitHub did not accept this token')
  if (r.status === 404) fail('Repository not found — check the name, and that the token may use it')
  const j = await r.json()
  if (!j.private) fail('This repository is public. Your products must go in a PRIVATE repository.')
  if (j.permissions && !j.permissions.push) fail('The token can read but not write. Give it Contents: Read and write.')
  fs.writeFileSync(CFG, JSON.stringify({ owner, repo, token, branch: j.default_branch || 'main' }, null, 2))
  state = { shas: {} }; saveState(); etag = ''
  status.configured = true; status.error = ''
  run()
}
function clear() { try { fs.unlinkSync(CFG) } catch (e) {} status.configured = false; status.error = ''; etag = '' }

// GitHub → computer: only files whose sha changed
async function pull(c) {
  const r = await api(c, '/git/trees/' + encodeURIComponent(c.branch) + '?recursive=1', { headers: etag ? { 'If-None-Match': etag } : {} })
  if (r.status === 304) return 0
  if (r.status === 409 || r.status === 404) return 0 // empty repository
  if (r.status === 401) throw new Error('GitHub did not accept this token')
  if (!r.ok) throw new Error('GitHub ' + r.status)
  const tree = await r.json(), st = loadState(), list = []
  for (const f of tree.tree || []) {
    if (f.type !== 'blob' || !PATH_RE.test(f.path) || st.shas[f.path] === f.sha) continue
    const b = await api(c, '/git/blobs/' + f.sha)
    if (!b.ok) throw new Error('GitHub ' + b.status)
    try { const [, kind] = PATH_RE.exec(f.path); list.push([kind, JSON.parse(Buffer.from((await b.json()).content, 'base64').toString('utf8'))]) } catch (e) {}
    st.shas[f.path] = f.sha
  }
  const applied = list.length ? store.applyMany(list) : 0
  saveState()
  etag = r.headers.get('etag') || ''
  if (applied) console.log('GitHub: ' + applied + ' change(s) from the phone')
  return applied
}

// Computer → GitHub: records whose text differs from the file on GitHub (e.g. added on the computer, or from an Android phone)
async function push(c) {
  const st = loadState()
  let sent = 0
  for (const [kind, rec] of store.allRecords()) {
    const p = kind + '/' + rec.id + '.json', s = text(rec), sha = blobSha(s)
    if (st.shas[p] === sha) continue
    const body = { message: (rec.deleted ? 'Delete ' : 'Save ') + kind.replace(/s$/, '') + ' ' + (rec.name || rec.id) + ' (computer)', content: Buffer.from(s, 'utf8').toString('base64'), branch: c.branch }
    if (st.shas[p]) body.sha = st.shas[p]
    let r = await api(c, '/contents/' + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r.status === 409 || r.status === 422) { etag = ''; return sent } // the phone wrote it meanwhile: read it first, next round
    if (r.status === 401) throw new Error('GitHub did not accept this token')
    if (r.status === 403 || r.status === 404) throw new Error('The token can read but not write. Give it Contents: Read and write.')
    if (!r.ok) throw new Error('GitHub ' + r.status)
    st.shas[p] = (await r.json()).content.sha
    saveState(); sent++
  }
  if (sent) { etag = ''; console.log('GitHub: saved ' + sent + ' record(s)') }
  return sent
}

let running = null
function run() {
  const c = config()
  status.configured = !!c
  if (!c) return Promise.resolve()
  if (running) return running
  running = (async () => {
    status.busy = true
    try { await pull(c); await push(c); status.last = Date.now(); status.error = '' }
    catch (e) { status.error = /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(e.message) ? 'GitHub cannot be reached — check the internet' : e.message; console.log('GitHub:', status.error) }
    finally { status.busy = false; running = null }
  })()
  return running
}

// Every 20 s, and right after a phone sent something over Wi-Fi
function start() {
  status.configured = !!config()
  run()
  setInterval(run, 20000)
  store.onChange(() => { clearTimeout(start.t); start.t = setTimeout(run, 1500) })
}

module.exports = { config, setup, clear, run, start, status: () => Object.assign({}, status, (({ owner, repo }) => ({ owner, repo }))(config() || {})) }
