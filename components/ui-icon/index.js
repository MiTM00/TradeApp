const icons = require('../../utils/icons')

Component({
  properties: {
    name: { type: String, value: '' },
    color: { type: String, value: '#0F172A' },
    size: { type: Number, value: 40 }, // rpx
    stroke: { type: Number, value: 2 }
  },
  data: { src: '' },
  observers: {
    'name, color, stroke'(name, color, stroke) {
      this.setData({ src: icons.uri(name, color, stroke) })
    }
  }
})
