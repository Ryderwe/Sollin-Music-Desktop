import { Buffer } from 'buffer'
import { decodeName } from '../../index'

const headExp = /^.*\[id:\$\w+\]\n/

const parseLyric = (str) => {
  str = str.replace(/\r/g, '')
  if (headExp.test(str)) str = str.replace(headExp, '')
  let trans = str.match(/\[language:([\w=\\/+]+)\]/)
  let lyric
  let rlyric
  let tlyric
  if (trans) {
    str = str.replace(/\[language:[\w=\\/+]+\]\n/, '')
    let json = JSON.parse(Buffer.from(trans[1], 'base64').toString())
    for (const item of json.content) {
      switch (item.type) {
        case 0:
          rlyric = item.lyricContent
          break
        case 1:
          tlyric = item.lyricContent
          break
      }
    }
  }
  let i = 0
  let lxlyric = str.replace(/\[((\d+),\d+)\].*/g, str => {
    let result = str.match(/\[((\d+),\d+)\].*/)
    let time = parseInt(result[2])
    let ms = time % 1000
    time /= 1000
    let m = parseInt(time / 60).toString().padStart(2, '0')
    time %= 60
    let s = parseInt(time).toString().padStart(2, '0')
    time = `${m}:${s}.${ms}`
    if (rlyric) rlyric[i] = `[${time}]${rlyric[i]?.join('') ?? ''}`
    if (tlyric) tlyric[i] = `[${time}]${tlyric[i]?.join('') ?? ''}`
    i++
    return str.replace(result[1], time)
  })
  rlyric = rlyric ? rlyric.join('\n') : ''
  tlyric = tlyric ? tlyric.join('\n') : ''
  lxlyric = lxlyric.replace(/<(\d+,\d+),\d+>/g, '<$1>')
  lxlyric = decodeName(lxlyric)
  lyric = lxlyric.replace(/<\d+,\d+>/g, '')
  rlyric = decodeName(rlyric)
  tlyric = decodeName(tlyric)
  return {
    lyric,
    tlyric,
    rlyric,
    lxlyric,
  }
}

export const decodeKrc = async(data) => {
  if (!window.electronAPI?.decodeKrcLyric) {
    throw new Error('KRC 解码仅支持 Electron 桌面端')
  }
  const text = await window.electronAPI.decodeKrcLyric(data)
  return parseLyric(text)
}
