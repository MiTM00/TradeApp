Component({
  data: {
    selected: 0,
    themeStyle: '',
    th: { brand: '#0F766E' },
    L: require('../utils/i18n').table(),
    tabs: [
      { path: '/pages/index/index', text: 'Products', icon: 'grid' },
      { path: '/pages/markets/markets', text: 'Markets', icon: 'market' },
      { path: '/pages/report/report', text: 'Reports', icon: 'chart' },
      { path: '/pages/settings/settings', text: 'Settings', icon: 'settings' }
    ]
  },
  methods: {
    go(e) {
      const i = e.currentTarget.dataset.index
      if (i === this.data.selected) return
      wx.switchTab({ url: this.data.tabs[i].path })
    },
    add() {
      wx.navigateTo({ url: '/pages/add/add' })
    }
  }
})
