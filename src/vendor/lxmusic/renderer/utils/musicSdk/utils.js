import md5 from 'crypto-js/md5'
import { decodeName } from '../index'

export const toMD5 = (str) => md5(str).toString()

export const formatSingerName = (singers, nameKey = 'name', join = '、') => {
  if (Array.isArray(singers)) {
    return decodeName(
      singers
        .map((item) => item?.[nameKey])
        .filter(Boolean)
        .join(join)
    )
  }
  return decodeName(String(singers || ''))
}
