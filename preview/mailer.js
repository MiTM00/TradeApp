// Minimal SMTP client (no dependencies): sends one email with an attachment.
// Supports implicit TLS (port 465), STARTTLS (587) and plain (local testing only).
const net = require('net'), tls = require('tls'), crypto = require('crypto')

const PRESETS = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  outlook: { host: 'smtp.office365.com', port: 587, starttls: true },
  qq: { host: 'smtp.qq.com', port: 465, secure: true },
  '163': { host: 'smtp.163.com', port: 465, secure: true },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: true }
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64')
const word = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64(s) + '?='
const wrap = s => s.replace(/.{1,76}/g, '$&\r\n')
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/

function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

// A clean HTML version of the message with the report figures
function htmlBody(m) {
  const brand = /^#[0-9a-f]{6}$/i.test(m.brand || '') ? m.brand : '#0F766E'
  const rows = (m.stats || []).map(([k, v]) => `<tr><td style="padding:8px 0;color:#64748B;font-size:13px">${escHtml(k)}</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0F172A;font-size:14px">${escHtml(v)}</td></tr>`).join('')
  return `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${brand};padding:24px 28px;color:#fff"><div style="font-size:12px;letter-spacing:1px;opacity:.8">TRADE</div><div style="font-size:22px;font-weight:800;margin-top:4px">${escHtml(m.title || m.subject)}</div></td></tr>
<tr><td style="padding:24px 28px;color:#334155;font-size:14px;line-height:1.6">${escHtml(m.text).replace(/\n/g, '<br>')}
${rows ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #E2E8F0">${rows}</table>` : ''}
<div style="margin-top:20px;padding:12px 14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;font-size:13px">📎 ${escHtml(m.attachedText || (m.filename + ' is attached.'))}</div>
</td></tr></table></td></tr></table></body></html>`
}

function buildMessage(cfg, m) {
  const id = crypto.randomBytes(12).toString('hex')
  const b1 = 'mix_' + id, b2 = 'alt_' + id
  const from = (cfg.fromName ? word(cfg.fromName) + ' ' : '') + '<' + cfg.from + '>'
  const head = [
    'From: ' + from,
    'To: ' + m.to.join(', '),
    'Subject: ' + word(m.subject),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + id + '@trade.app>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="' + b1 + '"'
  ]
  if (m.replyTo) head.push('Reply-To: ' + m.replyTo)
  const fname = word(m.filename)
  return head.join('\r\n') + '\r\n\r\n' +
    '--' + b1 + '\r\nContent-Type: multipart/alternative; boundary="' + b2 + '"\r\n\r\n' +
    '--' + b2 + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap(b64(m.text)) +
    '--' + b2 + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap(b64(htmlBody(m))) +
    '--' + b2 + '--\r\n' +
    '--' + b1 + '\r\nContent-Type: ' + m.contentType + '; name="' + fname + '"\r\nContent-Disposition: attachment; filename="' + fname + '"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    wrap(m.data.replace(/\s+/g, '')) +
    '--' + b1 + '--\r\n'
}

// Reads SMTP replies (multi-line "250-..." until "250 ...")
function reader(sock) {
  let buf = '', waiting = null, lines = []
  const onData = d => {
    buf += d.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1)
      lines.push(line)
      if (/^\d{3} /.test(line) && waiting) { const w = waiting; waiting = null; const all = lines; lines = []; w.resolve({ code: +line.slice(0, 3), text: all.join('\n') }) }
    }
  }
  sock.on('data', onData)
  return {
    next: () => new Promise((resolve, reject) => { waiting = { resolve, reject } }),
    fail: e => { if (waiting) { const w = waiting; waiting = null; w.reject(e) } },
    detach: () => sock.removeListener('data', onData)
  }
}

function send(cfg, m) {
  cfg = Object.assign({}, PRESETS[cfg.provider] || {}, cfg)
  if (!cfg.host || !cfg.from) return Promise.reject(new Error('Email is not set up'))
  m.to = [].concat(m.to || []).map(s => String(s).trim()).filter(Boolean)
  if (!m.to.length) return Promise.reject(new Error('Enter at least one email address'))
  const bad = m.to.find(a => !EMAIL.test(a))
  if (bad) return Promise.reject(new Error('Not a valid email address: ' + bad))
  if (m.to.length > 10) return Promise.reject(new Error('At most 10 recipients'))
  const raw = buildMessage(cfg, m)

  return new Promise((resolve, reject) => {
    let sock = cfg.secure ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : net.connect({ host: cfg.host, port: cfg.port })
    let rd = reader(sock), finished = false
    const timer = setTimeout(() => done(new Error('The email server did not answer (timeout)')), 45000)
    function done(err, res) {
      if (finished) return
      finished = true; clearTimeout(timer)
      try { sock.end() } catch (e) {}
      err ? reject(err) : resolve(res)
    }
    const onErr = e => { rd.fail(e); done(new Error('Could not connect to ' + cfg.host + ': ' + e.message)) }
    sock.on('error', onErr)
    sock.setTimeout(45000, () => done(new Error('Connection timed out')))
    const write = s => sock.write(s + '\r\n')
    async function expect(cmd, ok, label) {
      if (cmd != null) write(cmd)
      const r = await rd.next()
      if (ok.indexOf(r.code) < 0) throw new Error((label || 'Email server') + ' refused: ' + r.text.split('\n').pop())
      return r
    }
    ;(async () => {
      await expect(null, [220], 'Greeting')
      const host = 'trade.local'
      let ehlo = await expect('EHLO ' + host, [250], 'EHLO')
      if (!cfg.secure && cfg.starttls) {
        await expect('STARTTLS', [220], 'STARTTLS')
        rd.detach(); sock.removeListener('error', onErr)
        sock = tls.connect({ socket: sock, servername: cfg.host })
        sock.on('error', onErr)
        await new Promise((ok, no) => { sock.once('secureConnect', ok); sock.once('error', no) })
        rd = reader(sock)
        ehlo = await expect('EHLO ' + host, [250], 'EHLO')
      }
      if (cfg.user && cfg.pass) {
        if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo.text)) await expect('AUTH PLAIN ' + Buffer.from('\0' + cfg.user + '\0' + cfg.pass).toString('base64'), [235], 'Login')
        else {
          await expect('AUTH LOGIN', [334], 'Login')
          await expect(b64(cfg.user), [334], 'Login')
          await expect(b64(cfg.pass), [235], 'Login (check the email and app password)')
        }
      }
      await expect('MAIL FROM:<' + cfg.from + '>', [250], 'Sender')
      for (const a of m.to) await expect('RCPT TO:<' + a + '>', [250, 251], 'Recipient ' + a)
      await expect('DATA', [354], 'DATA')
      sock.write(raw.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n')
      const r = await expect(null, [250], 'Sending')
      try { write('QUIT') } catch (e) {}
      done(null, { accepted: m.to, response: r.text })
    })().catch(e => done(e))
  })
}

module.exports = { send, PRESETS, EMAIL, buildMessage }
