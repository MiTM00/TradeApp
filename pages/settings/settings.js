const I18n = require('../../utils/i18n')
const t = (k, v) => I18n.t(k, v)
const store = require('../../utils/store')
const ui = require('../../utils/ui')
const Report = require('../../utils/report')
const Themes = require('../../utils/themes')
const theme = require('../../utils/theme')

Page({
  pickLanguage() { ui.pickLanguage(this) },
  data: { nav: ui.navMetrics(), themes: [], current: 'jade', anim: true, info: {}, lastBackup: '' },

  onShow() {
    theme.apply(this, true)
    ui.setTab(this, 3)
    this.refresh()
  },

  refresh() {
    const s = store.settings()
    const themes = Themes.LIST.map(t => {
      const f = Themes.get(t.id)
      return { id: t.id, name: I18n.t(t.name), dark: !!t.dark, sw: 'background:linear-gradient(150deg,' + f.brand + ',' + f.brandDark + ')', bar: 'background:' + f.bg + ';border:1rpx solid ' + f.line }
    })
    let info = {}
    try {
      const i = wx.getStorageInfoSync()
      info = { kb: i.currentSize, limit: i.limitSize, pct: Math.min(100, Math.round(i.currentSize / i.limitSize * 100)) }
    } catch (e) {}
    this.setData({
      themes, current: s.theme, anim: !s.noanim, info,
      products: store.all().length, markets: store.markets().length,
      lastBackup: s.lastBackup ? t('Last backup: {date}', { date: Report.dateTimeLabel(s.lastBackup) }) : '',
      langs: I18n.LANGS, lang: I18n.getLang()
    })
    const L = this.data.L || {}
    this.setData({
      storageText: t('Saved on this phone · {a} KB of {b} KB', { a: info.kb, b: info.limit }),
      dataNote: t('{p} products and {m} markets are saved on this phone and stay after closing WeChat or restarting. They are only lost if the mini program is deleted — so send a backup to “File Transfer” now and then.', { p: store.all().length, m: store.markets().length })
    })
    void L
  },

  pickLang(e) {
    store.setSetting('lang', e.currentTarget.dataset.id)
    theme.apply(this, true)
    ui.setTab(this, 3)
    this.refresh()
  },

  pickTheme(e) {
    store.setSetting('theme', e.currentTarget.dataset.id)
    theme.apply(this, true)
    ui.setTab(this, 3)
    this.setData({ current: e.currentTarget.dataset.id })
  },

  toggleAnim() {
    store.setSetting('noanim', this.data.anim)
    theme.apply(this, true)
    this.setData({ anim: !this.data.anim })
  },

  // Backup: one file with all products, markets and photos. Send it to "File Transfer" or any chat to keep it safe.
  backup() {
    wx.showLoading({ title: t('Preparing backup') })
    let out
    try { out = store.backup() } catch (e) {
      wx.hideLoading()
      return wx.showModal({ title: t('Backup failed'), content: String(e.message || e.errMsg || e), showCancel: false })
    }
    wx.hideLoading()
    this.refresh()
    wx.shareFileMessage({
      filePath: out.path, fileName: out.name,
      success: () => wx.showToast({ title: t('Backup sent'), icon: 'success' }),
      fail: e => {
        if (/cancel/.test(e.errMsg)) return
        wx.showModal({ title: t('Backup saved'), content: t('The backup file is saved in the app. Sending it to a chat failed: {x}', { x: e.errMsg }), showCancel: false })
      }
    })
  },

  // Restore: pick the backup .json file from a WeChat chat
  restore() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['json'],
      success: r => {
        const f = r.tempFiles[0]
        let text
        try { text = wx.getFileSystemManager().readFileSync(f.path, 'utf8') } catch (e) { return wx.showToast({ title: t('Could not read the file'), icon: 'none' }) }
        wx.showModal({
          title: t('Restore backup'), content: t('Products you already have are kept; matching ones are updated.'), confirmText: t('Restore'),
          success: m => {
            if (!m.confirm) return
            try {
              const res = store.restore(text)
              wx.showToast({ title: t('Restored {n}', { n: res.products }), icon: 'success' })
              this.refresh()
            } catch (e) { wx.showModal({ title: t('Restore failed'), content: String(e.message || e), showCancel: false }) }
          }
        })
      }
    })
  }
})
