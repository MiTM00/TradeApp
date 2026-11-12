const I18n = require('./i18n')
const t = (k, v) => I18n.t(k, v)
// Amap (高德地图) — WeChat uses GCJ-02, the same coordinate system as Amap
function amapUrl(loc, name) {
  return 'https://uri.amap.com/marker?position=' + loc.longitude + ',' + loc.latitude +
    '&name=' + encodeURIComponent(name || loc.name || '') +
    '&src=trade_mp&coordinate=gaode&callnative=1'
}

// A mini program cannot open another app directly; wx.openLocation opens
// a map with a "导航" button that lets you choose 高德地图.
function openInAmap(loc, name) {
  wx.openLocation({
    latitude: loc.latitude,
    longitude: loc.longitude,
    name: name || loc.name,
    address: loc.address,
    scale: 17
  })
}

function copyAmapLink(loc, name) {
  wx.setClipboardData({
    data: amapUrl(loc, name),
    success: () => wx.showToast({ title: t('Link copied'), icon: 'none' })
  })
}

module.exports = { amapUrl, openInAmap, copyAmapLink }
