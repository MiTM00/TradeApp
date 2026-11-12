// Runs only inside the Android app (Trade.apk). In a browser it does nothing.
// The APK has the app files built in, so the Trade computer is reached at the address the user typed
// (Settings → Use on another device). Saving, sharing and opening files go through the phone (TradeAndroid bridge).
(function () {
  const A = window.TradeAndroid;
  if (!A) return;
  const KEY = 'trade-server', LIST = 'trade-servers';
  const norm = s => {
    s = String(s || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    try { const u = new URL(s); if (!u.port && u.protocol === 'http:') u.port = '5173'; return u.origin + '/'; } catch (e) { return ''; }
  };
  const App = window.TradeApp = {
    android: true,
    server() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    setServer(s) { const v = norm(s); if (v) { try { localStorage.setItem(KEY, v); } catch (e) {} App.remember([v]); } return v; },
    // "http://192.168.1.5:5173/#pair=KEY" (the computer's pairing link) → { server, key }
    parseLink(s) { const m = /^\s*(\S+?)\/?#pair=([\w-]+)/.exec(String(s || '')); return m && norm(m[1]) ? { server: norm(m[1]), key: m[2] } : null; },
    version: () => { try { return A.version(); } catch (e) { return ''; } },
    // Every address the Trade computer has had (newest first), so a changed address is found again quickly
    known() { try { return JSON.parse(localStorage.getItem(LIST) || '[]'); } catch (e) { return []; } },
    remember(urls) {
      const v = [...new Set([].concat(urls || []).map(norm).concat(App.known()).filter(Boolean))].slice(0, 12);
      try { localStorage.setItem(LIST, JSON.stringify(v)); } catch (e) {}
    },
    // The computer's address changed (new Wi-Fi, hotspot, router gave it a new IP): look for it on this network.
    // A computer counts only if its fingerprint matches this phone's pairing key. → its address, or ''
    async find(key) {
      if (!key) return '';
      const id = await fingerprint(key);
      const hello = async (origin, ms) => {
        const c = new AbortController(), tm = setTimeout(() => c.abort(), ms);
        try { const r = await fetch0(origin + 'api/sync/hello', { cache: 'no-store', signal: c.signal }); const j = await r.json(); return j && j.trade && (j.ids || [j.id]).includes(id) ? j : null; }
        catch (e) { return null; } finally { clearTimeout(tm); }
      };
      const found = j => { const u = norm(j.origin); App.remember([u].concat(j.urls || [])); return u; };
      // 1. addresses it had before
      const before = [...new Set([App.server()].concat(App.known()).filter(Boolean))];
      for (const o of before) { const j = await hello(o, 2500); if (j) return found(Object.assign(j, { origin: o })); }
      // 2. every address on the networks this phone is on (and the ones the computer used before, and usual hotspots)
      const own = String((A.localIps && A.localIps()) || '').split(',').filter(x => /^\d+\.\d+\.\d+\.\d+$/.test(x));
      const net = ip => ip.split('.').slice(0, 3).join('.');
      const ports = [...new Set(before.map(o => { try { return new URL(o).port || '5173'; } catch (e) { return '5173'; } }).concat('5173'))];
      const nets = [...new Set(own.map(net).concat(before.map(o => { try { return net(new URL(o).hostname); } catch (e) { return ''; } }))
        .concat(['192.168.137', '192.168.43', '172.20.10', '192.168.1', '192.168.0']).filter(n => /^\d+\.\d+\.\d+$/.test(n) && !/^(127|169\.254)\./.test(n)))].slice(0, 7);
      for (const n of nets) for (const port of ports) {
        const hosts = []; for (let i = 1; i < 255; i++) { const ip = n + '.' + i; if (!own.includes(ip)) hosts.push('http://' + ip + ':' + port + '/'); }
        let hit = '', k = 0;
        await Promise.all(Array.from({ length: 48 }, async () => {
          while (!hit && k < hosts.length) { const o = hosts[k++]; const j = await hello(o, 1500); if (j && !hit) hit = found(Object.assign(j, { origin: o })); }
        }));
        if (hit) return hit;
      }
      return '';
    }
  };
  async function fingerprint(key) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('trade-id:' + key));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }

  // ---- api/… goes to the Trade computer ----
  const isApi = u => typeof u === 'string' && /^(\.\/|\/)?api\//.test(u);
  const abs = u => App.server() + u.replace(/^(\.\/|\/)/, '');
  const fetch0 = window.fetch.bind(window);
  window.fetch = (u, o) => {
    if (isApi(u)) {
      if (!App.server()) return Promise.reject(new TypeError('Failed to fetch'));
      u = abs(u);
    }
    return fetch0(u, o);
  };
  navigator.sendBeacon = (u, data) => {
    if (!isApi(u) || !App.server()) return false;
    window.fetch(u, { method: 'POST', body: data, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    return true;
  };

  // ---- it is an installed app with its own permanent storage ----
  try { Object.defineProperty(navigator, 'standalone', { get: () => true }); } catch (e) {}
  if (navigator.storage) {
    navigator.storage.persisted = () => Promise.resolve(true);
    navigator.storage.persist = () => Promise.resolve(true);
  }

  // ---- files: save to Downloads, share (WhatsApp, WeChat, Gmail…), open ----
  const b64 = blob => new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });
  const call = async (fn, blob, name, extra) => {
    const err = A[fn](name || 'file', blob.type || 'application/octet-stream', await b64(blob), extra || '');
    if (err) throw new Error(err);
  };
  const toBlob = url => fetch0(url).then(r => r.blob());
  const fail = e => { if (window.toast) window.toast(String(e && e.message || e)); };

  navigator.canShare = d => !!(d && ((d.files && d.files.length) || d.text || d.url));
  navigator.share = async d => {
    d = d || {};
    const f = d.files && d.files[0];
    if (f) return call('shareFile', f, f.name, d.text || d.title || '');
    A.shareText([d.title, d.text, d.url].filter(Boolean).join('\n'));
  };

  const click0 = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const href = this.href || '';
    if (this.download && /^(blob|data):/.test(href)) {
      const name = this.download;
      toBlob(href).then(b => call('saveFile', b, name)).catch(fail);
      return;
    }
    return click0.call(this);
  };

  window.open = url => {
    url = String(url || '');
    if (/^(blob|data):/.test(url)) {
      const ex = window.__lastExport;
      toBlob(url).then(b => call('openFile', b, ex && ex.name || 'file')).catch(fail);
    } else if (url) A.openUrl(new URL(url, location.href).href);
    return null;
  };
})();
