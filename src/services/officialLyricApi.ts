import { Buffer } from 'buffer'
import type { LyricData, Song, SongPlatform, AudioQuality } from '@/types'
import { formatTime } from '@/utils/format'
import { decodeName } from '@/vendor/lxmusic/renderer/utils/index.js'
import { httpFetch } from '@/vendor/lxmusic/renderer/utils/request.js'
import kwLyric from '@/vendor/lxmusic/renderer/utils/musicSdk/kw/lyric.js'
import { lrcTools } from '@/vendor/lxmusic/renderer/utils/musicSdk/kw/util.js'
import mgLyric from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/lyric.js'
import { getMusicInfo as getMiguMusicInfo } from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/musicInfo.js'
import { decrypt as decryptMiguMrc } from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/utils/mrc.js'
import {
  fetchKugouLyric,
  fetchNeteaseLyric,
  fetchQqLyric,
  toLyricData,
} from './lyricSource'

type VendorSongQualityMeta = {
  type: AudioQuality | string
  size?: string
  hash?: string
}

type VendorSongInfo = {
  source: 'wy' | 'tx' | 'kw' | 'kg' | 'mg'
  name: string
  singer: string
  albumName: string
  albumId?: string
  songmid: string
  songId?: string
  albumMid?: string
  strMediaMid?: string
  hash?: string
  copyrightId?: string
  lrcUrl?: string
  mrcUrl?: string
  trcUrl?: string
  interval: string
  _interval?: number
  img?: string
  types?: VendorSongQualityMeta[]
  _types?: Record<string, { size?: string; hash?: string }>
}

type KuwoLegacyLyricLine = {
  lineLyric?: string
  time?: string | number
}

type KuwoLegacyLyricResponse = {
  data?: {
    lrclist?: KuwoLegacyLyricLine[]
    songinfo?: {
      songName?: string
      artist?: string
      album?: string
    }
  }
}

const KUWO_LEGACY_HEADERS = {
  Referer: 'https://m.kuwo.cn/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

const MIGU_LYRIC_HEADERS = {
  Referer: 'https://app.c.nf.migu.cn/',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36',
  channel: '0146921',
}


const KUWO_REQUEST_KEY = Buffer.from('yeelion')
const KUWO_WORD_TIME_ALL = /<(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,-?\d+(?:\.\d+)?)?>/g
const KUWO_EXIST_TIME_EXP = /\[\d{1,2}:.*\d{1,4}\]/

const buildKuwoLyricParams = (id: string, isGetLyricx: boolean) => {
  let params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${id}`
  if (isGetLyricx) params += '&lrcx=1'
  const source = Buffer.from(params)
  const output = new Uint16Array(source.length)
  let index = 0
  while (index < source.length) {
    let keyIndex = 0
    while (keyIndex < KUWO_REQUEST_KEY.length && index < source.length) {
      output[index] = KUWO_REQUEST_KEY[keyIndex] ^ source[index]
      index += 1
      keyIndex += 1
    }
  }
  return Buffer.from(output).toString('base64')
}

const decodeTextBuffer = (input: Uint8Array | Buffer, encoding: string) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch (error) {
    if (encoding.toLowerCase() === 'utf-8') return Buffer.from(bytes).toString('utf8')
    throw error instanceof Error ? error : new Error(`Text decode failed: ${encoding}`)
  }
}

const inflateKuwoLyricBuffer = async(input: Uint8Array | Buffer) => {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream unavailable')
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const normalized = new Uint8Array(bytes.byteLength)
  normalized.set(bytes)
  const stream = new Blob([normalized]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const decodeKuwoLyricFromRaw = async(raw: Uint8Array | Buffer, isGetLyricx: boolean) => {
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
  if (buffer.toString('utf8', 0, 10) !== 'tp=content') return ''

  const index = buffer.indexOf('\r\n\r\n')
  if (index < 0) return ''

  const lrcData = await inflateKuwoLyricBuffer(buffer.subarray(index + 4))
  if (!isGetLyricx) {
    return decodeTextBuffer(lrcData, 'gb18030')
  }

  const lyricxBuffer = Buffer.from(decodeTextBuffer(lrcData, 'utf-8'), 'base64')
  const output = new Uint8Array(lyricxBuffer.length)
  let indexPointer = 0
  while (indexPointer < lyricxBuffer.length) {
    let keyIndex = 0
    while (keyIndex < KUWO_REQUEST_KEY.length && indexPointer < lyricxBuffer.length) {
      output[indexPointer] = lyricxBuffer[indexPointer] ^ KUWO_REQUEST_KEY[keyIndex]
      indexPointer += 1
      keyIndex += 1
    }
  }

  return decodeTextBuffer(output, 'gb18030')
}

const requestKuwoLyricText = async(songmid: string, isGetLyricx: boolean) => {
  const requestObj = httpFetch(`https://newlyric.kuwo.cn/newlyric.lrc?${buildKuwoLyricParams(songmid, isGetLyricx)}`)
  const { statusCode, raw } = await requestObj.promise as any
  if (statusCode !== 200) throw new Error(`Kuwo lyric request failed: ${statusCode}`)

  let localDecodeError: unknown = null
  try {
    const localDecoded = await decodeKuwoLyricFromRaw(raw, isGetLyricx)
    if (localDecoded) return localDecoded
  } catch (error) {
    localDecodeError = error
  }

  const decoder = window.electronAPI?.decodeKwLyric
  if (typeof decoder !== 'function') {
    throw localDecodeError instanceof Error ? localDecodeError : new Error('KW 歌词解码不可用')
  }

  const base64 = await decoder({
    lrcBase64: Buffer.from(raw).toString('base64'),
    isGetLyricx,
  })
  if (!base64) {
    throw localDecodeError instanceof Error ? localDecodeError : new Error('Kuwo lyric decode empty')
  }

  return Buffer.from(base64, 'base64').toString()
}

const mapPlatformToSource = (platform: SongPlatform): VendorSongInfo['source'] => {
  switch (platform) {
    case 'netease':
      return 'wy'
    case 'qq':
      return 'tx'
    case 'kuwo':
      return 'kw'
    case 'kugou':
      return 'kg'
    case 'migu':
      return 'mg'
    default:
      throw new Error(`Unsupported lyric platform: ${platform}`)
  }
}

const isHashLike = (value: unknown): value is string => {
  return typeof value === 'string' && /^[a-fA-F0-9]{32}$/.test(value)
}

const pickKugouHash = (song: Song) => {
  const preferredQuality = song.quality
  const qualityHash = preferredQuality ? song.lx?._types?.[preferredQuality]?.hash : undefined
  if (qualityHash) return qualityHash

  if (song.lx?.hash) return song.lx.hash
  if (isHashLike(song.lx?.songmid)) return song.lx?.songmid
  if (isHashLike(song.id)) return song.id

  const typedHash = song.lx?.types?.find((item) => item?.hash)?.hash
  return typedHash || undefined
}

const toVendorSongInfo = (song: Song): VendorSongInfo => ({
  source: song.lx?.source || mapPlatformToSource(song.platform),
  name: song.name,
  singer: song.artist,
  albumName: song.album,
  albumId: song.lx?.albumId || song.albumId,
  songmid: song.lx?.songmid || song.id,
  songId: song.lx?.songId,
  albumMid: song.lx?.albumMid,
  strMediaMid: song.lx?.strMediaMid,
  hash: pickKugouHash(song),
  copyrightId: song.lx?.copyrightId,
  lrcUrl: song.lx?.lrcUrl,
  mrcUrl: song.lx?.mrcUrl,
  trcUrl: song.lx?.trcUrl,
  interval: song.lx?.interval || formatTime(song.duration),
  _interval: song.duration || undefined,
  img: song.cover || song.lx?.img,
  types: song.lx?.types,
  _types: song.lx?._types,
})

const mergeSongInfo = (base: VendorSongInfo, extra: Partial<VendorSongInfo> | null | undefined): VendorSongInfo => {
  if (!extra) return base

  return {
    ...extra,
    ...base,
    source: base.source,
    name: base.name || extra.name || '',
    singer: base.singer || extra.singer || '',
    albumName: base.albumName || extra.albumName || '',
    songmid: base.songmid || extra.songmid || '',
    songId: base.songId || extra.songId,
    albumId: base.albumId || extra.albumId,
    albumMid: base.albumMid || extra.albumMid,
    strMediaMid: base.strMediaMid || extra.strMediaMid,
    hash: base.hash || extra.hash,
    copyrightId: base.copyrightId || extra.copyrightId,
    lrcUrl: base.lrcUrl || extra.lrcUrl,
    mrcUrl: base.mrcUrl || extra.mrcUrl,
    trcUrl: base.trcUrl || extra.trcUrl,
    interval: base.interval || extra.interval || '',
    _interval: base._interval || extra._interval,
    img: base.img || extra.img,
    types: base.types?.length ? base.types : extra.types,
    _types: Object.keys(base._types || {}).length ? base._types : extra._types,
  }
}

const enrichSongInfo = async(song: Song, songInfo: VendorSongInfo): Promise<VendorSongInfo> => {
  switch (song.platform) {
    case 'migu': {
      if (songInfo.mrcUrl || songInfo.lrcUrl) return songInfo
      const lookupId = songInfo.copyrightId || songInfo.songmid
      if (!lookupId) return songInfo
      try {
        const info = await getMiguMusicInfo(lookupId)
        return mergeSongInfo(songInfo, info as Partial<VendorSongInfo> | null)
      } catch {
        return songInfo
      }
    }
    default:
      return songInfo
  }
}

const normalizeLyricData = (value: any): LyricData | null => {
  if (!value || typeof value !== 'object') return null
  const lyric = typeof value.lyric === 'string' ? value.lyric : ''
  const tlyric = typeof value.tlyric === 'string' ? value.tlyric : ''
  const rlyric = typeof value.rlyric === 'string' ? value.rlyric : ''
  const lxlyric = typeof value.lxlyric === 'string' ? value.lxlyric : ''
  if (!lyric && !tlyric && !rlyric && !lxlyric) return null
  return { lyric, tlyric, rlyric, lxlyric }
}

const stripKuwoWordTimes = (value: string | undefined) => (value || '').replace(KUWO_WORD_TIME_ALL, '')

const buildKuwoLyricDataFromDecodedText = (decodedText: string): LyricData => {
  const lrcInfo = kwLyric.parseLrc(decodedText) as LyricData
  let lxlyric = ''

  try {
    lxlyric = lrcTools.parse(lrcInfo.lyric || '') || ''
  } catch {
    lxlyric = ''
  }

  const lyric = stripKuwoWordTimes(lrcInfo.lyric)
  if (lyric && !KUWO_EXIST_TIME_EXP.test(lyric)) {
    throw new Error('Kuwo parsed lyric missing time labels')
  }

  return {
    lyric,
    tlyric: stripKuwoWordTimes(lrcInfo.tlyric),
    rlyric: lrcInfo.rlyric || '',
    lxlyric,
  }
}

const buildKuwoRawLyricData = (decodedText: string): LyricData => ({
  lyric: stripKuwoWordTimes(decodedText),
  tlyric: '',
  rlyric: '',
  lxlyric: '',
})

const fetchTextBody = async(url: string, headers?: Record<string, string>) => {
  const requestObj = httpFetch(url, { method: 'get', headers } as any)
  const { statusCode, body } = await requestObj.promise
  if (statusCode !== 200) throw new Error(`Request failed: ${statusCode}`)
  return typeof body === 'string' ? body : JSON.stringify(body)
}

const formatKuwoLegacyTime = (value: string | number | undefined) => {
  const numeric = typeof value === 'number' ? value : Number(value || 0)
  if (!Number.isFinite(numeric)) return null
  const minutes = Math.floor(numeric / 60)
  const seconds = numeric % 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
}

const buildKuwoLegacyLyric = (data: KuwoLegacyLyricResponse['data']) => {
  const lines = Array.isArray(data?.lrclist) ? data.lrclist : []
  if (!lines.length) return null

  const tags = [
    data?.songinfo?.songName ? `[ti:${decodeName(data.songinfo.songName)}]` : '',
    data?.songinfo?.artist ? `[ar:${decodeName(data.songinfo.artist)}]` : '',
    data?.songinfo?.album ? `[al:${decodeName(data.songinfo.album)}]` : '',
    '[by:]',
    '[offset:0]',
  ].filter(Boolean)

  const lyricLines = lines
    .map((item) => {
      const time = formatKuwoLegacyTime(item.time)
      if (!time) return ''
      const text = decodeName(String(item.lineLyric || '').trim())
      if (!text) return ''
      return `[${time}]${text}`
    })
    .filter(Boolean)

  if (!lyricLines.length) return null

  return {
    lyric: `${tags.join('\n')}\n${lyricLines.join('\n')}`,
    tlyric: '',
    rlyric: '',
    lxlyric: '',
  }
}

const loadKuwoLyricFallback = async(songInfo: VendorSongInfo) => {
  const requestObj = httpFetch(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${songInfo.songmid}`, {
    method: 'get',
    headers: KUWO_LEGACY_HEADERS,
  } as any)
  const { statusCode, body } = await requestObj.promise
  if (statusCode !== 200) throw new Error(`Kuwo legacy lyric failed: ${statusCode}`)
  const lyric = buildKuwoLegacyLyric((body as KuwoLegacyLyricResponse | undefined)?.data)
  if (!lyric) throw new Error('Kuwo legacy lyric empty')
  return lyric
}

const parseMiguMrc = (str: string) => {
  const lineTime = /^\s*\[(\d+),\d+\]/
  const wordTime = /\(\d+,\d+\)/
  const wordTimeAll = /(\(\d+,\d+\))/g
  const lines = str.replace(/\r/g, '').split('\n')
  const lxlrcLines: string[] = []
  const lrcLines: string[] = []

  for (const line of lines) {
    if (line.length < 6) continue
    const result = lineTime.exec(line)
    if (!result) continue

    const startTime = parseInt(result[1])
    let time = startTime
    const ms = time % 1000
    time = Math.floor(time / 1000)
    const minutes = Math.floor(time / 60)
    const seconds = time % 60
    const timeTag = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${ms}`
    const words = line.replace(lineTime, '')

    lrcLines.push(`[${timeTag}]${words.replace(wordTimeAll, '')}`)

    const matches = words.match(wordTimeAll)
    if (!matches) continue
    const times = matches.map((time) => {
      const matched = /\((\d+),(\d+)\)/.exec(time)
      return `<${parseInt(matched![1]) - startTime},${matched![2]}>`
    })
    const wordArr = words.split(wordTime)
    const newWords = times.map((time, index) => `${time}${wordArr[index]}`).join('')
    lxlrcLines.push(`[${timeTag}]${newWords}`)
  }

  return {
    lyric: lrcLines.join('\n'),
    lxlyric: lxlrcLines.join('\n'),
  }
}

const loadMiguLyricFallback = async(songInfo: VendorSongInfo) => {
  let info = songInfo
  if (!info.mrcUrl && !info.lrcUrl) {
    const lookupId = info.copyrightId || info.songmid
    if (!lookupId) throw new Error('Migu lyric lookup id missing')
    info = mergeSongInfo(info, await getMiguMusicInfo(lookupId) as Partial<VendorSongInfo> | null)
  }

  if (info.mrcUrl) {
    try {
      const encrypted = await fetchTextBody(info.mrcUrl, MIGU_LYRIC_HEADERS)
      const lyricInfo = parseMiguMrc(decryptMiguMrc(encrypted))
      const tlyric = info.trcUrl ? await fetchTextBody(info.trcUrl, MIGU_LYRIC_HEADERS).catch(() => '') : ''
      return { ...lyricInfo, tlyric, rlyric: '' }
    } catch {
      if (!info.lrcUrl) throw new Error('Migu mrc lyric failed')
    }
  }

  if (info.lrcUrl) {
    const lyric = await fetchTextBody(info.lrcUrl, MIGU_LYRIC_HEADERS)
    const tlyric = info.trcUrl ? await fetchTextBody(info.trcUrl, MIGU_LYRIC_HEADERS).catch(() => '') : ''
    return {
      lyric,
      tlyric,
      rlyric: '',
      lxlyric: '',
    }
  }

  throw new Error('Migu lyric empty')
}

const loadKuwoLyric = async(songInfo: VendorSongInfo) => {
  const errors: string[] = []

  try {
    const decodedText = await requestKuwoLyricText(songInfo.songmid, true)
    try {
      return buildKuwoLyricDataFromDecodedText(decodedText)
    } catch (error) {
      errors.push(`lyricx-parse=${error instanceof Error ? error.message : String(error)}`)
      return buildKuwoRawLyricData(decodedText)
    }
  } catch (error) {
    errors.push(`lyricx=${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const decodedText = await requestKuwoLyricText(songInfo.songmid, false)
    try {
      return buildKuwoLyricDataFromDecodedText(decodedText)
    } catch (error) {
      errors.push(`lyric-parse=${error instanceof Error ? error.message : String(error)}`)
      return buildKuwoRawLyricData(decodedText)
    }
  } catch (error) {
    errors.push(`lyric=${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    return await loadKuwoLyricFallback(songInfo)
  } catch (error) {
    errors.push(`legacy=${error instanceof Error ? error.message : String(error)}`)
    throw new Error(errors.join(' | ') || 'Kuwo lyric empty')
  }
}

const loadMiguLyric = async(songInfo: VendorSongInfo) => {
  try {
    return await mgLyric.getLyric(songInfo).promise
  } catch {
    return loadMiguLyricFallback(songInfo)
  }
}

export class OfficialLyricApiService {
  async getLyric(song: Song): Promise<LyricData | null> {
    if (song.platform === 'local') {
      return song.lrc ? { lyric: song.lrc } : null
    }

    const songInfo = await enrichSongInfo(song, toVendorSongInfo(song))

    try {
      switch (song.platform) {
        case 'netease':
          return toLyricData(await fetchNeteaseLyric(song))
        case 'qq':
          return toLyricData(await fetchQqLyric(song))
        case 'kuwo':
          return normalizeLyricData(await loadKuwoLyric(songInfo))
        case 'kugou':
          return toLyricData(await fetchKugouLyric(song))
        case 'migu':
          return normalizeLyricData(await loadMiguLyric(songInfo))
        default:
          return null
      }
    } catch (error) {
      console.error('[officialLyricApi] getLyric error:', {
        platform: song.platform,
        id: song.id,
        songmid: songInfo.songmid,
        songId: songInfo.songId,
        hash: songInfo.hash,
        copyrightId: songInfo.copyrightId,
        lrcUrl: songInfo.lrcUrl,
        mrcUrl: songInfo.mrcUrl,
        trcUrl: songInfo.trcUrl,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
}

export const officialLyricApi = new OfficialLyricApiService()
export default officialLyricApi
