// Runs only in the copy of the app published on GitHub Pages (the iPhone app; see preview/publish.js).
// That copy has no Trade server behind it: api/… goes to the Trade computer's secure address instead.
// The computer writes that address (it changes every time Trade starts) next to the app, in hub/<fingerprint>.json,
// encrypted with this phone's pairing code — so the phone finds the computer again by itself after every restart.
(function () {
  // Published by npm run pages (hub-config.js), or by the GitHub Actions workflow: then the address itself says where
  // (https://<owner>.github.io/<repo>/)
  const gp = /^([\w-]+)\.github\.io$/i.exec(location.hostname);
  const H = window.TRADE_HUB || (gp && { owner: gp[1], repo: location.pathname.split('/')[1] || gp[1] + '.github.io' });
  if (!H || !H.owner) return;
  const KEY = 'trade-server';
  const fetch0 = window.fetch.bind(window);
  const hex = b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  const sha = s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const fingerprint = async code => hex(await sha('trade-id:' + code)).slice(0, 24);
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function open(code, box) {
    const k = await crypto.subtle.importKey('raw', await sha('trade-hub:' + code), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, k, unb64(box.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  const timed = (u, o, ms) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch0(u, Object.assign({ signal: c.signal }, o)).finally(() => clearTimeout(t)); };

  const Hub = window.TradeHub = {
    hub: true,
    server() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    setServer(s) { try { s ? localStorage.setItem(KEY, s) : localStorage.removeItem(KEY); } catch (e) {} return s; },
    // Every secure address the computer had (Wi-Fi https first, then the internet one), newest first
    known() { try { return JSON.parse(localStorage.getItem(KEY + 's') || '[]'); } catch (e) { return []; } },
    remember(list) {
      const all = [].concat(list || [], Hub.known()).filter(u => /^https:\/\//.test(u || '')).map(u => u.replace(/\/?$/, '/'));
      try { localStorage.setItem(KEY + 's', JSON.stringify(Array.from(new Set(all)).slice(0, 12))); } catch (e) {}
    },
    // → the computer's address for this pairing code, or ''
    async find(code) {
      if (!code) return '';
      const id = await fingerprint(code), file = 'hub/' + id + '.json';
      const mine = async url => { try { const j = await (await timed(url + 'api/sync/hello', { cache: 'no-store' }, 4000)).json(); return j && j.trade && (j.ids || [j.id]).includes(id); } catch (e) { return false; } };
      // Same Wi-Fi: the addresses the computer had before (asked all at once)
      const lan = Hub.known().filter(u => !/trycloudflare\.com/.test(u));
      const hit = (await Promise.all(Hub.known().map(async u => (await mine(u)) ? u : ''))).find(Boolean);
      if (hit) return hit;
      // The computer got a new address on the same Wi-Fi: look through that network (at most every 2 minutes)
      if (lan.length && Date.now() - (Hub.scanAt || 0) > 120000) {
        Hub.scanAt = Date.now();
        const nets = new Set(), ports = new Set();
        lan.forEach(u => { const m = /^https:\/\/(\d+\.\d+\.\d+)\.\d+:(\d+)\//.exec(u); if (m) { nets.add(m[1]); ports.add(m[2]); } });
        const urls = [];
        nets.forEach(n => ports.forEach(p => { for (let i = 1; i < 255; i++) urls.push('https://' + n + '.' + i + ':' + p + '/'); }));
        for (let i = 0; i < urls.length; i += 40) {
          const got = (await Promise.all(urls.slice(i, i + 40).map(async u => (await mine(u)) ? u : ''))).find(Boolean);
          if (got) { Hub.remember([got]); return got; }
        }
      }
      // While the computer is off the phone keeps looking: the Pages copy has no limit; the GitHub API (newest copy
      // at once, Pages takes about a minute) allows 60 calls an hour, so it is asked at most every 3 minutes.
      const sources = [() => timed(file + '?t=' + Date.now(), { cache: 'no-store' }, 8000)];
      if (Date.now() - (Hub.apiAt || 0) > 180000) sources.push(() => { Hub.apiAt = Date.now(); return timed(`https://api.github.com/repos/${H.owner}/${H.repo}/contents/${file}?ref=gh-pages`, { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' }, 8000); });
      for (const get of sources) {
        try {
          const r = await get(); if (!r.ok) continue;
          const info = await open(code, await r.json());
          const url = String(info.url || '').replace(/\/?$/, '/');
          if (!/^https:\/\//.test(url)) continue;
          // only a Trade computer that knows this code
          const j = await (await timed(url + 'api/sync/hello', { cache: 'no-store' }, 8000)).json();
          if (j && j.trade && (j.ids || [j.id]).includes(id)) return url;
        } catch (e) {}
      }
      return '';
    }
  };

  // ---- api/… goes to the Trade computer ----
  const isApi = u => typeof u === 'string' && /^(\.\/|\/)?api\//.test(u);
  window.fetch = (u, o) => {
    if (isApi(u)) {
      if (!Hub.server()) return Promise.reject(new TypeError('Failed to fetch'));
      u = Hub.server() + u.replace(/^(\.\/|\/)/, '');
    }
    return fetch0(u, o);
  };
  const beacon0 = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (u, data) => {
    if (!isApi(u)) return beacon0 ? beacon0(u, data) : false;
    if (!Hub.server()) return false;
    window.fetch(u, { method: 'POST', body: data, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    return true;
  };
})();
