const I18n = require('../../utils/i18n')
const t = (k, v) => I18n.t(k, v)
const store = require('../../utils/store')
const ui = require('../../utils/ui')
const Report = require('../../utils/report')
const Similar = require('../../utils/similar')
const theme = require('../../utils/theme')

const TABS = [['overview', 'Overview'], ['day', 'Daily'], ['month', 'Monthly'], ['year', 'Yearly'], ['similar', 'Similar']].map(t => ({ id: t[0], label: t[1] }))
const KIND = { day: ['Daily', 'day'], month: ['Monthly', 'month'], year: ['Yearly', 'year'] }
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fileSize(n) {
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'
}
function badge(key, kind) {
  if (!key) return ['?', '']
  const p = key.split('-').map(Number)
  if (kind === 'year') return [String(p[0]).slice(2), t('year')]
  if (kind === 'month') return [Report.monthShort(p[1] - 1), String(p[0])]
  return [String(p[2]), Report.monthShort(p[1] - 1)]
}
function shortKey(key, kind) {
  if (!key) return '—'
  const p = key.split('-').map(Number)
  return kind === 'year' ? String(p[0]) : kind === 'month' ? Report.monthShort(p[1] - 1) + ' ' + String(p[0]).slice(2) : p[2] + ' ' + Report.monthShort(p[1] - 1)
}
function mini(p) {
  return {
    id: p.id, name: p.name, img: (p.images || [])[0] || '',
    where: (p.marketName ? p.marketName + ' · ' : '') + p.shopName,
    price: p.currency + Report.money(p.price), moq: t('MOQ {n} {unit}', { n: p.minOrder, unit: t(p.unit) })
  }
}

Page({
  pickLanguage() { ui.pickLanguage(this) },
  data: {
    nav: ui.navMetrics(), tabs: TABS, tab: 'overview', simMode: 'both', openKey: '',
    s: { count: 0, marketCount: 0, shopCount: 0, photoCount: 0, located: 0, date: '', totals: [], markets: [] },
    periods: [], chart: [], groups: [], loadingSimilar: false,
    busy: false, busyLabel: '', progress: 0, result: null
  },

  onShow() {
    theme.apply(this, true)
    ui.setTab(this, 2)
    this.refresh()
  },

  refresh() {
    const sum = Report.summarize(store.all())
    const maxP = Math.max.apply(null, sum.markets.map(m => m.products.length).concat(1))
    this.setData({
      s: {
        count: sum.count, marketCount: sum.marketCount, shopCount: sum.shopCount, photoCount: sum.photoCount, located: sum.located,
        date: Report.stamp(sum.generatedAt),
        updated: t('Updated {date}', { date: Report.stamp(sum.generatedAt) }),
        groupsText: I18n.plural(sum.markets.length, 'group'),
        locText: t('{a} of {b} products have a shop location', { a: sum.located, b: sum.count }),
        totals: sum.totals.map(t => ({ currency: t.currency, value: Report.money(t.value) })),
        markets: sum.markets.map(m => ({
          name: m.name === Report.NO_MARKET ? t(m.name) : m.name, none: m.name === Report.NO_MARKET, products: m.products.length, shops: m.shops.length,
          meta: I18n.plural(m.shops.length, 'shop') + ' · ' + Report.totalsText(m.totals),
          pct: Math.max(4, Math.round(m.products.length / maxP * 100)), totals: Report.totalsText(m.totals)
        }))
      }
    })
    this.drawTab()
  },

  pickTab(e) {
    this.setData({ tab: e.currentTarget.dataset.t, openKey: '' }, () => this.drawTab())
  },

  drawTab() {
    const t = this.data.tab
    if (KIND[t]) this.drawPeriods(t)
    else if (t === 'similar') this.drawSimilar()
  },

  // ---------- daily / monthly / yearly ----------
  drawPeriods(kind) {
    this._periods = Report.byPeriod(store.all(), kind)
    const chartData = this._periods.slice(0, 12).reverse()
    const maxC = Math.max.apply(null, chartData.map(p => p.count).concat(1))
    this.setData({
      perTitle: t('Products per ' + KIND[kind][1]),
      lastText: t('last {x}', { x: I18n.plural(chartData.length, KIND[kind][1]) }),
      chart: chartData.map(p => ({ key: p.key, n: p.count, h: Math.max(8, Math.round(p.count / maxC * 184)), k: shortKey(p.key, kind) })),
      periods: this._periods.map(p => {
        const b = badge(p.key, kind)
        return {
          key: p.key, label: p.label, b1: b[0], b2: b[1], count: p.count, marketCount: p.marketCount, shopCount: p.shopCount,
          meta: I18n.plural(p.count, 'product') + ' · ' + I18n.plural(p.marketCount, 'market') + ' · ' + I18n.plural(p.shopCount, 'shop'),
          totals: p.totals.map(t => t.currency + Report.money(t.value)), products: p.products.map(mini)
        }
      })
    })
  },

  togglePeriod(e) {
    const k = e.currentTarget.dataset.key
    this.setData({ openKey: this.data.openKey === k ? '' : k })
  },

  exportPeriod(e) {
    const kind = this.data.tab, p = this._periods.find(x => x.key === e.currentTarget.dataset.key)
    this.run(e.currentTarget.dataset.kind, p.products, {
      title: kind === 'day' && p.key ? Report.dateLabel(new Date(p.key.replace(/-/g, '/')).getTime()) : p.label, kicker: t(KIND[kind][0] + ' report'), fileTag: p.key || 'no-date'
    })
  },

  // ---------- same products ----------
  async drawSimilar() {
    this.setData({ loadingSimilar: true })
    const list = await store.ensureHashes()
    this._groups = Similar.groups(list, this.data.simMode)
    this.setData({
      loadingSimilar: false,
      groupsText: I18n.plural(this._groups.length, 'group'),
      groups: this._groups.map((g, i) => {
        const best = g.prices.map(c => c.cheapest.id)
        return {
          n: i + 1, name: g.name, count: g.products.length, shops: g.shopCount, by: g.by,
          meta: I18n.plural(g.products.length, 'item') + ' · ' + I18n.plural(g.shopCount, 'shop') + ' · ' + t('matched by {x}', { x: t(g.by) }),
          prices: g.prices.map(c => c.min === c.max ? c.currency + Report.money(c.min) : c.currency + Report.money(c.min) + ' – ' + c.currency + Report.money(c.max)),
          products: g.products.map(p => Object.assign(mini(p), { best: best.indexOf(p.id) >= 0 }))
        }
      })
    })
  },

  pickMode(e) { this.setData({ simMode: e.currentTarget.dataset.mode }, () => this.drawSimilar()) },

  exportSimilar(e) {
    const groups = this._groups || []
    const list = [].concat.apply([], groups.map(g => g.products))
    this.run(e.currentTarget.dataset.kind, list, {
      title: t('Same products'), kicker: t('Price comparison'), sectionsTitle: t('Groups of the same product'),
      fileTag: 'Same-Products-' + Report.ymd(Date.now()),
      sections: groups.map((g, i) => ({
        name: '#' + (i + 1) + '  ' + g.name,
        sub: I18n.plural(g.products.length, 'item') + ' · ' + g.prices.map(c => c.currency + Report.money(c.min) + (c.min === c.max ? '' : '–' + Report.money(c.max))).join(' · '),
        products: g.products, best: g.prices.map(c => c.cheapest)
      }))
    })
  },

  openProduct(e) { wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id }) },

  // Canvas 2D environment used to draw the PDF pages and Excel thumbnails
  env() {
    const fs = wx.getFileSystemManager()
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().in(this).select('#rc').fields({ node: true }).exec(r => {
        const canvas = r && r[0] && r[0].node
        if (!canvas) return reject(new Error('Canvas not ready'))
        resolve({
          canvas,
          loadImage: src => new Promise((ok, no) => {
            const img = canvas.createImage()
            img.onload = () => ok(img)
            img.onerror = no
            img.src = src
          }),
          toJpeg: (c, q) => new Promise((ok, no) => wx.canvasToTempFilePath({
            canvas: c, fileType: 'jpg', quality: q, destWidth: c.width, destHeight: c.height,
            success: res => {
              try { ok(new Uint8Array(fs.readFileSync(res.tempFilePath))) } catch (e) { no(e) }
            },
            fail: no
          }))
        })
      })
    })
  },

  exportPdf() { this.run('pdf', store.all()) },
  exportExcel() { this.run('xlsx', store.all()) },

  async run(kind, list, opts) {
    if (this.data.busy) return
    if (!list || !list.length) return wx.showToast({ title: t('Add products first'), icon: 'none' })
    this.setData({ busy: true, progress: 0, busyLabel: kind === 'pdf' ? t('Creating PDF report') : t('Creating Excel workbook') })
    try {
      const env = await this.env()
      const onProgress = p => this.setData({ progress: Math.round(p * 100) })
      const t = theme.current().t
      opts = Object.assign({ colors: { brand: t.brand, brandDark: t.brandDark } }, opts || {})
      const out = kind === 'pdf' ? await Report.buildPdf(list, env, onProgress, opts) : await Report.buildExcel(list, env, onProgress, opts)
      const path = wx.env.USER_DATA_PATH + '/' + out.fileName
      const b = out.bytes
      wx.getFileSystemManager().writeFileSync(path, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
      this.setData({
        busy: false,
        result: { kind, path, name: out.fileName, size: fileSize(b.length), detail: kind === 'pdf' ? I18n.plural(out.pages, 'page') : t('2 sheets · with photos') }
      })
    } catch (e) {
      this.setData({ busy: false })
      wx.showModal({ title: t('Export failed'), content: String((e && (e.errMsg || e.message)) || e), showCancel: false })
    }
  },

  openDoc() {
    const r = this.data.result
    wx.openDocument({
      filePath: r.path, fileType: r.kind, showMenu: true,
      fail: () => wx.showToast({ title: t('Could not open the file'), icon: 'none' })
    })
  },

  // Email: a mini program cannot send email itself. Ask for the address, copy it,
  // then open the file — the system menu hands it to Mail / Gmail / Outlook with the file attached.
  emailFile() {
    const last = store.settings().lastRecipient || ''
    wx.showModal({
      title: t('Send to which email?'), editable: true, placeholderText: 'name@example.com', content: last, confirmText: t('Next'),
      success: r => {
        if (!r.confirm) return
        const to = String(r.content || '').split(/[,;\s]+/).filter(Boolean)
        const bad = to.find(a => !/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(a))
        if (!to.length || bad) return wx.showModal({ title: t('Check the address'), content: bad ? t('"{x}" is not a valid email address.', { x: bad }) : t('Enter an email address.'), showCancel: false, success: () => this.emailFile() })
        store.setSetting('lastRecipient', to.join(', '))
        wx.setClipboardData({
          data: to.join(', '),
          success: () => wx.showModal({
            title: t('Address copied'),
            content: t('The report opens now. Tap ··· (top right) → “Open in other app” (用其他应用打开) → Mail, Gmail or Outlook. The file is attached — paste the address in “To” and send.'),
            confirmText: t('Open'), showCancel: false,
            success: () => this.openDoc()
          })
        })
      }
    })
  },

  // Save: on a computer WeChat shows a save dialog; on a phone use the file menu → Save / Open in other app → Files
  saveFile() {
    const r = this.data.result
    if (wx.saveFileToDisk) {
      return wx.saveFileToDisk({ filePath: r.path, fail: () => this.saveOnPhone() })
    }
    this.saveOnPhone()
  },
  saveOnPhone() {
    wx.showModal({
      title: t('Save on phone'),
      content: t('The report opens now. Tap ··· (top right) → “Save to phone” / “Open in other app” → Files. It is also kept in WeChat under Me → Favorites if you add it there.'),
      confirmText: t('Open'), showCancel: false,
      success: () => this.openDoc()
    })
  },

  sendFile() {
    const r = this.data.result
    wx.shareFileMessage({
      filePath: r.path, fileName: r.name,
      fail: e => { if (!/cancel/.test(e.errMsg)) wx.showToast({ title: t('Could not send the file'), icon: 'none' }) }
    })
  },

  closeResult() { this.setData({ result: null }) },
  noop() {}
})
