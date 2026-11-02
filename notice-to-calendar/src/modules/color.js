// 颜色工具：给日程色做「低饱和」处理
const FALLBACK = { r: 22, g: 119, b: 255 }

function parseHex(color) {
  const hex = String(color || '').trim().replace(/^#/, '')
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  }
}

// 同色系极淡背景
export function withAlpha(color, alpha = 0.16) {
  const c = parseHex(color) || FALLBACK
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`
}

// 同色系加深，保证浅底上的文字可读（0.4 为实测较清晰的系数）
export function darken(color, amount = 0.4) {
  const c = parseHex(color) || FALLBACK
  const mix = (v) => Math.round(v * (1 - amount))
  return `rgb(${mix(c.r)}, ${mix(c.g)}, ${mix(c.b)})`
}
