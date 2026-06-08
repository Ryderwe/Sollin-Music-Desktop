import { Buffer } from 'buffer'
import CryptoJS from 'crypto-js'
import type { Song } from '@/types'
import { parseKrc } from './parsers'
import type { LyricsResult } from './types'

const KG_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'
const SEARCH_SONG_URL = 'http://complexsearch.kugou.com/v2/search/song'
const SEARCH_LYRIC_URL = 'https://lyrics.kugou.com/v1/search'
const DOWNLOAD_LYRIC_URL = 'http://lyrics.kugou.com/download'
const REGISTER_DEV_URL = 'https://userservice.kugou.com/risk/v1/r_register_dev'

interface KgCandidate {
  id: string | number
  accesskey: string
  duration: number
  hash?: string
}

interface KgLyricSearchResponse {
  status?: number
  errcode?: number
  error_code?: number
  candidates?: KgCandidate[]
}

interface KgLyricContent {
  content: string
  fmt: string
  contenttype?: number
  charset?: string
}

interface KgSearchSongItem {
  ID?: string | number
  FileHash?: string
  SongName?: string
  AlbumName?: string
  Duration?: number
  Singers?: Array<{ name?: string }>
}

interface KgSearchSongResponse {
  status?: number
  error_code?: number
  data?: { lists?: KgSearchSongItem[]; total?: number }
}

interface KgRegisterDevResponse {
  status?: number
  error_code?: number
  data?: { dfid?: string }
}

const md5 = (input: string): string =>
  CryptoJS.MD5(input).toString(CryptoJS.enc.Hex)

const computeDeviceMid = () => md5(`${Date.now()}${Math.random()}`)

let cachedDeviceMid: string | null = null
const getDeviceMid = () => {
  if (!cachedDeviceMid) cachedDeviceMid = computeDeviceMid()
  return cachedDeviceMid
}

let cachedDfid: string | null = null
let dfidPromise: Promise<string> | null = null

type Module = 'Search' | 'Lyric'

const httpFetchJson = async <T,>(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<T> => {
  const electronHttp = globalThis.window?.electronAPI?.httpRequest
  const requestMethod = (init?.method || 'GET').toUpperCase()
  const headers = { ...(init?.headers || {}) }

  if (typeof electronHttp === 'function') {
    const response = await electronHttp({
      url,
      method: requestMethod,
      headers,
      body: init?.body as any,
    })
    if (!response || (response.status && response.status >= 400)) {
      throw new Error(`HTTP ${response?.status ?? 'unknown'}`)
    }
    if (typeof response.bodyBase64 === 'string' && response.bodyBase64) {
      const text = Buffer.from(response.bodyBase64, 'base64').toString('utf8')
      try { return JSON.parse(text) as T } catch { return text as unknown as T }
    }
    const text = response.bodyText || ''
    try { return JSON.parse(text) as T } catch { return text as unknown as T }
  }

  const response = await fetch(url, {
    ...init,
    headers,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  try { return JSON.parse(text) as T } catch { return text as unknown as T }
}

const buildQueryString = (params: Record<string, string>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) search.append(key, value)
  return search.toString()
}

const buildSignedParams = async(
  custom: Record<string, string>,
  body: string,
  module: Module,
): Promise<Record<string, string>> => {
  const params: Record<string, string> = {}

  if (module === 'Lyric') {
    params.appid = '3116'
    params.clientver = '11070'
  } else {
    params.userid = '0'
    params.appid = '3116'
    params.token = ''
    params.clienttime = String(Math.floor(Date.now() / 1000))
    params.iscorrection = '1'
    params.uuid = '-'
    params.mid = getDeviceMid()
    params.dfid = module === 'Search' ? '-' : await getDfid()
    params.clientver = '11070'
    params.platform = 'AndroidFilter'
  }

  for (const [key, value] of Object.entries(custom)) params[key] = value

  const sortedKeys = Object.keys(params).sort()
  const sortedString = sortedKeys.map((key) => `${key}=${params[key]}`).join('')
  const raw = `${KG_SALT}${sortedString}${body}${KG_SALT}`
  params.signature = md5(raw)
  return params
}

const getDfid = async(): Promise<string> => {
  if (cachedDfid && cachedDfid !== '-') return cachedDfid
  if (dfidPromise) return dfidPromise

  dfidPromise = (async() => {
    try {
      const params: Record<string, string> = {
        appid: '1014',
        platid: '4',
        mid: getDeviceMid(),
      }
      const sortedValues = Object.values(params)
        .filter((value) => value)
        .sort()
        .join('')
      params.signature = md5(`1014${sortedValues}1014`)

      const bodyJson = '{"uuid":""}'
      const bodyBase64 = Buffer.from(bodyJson, 'utf8').toString('base64')
      const url = `${REGISTER_DEV_URL}?${buildQueryString(params)}`
      const resp = await httpFetchJson<KgRegisterDevResponse>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: bodyBase64,
      })
      const dfid = resp?.data?.dfid
      cachedDfid = dfid && resp.error_code === 0 ? dfid : '-'
      return cachedDfid
    } catch {
      cachedDfid = '-'
      return cachedDfid
    } finally {
      dfidPromise = null
    }
  })()

  return dfidPromise
}

interface SearchOptions {
  keyword: string
  pageSize?: number
}

interface SongCandidate {
  id: string
  hash: string
  title: string
  artist: string
  album: string
  duration: number
}

const searchSong = async({ keyword, pageSize = 10 }: SearchOptions): Promise<SongCandidate[]> => {
  const params: Record<string, string> = {
    keyword,
    page: '1',
    pagesize: String(pageSize),
  }
  const signed = await buildSignedParams(params, '', 'Search')
  const url = `${SEARCH_SONG_URL}?${buildQueryString(signed)}`
  const resp = await httpFetchJson<KgSearchSongResponse>(url, {
    headers: { 'x-router': 'complexsearch.kugou.com' },
  })
  if (!resp || resp.error_code !== 0 || !resp.data?.lists) return []
  return resp.data.lists
    .map((item): SongCandidate | null => {
      const hash = String(item.FileHash || '')
      if (!hash) return null
      return {
        id: String(item.ID ?? ''),
        hash,
        title: String(item.SongName || ''),
        artist: (item.Singers || [])
          .map((s) => s?.name || '')
          .filter(Boolean)
          .join('/'),
        album: String(item.AlbumName || ''),
        duration: Number(item.Duration || 0) * 1000,
      }
    })
    .filter((item): item is SongCandidate => Boolean(item))
}

const isHash = (value: string | undefined | null): value is string =>
  Boolean(value && /^[a-fA-F0-9]{32}$/.test(value))

const HEADERS = (): Record<string, string> => ({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
})

const decodeKrcContent = async(rawBase64: string, contentType: number | undefined) => {
  if (!rawBase64) return ''
  if (contentType === 2) {
    return Buffer.from(rawBase64, 'base64').toString('utf-8')
  }

  const decoder = window.electronAPI?.decodeKrcLyric
  if (typeof decoder !== 'function') {
    throw new Error('KRC decoder unavailable')
  }
  const result = await decoder(rawBase64)
  return result || ''
}

const fetchKrcLyric = async(candidate: KgCandidate): Promise<LyricsResult | null> => {
  const downloadParams: Record<string, string> = {
    accesskey: candidate.accesskey,
    charset: 'utf8',
    client: 'mobi',
    fmt: 'krc',
    id: String(candidate.id),
    ver: '1',
  }
  const signed = await buildSignedParams(downloadParams, '', 'Lyric')
  const url = `${DOWNLOAD_LYRIC_URL}?${buildQueryString(signed)}`
  const resp = await httpFetchJson<KgLyricContent>(url, { headers: HEADERS() })
  if (!resp?.content) return null
  const text = await decodeKrcContent(resp.content, resp.contenttype)
  if (!text) return null
  return parseKrc(text)
}

interface KgLyricLookup {
  hash: string
  audioId?: string
  duration: number
  title: string
  artist: string
}

const requestLyricCandidates = async(input: KgLyricLookup) => {
  const params: Record<string, string> = {
    album_audio_id: input.audioId || '',
    duration: String(input.duration),
    hash: input.hash,
    keyword: `${input.artist || ''} - ${input.title}`.trim(),
    lrctxt: '1',
    man: 'no',
  }
  const signed = await buildSignedParams(params, '', 'Lyric')
  const url = `${SEARCH_LYRIC_URL}?${buildQueryString(signed)}`
  const resp = await httpFetchJson<KgLyricSearchResponse>(url, { headers: HEADERS() })
  return resp?.candidates || []
}

const pickKugouHash = (song: Song): string | undefined => {
  const fromQualityMap = song.quality ? song.lx?._types?.[song.quality]?.hash : undefined
  if (isHash(fromQualityMap)) return fromQualityMap
  if (isHash(song.lx?.hash)) return song.lx?.hash
  if (isHash(song.lx?.songmid)) return song.lx?.songmid
  if (isHash(song.id)) return song.id
  const typed = song.lx?.types?.find((item) => isHash(item?.hash))?.hash
  if (isHash(typed)) return typed
  return undefined
}

export const fetchKugouLyric = async(song: Song): Promise<LyricsResult | null> => {
  const directHash = pickKugouHash(song)
  const audioId = song.lx?.songmid && !isHash(song.lx.songmid) ? song.lx.songmid : (!isHash(song.id) ? song.id : '')
  const durationMs = Math.max(0, Math.round((song.duration || 0) * 1000))

  if (directHash) {
    const candidates = await requestLyricCandidates({
      hash: directHash,
      audioId,
      duration: durationMs,
      title: song.name,
      artist: song.artist,
    })
    if (candidates.length) {
      const lyric = await fetchKrcLyric(candidates[0])
      if (lyric && lyric.original.length) return lyric
    }
  }

  // Fallback: search by keyword
  const keyword = `${song.name || ''} ${song.artist || ''}`.trim()
  if (!keyword) return null
  const matches = await searchSong({ keyword, pageSize: 10 })
  if (!matches.length) return null
  const candidate = matches[0]
  const candidates = await requestLyricCandidates({
    hash: candidate.hash,
    audioId: candidate.id,
    duration: candidate.duration,
    title: candidate.title,
    artist: candidate.artist,
  })
  if (!candidates.length) return null
  return fetchKrcLyric(candidates[0])
}
