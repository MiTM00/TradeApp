const I18n = require('../../utils/i18n')
const t = (k, v) => I18n.t(k, v)
const store = require('../../utils/store')
const ui = require('../../utils/ui')
const Report = require('../../utils/report')
const theme = require('../../utils/theme')

const UNITS = ['pcs', 'pair', 'kg', 'box', 'carton', 'dozen', 'set', 'meter', 'roll', 'bag']
const CURRENCIES = ['¥', '$']
const MAX_IMAGES = 6

function emptyForm() {
  return { images: [], name: '', description: '', size: '', price: '', currency: '¥', minOrder: '1', unit: 'pcs', marketName: '', shopName: '', shopWechat: '', wechatId: '', shopNote: '', location: null }
}

Page({
  data: {
    id: '', form: emptyForm(), units: UNITS, currencies: CURRENCIES, max: MAX_IMAGES, saving: false, markets: [], other: false,
    regInfo: ''
  },

  onShow() { theme.apply(this) },

  onLoad(opts) {
    theme.apply(this) // sets the language before any text is built
    // Registered markets are offered as choices; "Not in the list" lets you type a new one
    const markets = store.markets().map(m => m.name)
    this.setData({ markets, unitNames: UNITS.map(u => t(u)) })

    const p = opts.id ? store.get(opts.id) : null
    if (!p) {
      wx.setNavigationBarTitle({ title: t('Add Product') })
      this.setData({ dc: ui.dateCard(0), regInfo: t('Set automatically when you save') })
      const last = store.settings().lastMarket
      if (last && markets.indexOf(last) >= 0) this.setData({ 'form.marketName': last })
      return
    }
    wx.setNavigationBarTitle({ title: t('Edit Product') })
    this.setData({
      id: p.id,
      other: !!p.marketName && markets.indexOf(p.marketName) < 0,
      dc: ui.dateCard(Report.registeredAt(p)), regInfo: t('Kept when you edit'),
      form: Object.assign(emptyForm(), p, { price: String(p.price), minOrder: String(p.minOrder) })
    })
  },

  onInput(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value })
  },
  onUnit(e) { this.setData({ 'form.unit': UNITS[e.detail.value] }) },
  onCurrency(e) { this.setData({ 'form.currency': CURRENCIES[e.detail.value] }) },
  pickMarket(e) {
    const name = e.currentTarget.dataset.name
    this.setData({ other: false, 'form.marketName': this.data.form.marketName === name && !this.data.other ? '' : name })
  },
  // Shop on WeChat: tick Yes / No (tap again to clear)
  pickWechat(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ 'form.shopWechat': this.data.form.shopWechat === v ? '' : v })
  },
  pickOther() { this.setData({ other: true, 'form.marketName': '' }) },

  // One "Add photo" button -> choose: take a photo or pick from the gallery
  addPhoto() {
    const left = MAX_IMAGES - this.data.form.images.length
    if (left <= 0) return wx.showToast({ title: 'Maximum ' + MAX_IMAGES + ' photos', icon: 'none' })
    wx.showActionSheet({
      alertText: t('Add a product photo'),
      itemList: [t('Take photo'), t('Choose from gallery')],
      success: r => this.choose(r.tapIndex === 0 ? 'camera' : 'album', left)
    })
  },

  choose(source, left) {
    wx.chooseMedia({
      count: source === 'camera' ? 1 : left,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      camera: 'back',
      success: res => {
        const paths = res.tempFiles.map(f => f.tempFilePath)
        this.setData({ 'form.images': this.data.form.images.concat(paths).slice(0, MAX_IMAGES) })
      }
    })
  },

  removeImage(e) {
    const images = this.data.form.images.slice()
    images.splice(e.currentTarget.dataset.index, 1)
    this.setData({ 'form.images': images })
  },

  makeCover(e) {
    const images = this.data.form.images.slice()
    const img = images.splice(e.currentTarget.dataset.index, 1)[0]
    images.unshift(img)
    this.setData({ 'form.images': images })
  },

  preview(e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.form.images })
  },

  chooseLocation() {
    const cur = this.data.form.location
    const opts = {
      success: r => this.setData({
        'form.location': { name: r.name, address: r.address, latitude: r.latitude, longitude: r.longitude }
      }),
      fail: err => {
        if (!/cancel/.test(err.errMsg)) {
          wx.showModal({ title: t('Location'), content: t('Could not open the map. Make sure location permission is allowed.'), showCancel: false })
        }
      }
    }
    if (cur) Object.assign(opts, { latitude: cur.latitude, longitude: cur.longitude })
    wx.chooseLocation(opts)
  },

  validate(f) {
    if (!f.name.trim()) return t('Enter the product name')
    if (!(Number(f.price) > 0)) return t('Enter a valid price')
    if (!(parseInt(f.minOrder, 10) >= 1)) return t('Minimum order must be at least 1')
    if (!f.shopName.trim()) return t('Enter the shop name')
    if (f.shopWechat === 'yes' && !String(f.wechatId || '').trim()) return t('Enter the shop’s WeChat ID or number')
    return ''
  },

  async save() {
    if (this.data.saving) return
    const f = this.data.form
    const err = this.validate(f)
    if (err) return wx.showToast({ title: err, icon: 'none' })

    this.setData({ saving: true })
    try {
      const images = await Promise.all(f.images.map((p, i) => store.persistImage(p, i)))
      const old = this.data.id ? store.get(this.data.id) : null
      // A typed market that is not registered yet is added to the Markets list
      const market = store.ensureMarket(f.marketName, '', 'product')
      const sameImages = old && old.hashes && JSON.stringify(old.images) === JSON.stringify(images)
      const hashes = sameImages ? old.hashes : await store.hashImages(images)
      const now = Date.now()
      const product = Object.assign({}, f, {
        id: old ? old.id : String(now),
        images,
        name: f.name.trim(),
        description: (f.description || '').trim(),
        size: f.size.trim(),
        marketName: market ? market.name : '',
        hashes,
        shopName: f.shopName.trim(),
        shopWechat: f.shopWechat || '',
        wechatId: f.shopWechat === 'yes' ? String(f.wechatId || '').trim() : '',
        shopNote: String(f.shopNote || '').trim(),
        price: Number(f.price),
        minOrder: parseInt(f.minOrder, 10),
        createdAt: old ? (Report.registeredAt(old) || now) : now, // date registered: automatic, never changes on edit
        updatedAt: now
      })
      if (old) store.cleanupImages(old.images, images)
      store.upsert(product)
      if (market) store.setSetting('lastMarket', market.name)
      wx.showToast({ title: t('Saved'), icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (e) {
      wx.showToast({ title: 'Error: ' + (e.errMsg || e.message || e), icon: 'none' })
      this.setData({ saving: false })
    }
  }
})
