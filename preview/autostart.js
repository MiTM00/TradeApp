// Starts the Trade server by itself every time you sign in to Windows, hidden (no window),
// so phones always find the computer and sync.
//   node preview/autostart.js        → turn on
//   node preview/autostart.js off    → turn off
// It writes one small file, Trade.vbs, in your Windows Startup folder. Delete that file to stop it too.
const fs = require('fs'), path = require('path'), os = require('os')
const { spawn } = require('child_process')

if (process.platform !== 'win32') { console.log('Auto-start is for Windows only.'); process.exit(1) }
const startup = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
const file = path.join(startup, 'Trade.vbs')
const root = path.join(__dirname, '..')

if (process.argv[2] === 'off') {
  if (fs.existsSync(file)) { fs.unlinkSync(file); console.log('Auto-start is off. Removed ' + file) }
  else console.log('Auto-start was already off.')
  process.exit(0)
}

const q = s => '""' + s + '""' // a quoted path inside a VBScript string
const vbs = [
  "' Trade: starts the Trade server hidden when you sign in (made by preview/autostart.js)",
  'Set sh = CreateObject("WScript.Shell")',
  'sh.CurrentDirectory = "' + root + '"',
  'sh.Run "' + q(process.execPath) + ' ' + q(path.join(root, 'preview', 'serve.js')) + '", 0, False',
  ''
].join('\r\n')
fs.mkdirSync(startup, { recursive: true })
fs.writeFileSync(file, vbs)
console.log('Auto-start is on: Trade starts by itself every time you sign in to Windows.')
console.log('File: ' + file + '  (turn off: node preview/autostart.js off)')

// Start it now as well, unless it is already running
const http = require('http')
http.get('http://localhost:5173/api/sync/hello', res => { res.resume(); console.log('Trade is already running on this computer.') })
  .on('error', () => {
    spawn('wscript.exe', [file], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    console.log('Trade started in the background: http://localhost:5173')
  })
