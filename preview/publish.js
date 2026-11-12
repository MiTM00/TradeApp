// GitHub Pages: the iPhone app at a permanent https address, updated by itself.
//   npm run pages   → first time: creates the GitHub repository, turns Pages on, publishes the app
// After that the Trade server (node preview/serve.js) publishes the newest app every time it starts, and tells the
// iPhones where this computer is: its secure address (it changes every start) is written next to the app in
// hub/<fingerprint>.json, encrypted with the phone's pairing code, so only that phone can read it.
// Needs the GitHub CLI signed in once: gh auth login
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const { execFile } = require('child_process')
const root = path.join(__dirname, '..')
const CFG = process.env.TRADE_HUB_CONFIG || path.join(root, 'hub.config.json')
const WORK = path.join(root, '.publish') // a copy of the gh-pages branch
const BRANCH = 'gh-pages'

function config() {
  try { const c = JSON.parse(fs.readFileSync(CFG, 'utf8')); return c && c.owner && c.repo ? c : null } catch (e) { return null }
}
const run = (cmd, args, opts) => new Promise((ok, no) => {
  // never wait for a password prompt (the server runs hidden): GitHub sign-in comes from gh auth setup-git
  const env = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' })
  execFile(cmd, args, Object.assign({ windowsHide: true, maxBuffer: 64 * 1024 * 1024, cwd: root, env }, opts), (err, out, errOut) => {
    if (err) { err.message = (String(errOut || '').trim() || err.message).split('\n').slice(-3).join(' '); return no(err) }
    ok(String(out).trim())
  })
})
function gh(args, input) {
  return new Promise((ok, no) => {
    const p = execFile('gh', args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, cwd: root }, (err, out, errOut) => {
      if (err) { err.message = (String(errOut || '').trim() || err.message).split('\n').slice(-2).join(' '); return no(err) }
      ok(String(out).trim())
    })
    if (input != null) { p.stdin.write(input); p.stdin.end() }
  })
}
const git = (args, cwd) => run('git', args, { cwd: cwd || WORK })

// Same fingerprint as GET /api/sync/hello (never the code itself)
const fingerprint = key => crypto.createHash('sha256').update('trade-id:' + key).digest('hex').slice(0, 24)
// AES-GCM with a key made from the pairing code; the phone opens it with WebCrypto (ciphertext followed by the tag)
function seal(code, obj) {
  const k = crypto.createHash('sha256').update('trade-hub:' + code).digest(), iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', k, iv)
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()])
  return { v: 1, iv: iv.toString('base64'), data: data.toString('base64') }
}

// Tell the phones where this computer is now (one small file per pairing code)
async function publishAddress(codes, url) {
  const c = config(); if (!c) return
  for (const code of codes) {
    const file = 'hub/' + fingerprint(code) + '.json'
    let sha = ''
    try { sha = await gh(['api', `repos/${c.owner}/${c.repo}/contents/${file}?ref=${BRANCH}`, '--jq', '.sha']) } catch (e) {}
    const body = { message: 'Computer address', branch: BRANCH, content: Buffer.from(JSON.stringify(seal(code, { url, at: Date.now() }))).toString('base64') }
    if (sha) body.sha = sha
    await gh(['api', '-X', 'PUT', `repos/${c.owner}/${c.repo}/contents/${file}`, '--input', '-'], JSON.stringify(body))
  }
}

// Build the app and put it on GitHub Pages if anything changed → a short report
async function publishApp() {
  const c = config(); if (!c) throw new Error('Not set up — run: npm run pages')
  try { await gh(['auth', 'status']) } catch (e) { throw new Error('GitHub is not signed in on this computer — run: gh auth login') }
  await run(process.execPath, [path.join(__dirname, 'build.js')])
  const dist = path.join(root, 'dist'), remote = `https://github.com/${c.owner}/${c.repo}.git`
  if (!fs.existsSync(path.join(WORK, '.git'))) {
    fs.mkdirSync(WORK, { recursive: true })
    await git(['init', '-q'])
    await git(['remote', 'add', 'origin', remote])
  }
  await git(['remote', 'set-url', 'origin', remote])
  await git(['config', 'user.name', c.owner]); await git(['config', 'user.email', c.owner + '@users.noreply.github.com'])
  // start from what is online (keeps the hub/ files the server wrote)
  let online = true
  try { await git(['fetch', '-q', 'origin', BRANCH]) } catch (e) { online = false }
  if (online) await git(['checkout', '-q', '-B', BRANCH, 'origin/' + BRANCH]), await git(['reset', '-q', '--hard', 'origin/' + BRANCH])
  else await git(['checkout', '-q', '-B', BRANCH])
  for (const f of fs.readdirSync(WORK)) if (f !== '.git' && f !== 'hub') fs.rmSync(path.join(WORK, f), { recursive: true, force: true })
  fs.cpSync(dist, WORK, { recursive: true })
  fs.writeFileSync(path.join(WORK, 'hub-config.js'), '// Written by preview/publish.js: where the app finds the Trade computer\nwindow.TRADE_HUB = ' + JSON.stringify({ owner: c.owner, repo: c.repo }) + ';\n')
  await git(['add', '-A'])
  if (!(await git(['status', '--porcelain']))) return 'already up to date (' + c.url + ')'
  await git(['commit', '-q', '-m', 'Trade app ' + new Date().toISOString().slice(0, 16).replace('T', ' ')])
  await git(['push', '-q', 'origin', BRANCH])
  return 'updated (' + c.url + ')'
}

// First time: GitHub repository + Pages
async function setup() {
  try { await gh(['auth', 'status']) } catch (e) { console.log('Sign in to GitHub first:  gh auth login   (then run npm run pages again)'); process.exit(1) }
  const owner = await gh(['api', 'user', '--jq', '.login'])
  const repo = (process.argv[2] || (config() || {}).repo || 'trade-app').replace(/[^\w.-]/g, '')
  try { await gh(['repo', 'view', `${owner}/${repo}`, '--json', 'name']) }
  catch (e) {
    console.log('Creating the repository ' + owner + '/' + repo + ' (public: GitHub Pages is free for public repositories; it holds the app only, never your products)')
    await gh(['repo', 'create', `${owner}/${repo}`, '--public', '--description', 'Trade app (installed on iPhone from GitHub Pages)'])
  }
  await gh(['auth', 'setup-git'])
  const host = owner.toLowerCase() + '.github.io'
  const c = { owner, repo, origin: 'https://' + host, url: 'https://' + host + '/' + repo + '/' }
  fs.writeFileSync(CFG, JSON.stringify(c, null, 2))
  console.log('App: ' + await publishApp())
  try { await gh(['api', '-X', 'POST', `repos/${owner}/${repo}/pages`, '--input', '-'], JSON.stringify({ source: { branch: BRANCH, path: '/' } })); console.log('GitHub Pages turned on') }
  catch (e) { if (!/already|409/i.test(e.message)) console.log('GitHub Pages:', e.message) }
  console.log('\niPhone app address: ' + c.url + '\n(the first time GitHub needs about a minute before it opens)')
  console.log('Restart Trade (node preview/serve.js) — from now on it updates the iPhone app and tells the iPhone where this computer is.')
}

module.exports = { config, fingerprint, seal, publishAddress, publishApp }
if (require.main === module) setup().catch(e => { console.log('Failed:', e.message); process.exit(1) })
