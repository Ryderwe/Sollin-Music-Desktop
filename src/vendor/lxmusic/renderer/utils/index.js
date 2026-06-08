export const decodeName = (str = '') => {
  if (!str) return ''
  return new DOMParser().parseFromString(String(str), 'text/html').body.textContent || ''
}

export const formatPlayTime = (time) => {
  const total = Number(time || 0)
  const minutes = Math.floor(total / 60)
  const seconds = Math.floor(total % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export const sizeFormate = (size) => {
  const value = Number(size || 0)
  if (!value) return null
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)}GB`
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}MB`
  if (value >= 1024) return `${(value / 1024).toFixed(2)}KB`
  return `${value}B`
}

export const formatPlayCount = (num) => {
  const value = Number(num || 0)
  if (value >= 100000000) return `${Math.trunc(value / 10000000) / 10}亿`
  if (value >= 10000) return `${Math.trunc(value / 1000) / 10}万`
  return String(value)
}

export const dateFormat = (time, pattern = 'Y-M-D') => {
  const date = new Date(time)
  const Y = date.getFullYear()
  const M = String(date.getMonth() + 1).padStart(2, '0')
  const D = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return pattern
    .replace('Y', String(Y))
    .replace('M', M)
    .replace('D', D)
    .replace('h', h)
    .replace('m', m)
    .replace('s', s)
}

export const dateFormat2 = (time) => {
  const target = Number(time || 0)
  if (!target) return ''
  const differ = Math.trunc((Date.now() - target) / 1000)
  if (differ < 60) return `${Math.max(differ, 0)}秒前`
  if (differ < 3600) return `${Math.trunc(differ / 60)}分钟前`
  if (differ < 86400) return `${Math.trunc(differ / 3600)}小时前`
  return dateFormat(target)
}
