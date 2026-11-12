// Colour themes. Shared by the mini program and the web app.
// Each theme sets the brand colours; dark themes also replace the neutral surfaces.
// A theme can override any surface colour (bg, card, line…) for its own look.
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.TradeThemes = factory()
})(this, function () {
  const LIGHT = {
    dark: false, bg: '#F5F7FA', card: '#FFFFFF', ink: '#0F172A', ink2: '#475569', ink3: '#94A3B8',
    line: '#E9EDF2', soft: '#F1F5F9', field: '#F8FAFC', ph: '#B6C0CD', price: '#E11D48', tabbar: 'rgba(255,255,255,.96)'
  }
  const DARK = {
    dark: true, bg: '#0B1120', card: '#151E30', ink: '#E8EDF5', ink2: '#A3B1C6', ink3: '#6B7A90',
    line: '#24314A', soft: '#1E293D', field: '#101828', ph: '#56657C', price: '#FB7185', tabbar: 'rgba(17,25,40,.96)'
  }
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',')
  // light theme from three colours
  const L = (id, name, brand, brand2, brandDark, mint, mint2, extra) => Object.assign({ id, name, brand, brand2, brandDark, mint, mint2, rgb: hex(brand) }, extra)
  // dark theme: the brand colour is tinted on top of the dark surfaces
  const D = (id, name, brand, brand2, brandDark, extra) => Object.assign({ id, name, dark: true, brand, brand2, brandDark, mint: 'rgba(' + hex(brand2) + ',.12)', mint2: 'rgba(' + hex(brand2) + ',.22)', rgb: hex(brand) }, extra)

  const LIST = [
    // ---- light ----
    L('jade', 'Jade', '#0F766E', '#14B8A6', '#134E4A', '#F0FDFA', '#CCFBF1'),
    L('ocean', 'Ocean', '#1D4ED8', '#3B82F6', '#1E3A8A', '#EFF6FF', '#DBEAFE'),
    L('sky', 'Sky', '#0284C7', '#38BDF8', '#075985', '#F0F9FF', '#E0F2FE'),
    L('royal', 'Royal', '#6D28D9', '#8B5CF6', '#4C1D95', '#F5F3FF', '#EDE9FE'),
    L('lavender', 'Lavender', '#7C3AED', '#C084FC', '#5B21B6', '#FAF5FF', '#F3E8FF', { bg: '#F8F6FD' }),
    L('rose', 'Rose', '#BE185D', '#EC4899', '#831843', '#FDF2F8', '#FCE7F3'),
    L('cherry', 'Cherry', '#DC2626', '#F87171', '#991B1B', '#FEF2F2', '#FEE2E2', { price: '#B91C1C' }),
    L('sunset', 'Sunset', '#EA580C', '#FB923C', '#9A3412', '#FFF7ED', '#FFEDD5'),
    L('gold', 'Gold', '#B45309', '#F59E0B', '#78350F', '#FFFBEB', '#FEF3C7', { bg: '#FBF8F1' }),
    L('forest', 'Forest', '#15803D', '#22C55E', '#14532D', '#F0FDF4', '#DCFCE7'),
    L('mint', 'Mint', '#059669', '#34D399', '#064E3B', '#ECFDF5', '#D1FAE5', { bg: '#F3FAF7' }),
    L('coffee', 'Coffee', '#7C4A2D', '#B07A52', '#4A2C1A', '#FAF5F0', '#F1E4D8', { bg: '#F7F3EE', line: '#ECE3D9', soft: '#F3ECE4', field: '#FBF8F4' }),
    L('slate', 'Slate', '#334155', '#64748B', '#0F172A', '#F1F5F9', '#E2E8F0'),
    // ---- dark ----
    D('midnight', 'Midnight', '#14B8A6', '#2DD4BF', '#0F3D3A'),
    D('galaxy', 'Galaxy', '#7C3AED', '#A78BFA', '#2E1065', { bg: '#0E0A1F', card: '#1A1433', line: '#2C2350', soft: '#231B42', field: '#130E29', tabbar: 'rgba(22,17,44,.96)' }),
    D('aurora', 'Aurora', '#0EA5E9', '#22D3EE', '#0C4A6E', { bg: '#07131F', card: '#0F2133', line: '#1D3550', soft: '#162B42', field: '#0A1828', tabbar: 'rgba(12,28,44,.96)' }),
    D('ember', 'Ember', '#EA580C', '#FB923C', '#7C2D12', { bg: '#140C08', card: '#22160F', line: '#3A2618', soft: '#2D1D13', field: '#1A110B', tabbar: 'rgba(34,22,15,.96)' }),
    D('ruby', 'Ruby', '#E11D48', '#FB7185', '#881337', { bg: '#140910', card: '#22121B', line: '#3B1F2E', soft: '#2D1823', field: '#1A0D14', price: '#FDA4AF', tabbar: 'rgba(34,18,27,.96)' }),
    D('emerald', 'Emerald', '#10B981', '#34D399', '#064E3B', { bg: '#06130E', card: '#0E211A', line: '#1B3A2E', soft: '#142C23', field: '#0A1913', tabbar: 'rgba(14,33,26,.96)' }),
    D('amoled', 'Black', '#F59E0B', '#FBBF24', '#78350F', { bg: '#000000', card: '#111111', line: '#262626', soft: '#1A1A1A', field: '#0A0A0A', ink3: '#737373', ph: '#525252', tabbar: 'rgba(10,10,10,.96)' }),
  ]

  function get(id) {
    const t = LIST.find(x => x.id === id) || LIST[0]
    return Object.assign({}, t.dark ? DARK : LIGHT, t)
  }

  // CSS custom properties for a theme, as one inline style string
  function css(id) {
    const t = get(id)
    return [
      ['--bg', t.bg], ['--card', t.card], ['--ink', t.ink], ['--ink-2', t.ink2], ['--ink-3', t.ink3], ['--line', t.line],
      ['--soft', t.soft], ['--field', t.field], ['--ph', t.ph], ['--price', t.price], ['--tabbar', t.tabbar],
      ['--brand', t.brand], ['--brand-2', t.brand2], ['--brand-dark', t.brandDark], ['--mint', t.mint], ['--mint-2', t.mint2],
      ['--brand-rgb', t.rgb],
      ['--hero', 'linear-gradient(150deg,' + t.brand + ' 0%,' + t.brandDark + ' 100%)']
    ].map(p => p[0] + ':' + p[1]).join(';')
  }

  return { LIST, get, css }
})
