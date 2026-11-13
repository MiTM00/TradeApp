// Secure (https) address on the local Wi-Fi, so the iPhone app (on https GitHub Pages) can reach this computer
// directly: Safari blocks a plain http address from an https page.
// This computer makes its own small certificate authority once ("Trade on <computer>"). The iPhone installs and
// trusts it once (Settings → General → About → Certificate Trust Settings). Every Wi-Fi address of this computer
// then gets a certificate signed by it, made again by itself when the address changes.
// No library needed: the certificates are written here in DER (X.509 v3) and signed with Node's crypto.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os')

const DIR = process.env.TRADE_CERT_DIR || path.join(__dirname, '..', 'certs')

// ---- DER ----
function len(n) {
  if (n < 128) return Buffer.from([n])
  const b = []; while (n) { b.unshift(n & 255); n >>= 8 }
  return Buffer.from([0x80 | b.length, ...b])
}
const tlv = (tag, ...parts) => { const c = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p))); return Buffer.concat([Buffer.from([tag]), len(c.length), c]) }
const seq = (...p) => tlv(0x30, ...p)
const set = (...p) => tlv(0x31, ...p)
function int(buf) { if (typeof buf === 'number') buf = Buffer.from([buf]); if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]); return tlv(0x02, buf) }
function oid(s) {
  const n = s.split('.').map(Number), out = [40 * n[0] + n[1]]
  n.slice(2).forEach(v => { const b = [v & 127]; v >>= 7; while (v) { b.unshift(0x80 | (v & 127)); v >>= 7 } out.push(...b) })
  return tlv(0x06, Buffer.from(out))
}
const utf8 = s => tlv(0x0c, Buffer.from(s, 'utf8'))
const bits = (buf, unused = 0) => tlv(0x03, Buffer.from([unused]), buf)
const octets = buf => tlv(0x04, buf)
const bool = v => tlv(0x01, Buffer.from([v ? 0xff : 0]))
function time(d) {
  const p = x => String(x).padStart(2, '0')
  const s = p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z'
  const y = d.getUTCFullYear()
  return y < 2050 ? tlv(0x17, Buffer.from(String(y).slice(2) + s)) : tlv(0x18, Buffer.from(y + s))
}
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]))
const name = (cn, org) => seq(set(seq(oid('2.5.4.10'), utf8(org))), set(seq(oid('2.5.4.3'), utf8(cn))))
const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value))
const keyId = spki => crypto.createHash('sha1').update(spki).digest()

function cert({ subject, issuer, spki, signKey, issuerSpki, days, ca, names = [], ips = [] }) {
  const now = Date.now()
  const exts = [
    ext('2.5.29.19', true, ca ? seq(bool(true), int(0)) : seq()), // basic constraints (CA, no sub-CAs)
    ext('2.5.29.15', true, ca ? bits(Buffer.from([0x86]), 1) : bits(Buffer.from([0xa0]), 5)), // key usage
    ext('2.5.29.14', false, octets(keyId(spki))),
    ext('2.5.29.35', false, seq(tlv(0x80, keyId(issuerSpki || spki))))
  ]
  if (!ca) {
    exts.push(ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1')))) // server authentication
    exts.push(ext('2.5.29.17', false, seq(...names.map(n => tlv(0x82, Buffer.from(n))), ...ips.map(ip => tlv(0x87, Buffer.from(ip.split('.').map(Number)))))))
  }
  const serial = crypto.randomBytes(12); serial[0] &= 0x7f
  const tbs = seq(
    tlv(0xa0, int(2)), int(serial), SHA256_RSA, issuer,
    seq(time(new Date(now - 864e5)), time(new Date(now + days * 864e5))),
    subject, spki, tlv(0xa3, seq(...exts))
  )
  return seq(tbs, SHA256_RSA, bits(crypto.sign('sha256', tbs, signKey)))
}
const pem = der => '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n'
const newKey = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const spkiOf = k => k.publicKey.export({ type: 'spki', format: 'der' })

// ---- the computer's own authority (made once, kept in certs/) ----
let caCache = null
function ca() {
  if (caCache) return caCache
  fs.mkdirSync(DIR, { recursive: true })
  const kf = path.join(DIR, 'trade-ca.key'), cf = path.join(DIR, 'trade-ca.cer')
  try { caCache = { key: crypto.createPrivateKey(fs.readFileSync(kf)), der: fs.readFileSync(cf) }; caCache.spki = crypto.createPublicKey(caCache.key).export({ type: 'spki', format: 'der' }); return caCache } catch (e) {}
  const k = newKey(), spki = spkiOf(k)
  const n = name('Trade on ' + os.hostname(), 'Trade')
  const der = cert({ subject: n, issuer: n, spki, signKey: k.privateKey, days: 3650, ca: true })
  fs.writeFileSync(kf, k.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  fs.writeFileSync(cf, der)
  caCache = { key: k.privateKey, der, spki }
  return caCache
}
// The certificate the iPhone installs (DER, Safari offers to install it as a profile)
const caDer = () => ca().der
const caName = () => 'Trade on ' + os.hostname()
const caFingerprint = () => crypto.createHash('sha256').update(ca().der).digest('hex').slice(0, 16).toUpperCase().match(/.{4}/g).join(' ')

// ---- a certificate for this computer's current addresses ----
function ipv4s() { return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address) }
function server() {
  const c = ca(), k = newKey(), spki = spkiOf(k), ips = ['127.0.0.1'].concat(ipv4s())
  const host = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '')
  const names = ['localhost'].concat(host ? [host + '.local'] : [])
  // Apple accepts at most 825 days for certificates from an authority the user trusts
  const der = cert({ subject: name(host || 'trade', 'Trade'), issuer: name(caName(), 'Trade'), spki, signKey: c.key, issuerSpki: c.spki, days: 800, names, ips })
  return { key: k.privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem(der) + pem(c.der), ips: ipv4s().join(',') }
}

module.exports = { caDer, caName, caFingerprint, server, ipv4s, DIR }
