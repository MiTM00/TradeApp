const I18n = require('../../utils/i18n')
const t = (k, v) => I18n.t(k, v)
const store = require('../../utils/store')
const ui = require('../../utils/ui')
const Report = require('../../utils/report')
const theme = require('../../utils/theme')

Page({
  pickLanguage() { ui.pickLanguage(this) },
  data: { nav: ui.navMetrics(), list: [], q: '', market: '', markets: [], total: 0, shopCount: 0 },

  onShow() {
    theme.apply(this, true)
    ui.setTab(this, 0)
    // Opened from the Markets tab: filter by that market
    const app = getApp()
    if (app.globalData && app.globalData.market !== undefined) {
      this.setData({ market: app.globalData.market, q: '' })
      delete app.globalData.market
    }
    this.refresh()
  },

  refresh() {
    const all = store.all()
    const q = this.data.q.trim().toLowerCase()
    const counts = {}
    all.forEach(p => { if (p.marketName) counts[p.marketName] = (counts[p.marketName] || 0) + 1 })
    const markets = Object.keys(counts).sort().map(name => ({ name, count: counts[name] }))
    const market = counts[this.data.market] ? this.data.market : ''

    const list = all
      .filter(p => !market || p.marketName === market)
      .filter(p => !q || [p.name, p.description, p.marketName, p.shopName, p.wechatId, p.shopNote, p.size, p.location && p.location.name, p.location && p.location.address]
        .join(' ').toLowerCase().indexOf(q) >= 0)
      .map(p => { const reg = Report.registeredAt(p); return Object.assign({}, p, { pp: ui.priceParts(p.price), reg: Report.dateLabel(reg), regAgo: reg ? ui.ago(reg) : '' }) })

    const shops = {}
    all.forEach(p => { shops[(p.marketName || '') + '|' + p.shopName] = 1 })
    this.setData({ list, markets, market, total: all.length, marketCount: store.markets().length, shopCount: Object.keys(shops).length })
  },

  onSearch(e) { this.setData({ q: e.detail.value }, () => this.refresh()) },
  clearSearch() { this.setData({ q: '' }, () => this.refresh()) },
  pickMarket(e) { this.setData({ market: e.currentTarget.dataset.name }, () => this.refresh()) },

  open(e) { wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id }) },
  add() { wx.navigateTo({ url: '/pages/add/add' }) }
})
