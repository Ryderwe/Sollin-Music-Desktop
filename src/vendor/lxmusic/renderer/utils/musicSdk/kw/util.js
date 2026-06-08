import CryptoJS from 'crypto-js'
import { Buffer } from 'buffer'
import { toMD5 } from '../utils'

export const objStr2JSON = str => {
  return JSON.parse(str.replace(/('(?=(,\s*')))|('(?=:))|((?<=([:,]\s*))')|((?<={)')|('(?=}))/g, '"'))
}

export const formatSinger = rawData => rawData.replace(/&/g, '、')

export const matchToken = headers => {
  try {
    return headers['set-cookie'][0].match(/kw_token=(\w+)/)[1]
  } catch (err) {
    return null
  }
}

export const decodeLyric = async(payload) => {
  if (!window.electronAPI?.decodeKwLyric) throw new Error('KW 歌词解码仅支持 Electron 桌面端')
  return window.electronAPI.decodeKwLyric(payload)
}

export const lrcTools = {
  rxps: {
    wordLine: /^(\[\d{1,2}:.*\d{1,4}\])\s*(\S+(?:\s+\S+)*)?\s*/,
    tagLine: /\[(ver|ti|ar|al|offset|by|kuwo):\s*(\S+(?:\s+\S+)*)\s*\]/,
    wordTimeAll: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g,
    wordTime: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/,
  },
  offset: 1,
  offset2: 1,
  isOK: false,
  lines: [],
  tags: [],
  getWordInfo(str, str2, prevWord) {
    const offset = parseInt(str)
    const offset2 = parseInt(str2)
    let startTime = Math.abs((offset + offset2) / (this.offset * 2))
    let endTime = Math.abs((offset - offset2) / (this.offset2 * 2)) + startTime
    if (prevWord) {
      if (startTime < prevWord.endTime) {
        prevWord.endTime = startTime
        if (prevWord.startTime > prevWord.endTime) prevWord.startTime = prevWord.endTime
        prevWord.newTimeStr = `<${prevWord.startTime},${prevWord.endTime - prevWord.startTime}>`
      }
    }
    return {
      startTime,
      endTime,
      timeStr: `<${startTime},${endTime - startTime}>`,
    }
  },
  parseLine(line) {
    if (line.length < 6) return
    let result = this.rxps.wordLine.exec(line)
    if (result) {
      const time = result[1]
      let words = result[2] || ''
      const wordTimes = words.match(this.rxps.wordTimeAll)
      if (!wordTimes) return
      let preTimeInfo
      for (const timeStr of wordTimes) {
        const matched = this.rxps.wordTime.exec(timeStr)
        const wordInfo = this.getWordInfo(matched[1], matched[2], preTimeInfo)
        words = words.replace(timeStr, wordInfo.timeStr)
        if (preTimeInfo?.newTimeStr) words = words.replace(preTimeInfo.timeStr, preTimeInfo.newTimeStr)
        preTimeInfo = wordInfo
      }
      this.lines.push(time + words)
      return
    }
    result = this.rxps.tagLine.exec(line)
    if (!result) return
    if (result[1] == 'kuwo') {
      let content = result[2]
      if (content != null && content.includes('][')) content = content.substring(0, content.indexOf(']['))
      const valueOf = parseInt(content, 8)
      this.offset = Math.trunc(valueOf / 10)
      this.offset2 = Math.trunc(valueOf % 10)
      if (this.offset == 0 || Number.isNaN(this.offset) || this.offset2 == 0 || Number.isNaN(this.offset2)) this.isOK = false
    } else {
      this.tags.push(line)
    }
  },
  parse(lrc) {
    const lines = lrc.split(/\r\n|\r|\n/)
    const tools = Object.create(this)
    tools.isOK = true
    tools.offset = 1
    tools.offset2 = 1
    tools.lines = []
    tools.tags = []
    for (const line of lines) {
      if (!tools.isOK) throw new Error('failed')
      tools.parseLine(line)
    }
    if (!tools.lines.length) return ''
    let lrcs = tools.lines.join('\n')
    if (tools.tags.length) lrcs = `${tools.tags.join('\n')}\n${lrcs}`
    return lrcs
  },
}

const aesKey = CryptoJS.lib.WordArray.create([0x7057273d, 0xc7fa29bf, 0x39442d72, 0xdd5e8ce4])
const cipherOptions = {
  mode: CryptoJS.mode.ECB,
  padding: CryptoJS.pad.Pkcs7,
}

const wordArrayToBuffer = (wordArray) => Buffer.from(wordArray.toString(CryptoJS.enc.Hex), 'hex')
const bufferToWordArray = (buffer) => CryptoJS.lib.WordArray.create(buffer)

const createAesEncrypt = (buffer) => {
  const encrypted = CryptoJS.AES.encrypt(bufferToWordArray(buffer), aesKey, cipherOptions)
  return wordArrayToBuffer(encrypted.ciphertext)
}

const createAesDecrypt = (buffer) => {
  const decrypted = CryptoJS.AES.decrypt({ ciphertext: bufferToWordArray(buffer) }, aesKey, cipherOptions)
  return wordArrayToBuffer(decrypted)
}

export const wbdCrypto = {
  appId: 'y67sprxhhpws',
  decodeData(base64Result) {
    const data = Buffer.from(decodeURIComponent(base64Result), 'base64')
    return JSON.parse(createAesDecrypt(data).toString())
  },
  createSign(data, time) {
    return toMD5(`${this.appId}${data}${time}`).toUpperCase()
  },
  buildParam(jsonData) {
    const data = Buffer.from(JSON.stringify(jsonData))
    const time = Date.now()
    const encodeData = createAesEncrypt(data).toString('base64')
    const sign = this.createSign(encodeData, time)
    return `data=${encodeURIComponent(encodeData)}&time=${time}&appId=${this.appId}&sign=${sign}`
  },
}
