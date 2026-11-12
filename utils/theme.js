// Applies the chosen colour theme to a mini program page.
// Each page puts <page-meta page-style="{{themeStyle}}" /> first in its wxml and calls theme.apply(this) in onShow.
const Themes = require('./themes')
const I18n = require('./i18n')
const store = require('./store')

function current() {
  const s = store.settings()
  const t = Themes.get(s.theme)
  return {
    t,
    style: Themes.css(s.theme) + ';--dur:' + (s.noanim ? '0s' : '.5s') + ';background:' + t.bg + ';color:' + t.ink,
    th: { brand: t.brand, brand2: t.brand2, ink: t.ink, ink3: t.ink3, dark: !!t.dark, id: t.id }
  }
}

function apply(page, customNav) {
  const c = current()
  I18n.setLang(store.settings().lang || 'en')
  page.setData({ themeStyle: c.style, th: c.th, L: Object.assign(I18n.table(), { __code: { en: 'EN', so: 'SO', zh: '中' }[I18n.getLang()] }) })
  try {
    if (!customNav) wx.setNavigationBarColor({ frontColor: c.t.dark ? '#ffffff' : '#000000', backgroundColor: c.t.bg })
    wx.setBackgroundColor({ backgroundColor: c.t.bg, backgroundColorTop: c.t.dark ? c.t.bg : c.t.brand, backgroundColorBottom: c.t.bg })
    wx.setBackgroundTextStyle({ textStyle: c.t.dark ? 'light' : 'dark' })
  } catch (e) {}
  return c
}

module.exports = { current, apply }
