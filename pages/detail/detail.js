const I18n = require('../../utils/i18n')
const t = (k, v) => I18n.t(k, v)
const store = require('../../utils/store')
const amap = require('../../utils/amap')
const ui = require('../../utils/ui')
const Report = require('../../utils/report')
const Similar = require('../../utils/similar')
const theme = require('../../utils/theme')

Page({
  data: { nav: ui.navMetrics(), id: '', p: null, pp: null, markers: [], current: 0, moqValue: '' },

  onLoad(opts) {
    this.setData({ id: opts.id })
  },

  // onShow so data refreshes when returning from the edit page
  onShow() {
    theme.apply(this, true)
    const p = store.get(this.data.id) || null
    // Same product in other shops (by name or photo)
    const g = p ? Similar.groups(store.all(), 'both').find(x => x.products.some(y => y.id === p.id)) : null
    const same = g ? g.products.filter(x => x.id !== p.id).map(x => ({
      id: x.id, name: x.name, img: (x.images || [])[0] || '', where: (x.marketName ? x.marketName + ' · ' : '') + x.shopName,
      price: x.currency + Report.money(x.price),
      cmpKey: x.currency !== p.currency ? '' : x.price < p.price ? 'cheaper' : x.price > p.price ? 'dearer' : 'same price',
      cmp: x.currency !== p.currency ? '' : t(x.price < p.price ? 'cheaper' : x.price > p.price ? 'dearer' : 'same price')
    })) : []
    const markers = p && p.location ? [{
      id: 1,
      latitude: p.location.latitude,
      longitude: p.location.longitude,
      title: p.shopName,
      width: 28,
      height: 36
    }] : []
    this.setData({
      p, markers, current: 0, same, othersText: I18n.plural(same.length, 'other'), unitText: p ? t(p.unit) : '',
      pp: p ? ui.priceParts(p.price) : null,
      moqValue: p ? ui.priceParts(p.price * p.minOrder) : null,
      reg: p ? Report.dateTimeLabel(Report.registeredAt(p)) : '',
      regText: p ? t('Registered {date}', { date: Report.dateTimeLabel(Report.registeredAt(p)) }) : '',
      dc: p ? ui.dateCard(Report.registeredAt(p)) : null
    })
  },

  back() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/index/index' })
  },

  onSwipe(e) { this.setData({ current: e.detail.current }) },

  preview(e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.p.images })
  },

  openAmap() {
    const p = this.data.p
    amap.openInAmap(p.location, p.shopName)
  },

  copyAmap() {
    const p = this.data.p
    amap.copyAmapLink(p.location, p.shopName)
  },

  copyWechat() {
    wx.setClipboardData({ data: this.data.p.wechatId, success: () => wx.showToast({ title: t('Copy') + ' ✓', icon: 'none' }) })
  },

  openOther(e) {
    wx.redirectTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  edit() {
    wx.navigateTo({ url: '/pages/add/add?id=' + this.data.id })
  },

  del() {
    wx.showModal({
      title: t('Delete product'),
      content: 'Are you sure you want to delete "' + this.data.p.name + '"? This cannot be undone.',
      confirmText: t('Delete'),
      confirmColor: '#E11D48',
      cancelText: t('Cancel'),
      success: r => {
        if (!r.confirm) return
        store.remove(this.data.id)
        this.back()
      }
    })
  }
})
