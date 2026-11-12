// Layout helpers for pages that draw their own navigation bar
function navMetrics() {
  const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  const statusBar = win.statusBarHeight || 20
  let mb = null
  try { mb = wx.getMenuButtonBoundingClientRect() } catch (e) {}
  if (!mb || !mb.height) mb = { top: statusBar + 4, height: 32, left: win.windowWidth - 95 }
  const navH = (mb.top - statusBar) * 2 + mb.height
  return { statusBar, navH, capsule: win.windowWidth - mb.left + 8, total: statusBar + navH }
}

function priceParts(n) {
  const s = (Math.round(Number(n) * 100) / 100).toFixed(2).split('.')
  return { int: s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','), dec: s[1] }
}

// Highlights the tab and gives the tab bar the current theme
function setTab(page, index) {
  if (typeof page.getTabBar !== 'function' || !page.getTabBar()) return
  const c = require('./theme').current()
  page.getTabBar().setData({ selected: index, themeStyle: c.style, th: c.th, L: require('./i18n').table() })
}

// Data for the registration date card (month band, big day, weekday, time, "3 days ago")
const WEEKDAYS = { en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], so: ['Axad', 'Isniin', 'Talaado', 'Arbaco', 'Khamiis', 'Jimco', 'Sabti'], zh: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] }
function ago(ts) {
  const I18n = require('./i18n'), t = I18n.t
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) })
  if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) })
  const d = Math.round(s / 86400)
  if (d < 31) return t(d === 1 ? '{n} day ago' : '{n} days ago', { n: d })
  const m = Math.round(d / 30.4)
  if (m < 12) return t(m === 1 ? '{n} month ago' : '{n} months ago', { n: m })
  const y = Math.round(d / 365)
  return t(y === 1 ? '{n} year ago' : '{n} years ago', { n: y })
}
function dateCard(ts) {
  const I18n = require('./i18n'), Report = require('./report')
  const d = new Date(ts || Date.now()), pad = n => (n < 10 ? '0' : '') + n
  return {
    mon: Report.monthShort(d.getMonth()), day: d.getDate(), year: d.getFullYear(),
    date: WEEKDAYS[I18n.getLang()][d.getDay()] + ', ' + Report.dateLabel(d.getTime()),
    time: pad(d.getHours()) + ':' + pad(d.getMinutes()), ago: ts ? ago(ts) : I18n.t('Today'),
    short: Report.dateLabel(d.getTime())
  }
}
// One language icon: tap → English / Soomaali / 中文, then the page redraws
function pickLanguage(page) {
  const I18n = require('./i18n'), store = require('./store')
  wx.showActionSheet({
    itemList: I18n.LANGS.map(l => (l.id === I18n.getLang() ? '✓ ' : '') + l.name),
    success: r => {
      store.setSetting('lang', I18n.LANGS[r.tapIndex].id)
      if (typeof page.onShow === 'function') page.onShow()
    }
  })
}

module.exports = { navMetrics, priceParts, setTab, dateCard, ago, pickLanguage }
