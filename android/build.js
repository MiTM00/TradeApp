// Builds the Android app: node android/build.js  →  android/Trade.apk
// Needs the Android SDK (platform 35 + build-tools) and a JDK 17. No Gradle: aapt2, javac, d8, zipalign, apksigner.
// The signing key is created once in android/trade.keystore — keep that file (and keystore.properties):
// every update must be signed with the same key, or the phone refuses to install it over the old app.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto')
const { execFileSync } = require('child_process')

const here = __dirname, root = path.join(here, '..'), out = path.join(here, 'build'), dist = here
const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(local, 'Android', 'Sdk')
const newest = dir => fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
const platform = path.join(SDK, 'platforms', newest(path.join(SDK, 'platforms')))
const tools = path.join(SDK, 'build-tools', newest(path.join(SDK, 'build-tools')))
const androidJar = path.join(platform, 'android.jar')
function findJdk() {
  const cands = [process.env.JAVA_HOME]
  const progs = path.join(local, 'Programs')
  if (fs.existsSync(progs)) fs.readdirSync(progs).filter(d => /^jdk-?1[7-9]|^jdk-?2\d/.test(d)).forEach(d => cands.push(path.join(progs, d)))
  const j = cands.find(d => d && fs.existsSync(path.join(d, 'bin', 'javac' + (process.platform === 'win32' ? '.exe' : ''))))
  if (!j) throw new Error('JDK 17 not found — set JAVA_HOME')
  return j
}
const JDK = findJdk()
const win = process.platform === 'win32'
const exe = (dir, n) => path.join(dir, n + (win ? '.exe' : ''))
const bat = (dir, n) => path.join(dir, n + (win ? '.bat' : ''))
const env = Object.assign({}, process.env, { JAVA_HOME: JDK, PATH: path.join(JDK, 'bin') + path.delimiter + process.env.PATH })
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], env, shell: win && /\.bat$/.test(cmd) })

// Version: from package.json; versionCode grows with every build so the phone installs it as an update
const pkg = require(path.join(root, 'package.json'))
const versionName = pkg.version
const versionCode = String(Math.floor(Date.now() / 60000) - 29000000)

fs.rmSync(out, { recursive: true, force: true })
const mk = d => (fs.mkdirSync(d, { recursive: true }), d)
const copy = (a, b) => { mk(path.dirname(b)); fs.copyFileSync(a, b) }

// 1. The web app, built in
const www = mk(path.join(out, 'assets', 'www'))
;['index.html', 'android.js', 'remote.js', 'manifest.webmanifest', 'sw.js'].forEach(f => copy(path.join(root, 'preview', f), path.join(www, f)))
fs.readdirSync(path.join(root, 'preview', 'icons')).forEach(f => copy(path.join(root, 'preview', 'icons', f), path.join(www, 'icons', f)))
;['zip', 'pdf', 'xlsx', 'report', 'icons', 'themes', 'similar', 'i18n', 'jsqr'].forEach(f => copy(path.join(root, 'utils', f + '.js'), path.join(www, 'utils', f + '.js')))

// 2. Resources (+ the app icon from the web app's icons)
const res = path.join(out, 'res')
fs.cpSync(path.join(here, 'res'), res, { recursive: true })
copy(path.join(root, 'preview', 'icons', 'icon-192.png'), path.join(res, 'mipmap-xxxhdpi', 'ic_launcher.png'))
copy(path.join(root, 'preview', 'icons', 'icon-maskable-512.png'), path.join(res, 'drawable-nodpi', 'ic_fg.png'))
const flat = path.join(out, 'res.zip')
run(exe(tools, 'aapt2'), ['compile', '--dir', res, '-o', flat])
const gen = mk(path.join(out, 'gen')), base = path.join(out, 'base.apk')
run(exe(tools, 'aapt2'), ['link', '-o', base, '-I', androidJar, '--manifest', path.join(here, 'AndroidManifest.xml'),
  '--java', gen, '--min-sdk-version', '24', '--target-sdk-version', '35',
  '--version-code', versionCode, '--version-name', versionName, '--auto-add-overlay', flat])

// 3. Java → dex
const classes = mk(path.join(out, 'classes'))
const sources = []
const walk = d => fs.readdirSync(d).forEach(f => { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.java$/.test(f) && sources.push(p) })
walk(path.join(here, 'src')); walk(gen)
run(exe(path.join(JDK, 'bin'), 'javac'), ['-nowarn', '-Xlint:-options', '-source', '8', '-target', '8', '-encoding', 'UTF-8', '-bootclasspath', androidJar + path.delimiter + path.join(tools, 'core-lambda-stubs.jar'), '-d', classes, ...sources])
const classFiles = []
const walkC = d => fs.readdirSync(d).forEach(f => { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walkC(p) : classFiles.push(p) })
walkC(classes)
const dex = mk(path.join(out, 'dex'))
run(bat(tools, 'd8'), ['--release', '--min-api', '24', '--lib', androidJar, '--output', dex, ...classFiles])
// classes.dex and the web app (jar writes zip paths with /, aapt2 on Windows would write backslashes)
run(exe(path.join(JDK, 'bin'), 'jar'), ['-u', '-M', '-f', base, '-C', dex, 'classes.dex', '-C', out, 'assets'])

// 4. Align and sign
const aligned = path.join(out, 'aligned.apk')
run(exe(tools, 'zipalign'), ['-p', '-f', '4', base, aligned])
const ks = path.join(here, 'trade.keystore'), props = path.join(here, 'keystore.properties')
if (!fs.existsSync(ks)) {
  const pass = crypto.randomBytes(18).toString('base64url')
  run(exe(path.join(JDK, 'bin'), 'keytool'), ['-genkeypair', '-keystore', ks, '-storepass', pass, '-keypass', pass, '-alias', 'trade',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Trade'])
  fs.writeFileSync(props, 'storePassword=' + pass + '\nalias=trade\n')
  console.log('Created the signing key android/trade.keystore — keep it (and keystore.properties) safe: updates need it.')
}
const pass = /storePassword=(.*)/.exec(fs.readFileSync(props, 'utf8'))[1].trim()
mk(dist)
const apk = path.join(dist, 'Trade.apk')
run(bat(tools, 'apksigner'), ['sign', '--ks', ks, '--ks-key-alias', 'trade', '--ks-pass', 'pass:' + pass, '--key-pass', 'pass:' + pass, '--out', apk, aligned])
run(bat(tools, 'apksigner'), ['verify', apk])
try { fs.unlinkSync(apk + '.idsig') } catch (e) {}
console.log('Built ' + apk + ' (' + (fs.statSync(apk).size / 1048576).toFixed(1) + ' MB, version ' + versionName + ' / ' + versionCode + ')')
