const I18n = require('../../utils/i18n')
const t = (k, v) => I18n.t(k, v)
const store = require('../../utils/store')
const ui = require('../../utils/ui')
const Report = require('../../utils/report')
const theme = require('../../utils/theme')

Page({
  pickLanguage() { ui.pickLanguage(this) },
  data: { nav: ui.navMetrics(), list: [], q: '', name: '', note: '', count: 0, shopCount: 0, productCount: 0 },

  onShow() {
    theme.apply(this, true)
    ui.setTab(this, 1)
    this.refresh()
  },

  refresh() {
    const products = store.all(), used = {}
    products.forEach(p => { if (p.marketName) (used[p.marketName] = used[p.marketName] || []).push(p) })
    const k = this.data.q.trim().toLowerCase()
    const all = store.markets()
    const list = all.filter(m => !k || (m.name + ' ' + m.note).toLowerCase().indexOf(k) >= 0).map(m => {
      const ps = used[m.name] || []
      const shops = {}
      ps.forEach(p => { shops[p.shopName] = 1 })
      return {
        id: m.id, name: m.name, note: m.note, initial: m.name.trim().charAt(0).toUpperCase(),
        products: ps.length, shops: Object.keys(shops).length,
        sub: (m.note ? m.note + ' · ' : '') + I18n.plural(ps.length, 'product') + ' · ' + I18n.plural(Object.keys(shops).length, 'shop'), totals: ps.length ? Report.totalsText(Report.totalsOf(ps)) : ''
      }
    })
    const shopSet = {}
    products.filter(p => p.marketName).forEach(p => { shopSet[p.marketName + '|' + p.shopName] = 1 })
    this.setData({ list, count: all.length, shopCount: Object.keys(shopSet).length, productCount: products.filter(p => p.marketName).length })
  },

  onName(e) { this.setData({ name: e.detail.value }) },
  onNote(e) { this.setData({ note: e.detail.value }) },
  onSearch(e) { this.setData({ q: e.detail.value }, () => this.refresh()) },

  add() {
    const name = store.norm(this.data.name)
    if (!name) return wx.showToast({ title: t('Enter the market name'), icon: 'none' })
    if (store.findMarket(name)) return wx.showToast({ title: t('Already registered'), icon: 'none' })
    store.ensureMarket(name, this.data.note)
    this.setData({ name: '', note: '' })
    wx.showToast({ title: t('Market registered'), icon: 'success' })
    this.refresh()
  },

  // Show this market's products on the Products tab
  open(e) {
    const m = this.data.list.find(x => x.id === e.currentTarget.dataset.id)
    if (!m.products) return wx.showToast({ title: t('No products in this market yet'), icon: 'none' })
    getApp().globalData.market = m.name
    wx.switchTab({ url: '/pages/index/index' })
  },

  edit(e) {
    const m = store.markets().find(x => x.id === e.currentTarget.dataset.id)
    wx.showModal({
      title: t('Rename market'), editable: true, placeholderText: t('Market name'), content: m.name, confirmText: t('Save'),
      success: r => {
        if (!r.confirm) return
        const name = store.norm(r.content)
        if (!name) return wx.showToast({ title: t('Enter the market name'), icon: 'none' })
        const dup = store.findMarket(name)
        if (dup && dup.id !== m.id) return wx.showToast({ title: t('Another market has this name'), icon: 'none' })
        store.updateMarket(m.id, name, m.note)
        this.refresh()
      }
    })
  },

  del(e) {
    const m = store.markets().find(x => x.id === e.currentTarget.dataset.id)
    const n = store.marketUsage(m.name).length
    if (n) return wx.showModal({ title: t('Market in use'), content: t('{x} use "{name}". Change or delete those products first.', { x: I18n.plural(n, 'product'), name: m.name }), showCancel: false })
    wx.showModal({
      title: t('Delete market?'), content: t('"{name}" will be removed from your list.', { name: m.name }), confirmText: t('Delete'), confirmColor: '#E11D48',
      success: r => { if (r.confirm) { store.removeMarket(m.id); this.refresh() } }
    })
  },
  noop() {}
})
