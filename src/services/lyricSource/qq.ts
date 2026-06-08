import { Buffer } from 'buffer'
import type { Song } from '@/types'
import { parseLrc, parseQrc } from './parsers'
import { decryptQrc } from './qmCrypto'
import type { LyricsResult } from './types'

const QM_FCG_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const QM_SEARCH_FCG_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const QM_LEGACY_LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg'

const COMM = {
  ct: '19',
  cv: '1859',
  uin: '0',
}

const QM_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Referer': 'https://y.qq.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
}

const QM_LEGACY_HEADERS: Record<string, string> = {
  'Referer': 'https://y.qq.com/portal/player.html',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

interface QmResponseModule<T> {
  code?: number
  data?: T | null
}
interface QmBaseWrapper<T> {
  req_0?: QmResponseModule<T>
  req?: QmResponseModule<T>
}

interface QmLyricsData {
  lyric?: string
  trans?: string
  roma?: string
}

interface QmSearchData {
  body?: {
    item_song?: Array<{
      id: string | number
      mid?: string
      title?: string
      singer?: Array<{ name?: string }>
      album?: { name?: string; mid?: string }
      interval?: number
    }>
  }
}

interface QmSearchMatch {
  id: string
  mid: string
  title: string
  album: string
  artist: string
  duration: number
}

interface QmSongDetailData {
  track_info?: {
    id?: string | number
    mid?: string
    title?: string
    name?: string
    interval?: number
    singer?: Array<{ name?: string }>
    album?: { name?: string; mid?: string }
  }
}

interface QmLegacyLyricResponse {
  code?: number
  retcode?: number
  lyric?: string
  trans?: string
  roma?: string
}

const httpFetchJson = async <T,>(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<T> => {
  const electronHttp = globalThis.window?.electronAPI?.httpRequest
  const requestMethod = (init?.method || 'GET').toUpperCase()
  const headers = { ...(init?.headers || {}) }
  const body = init?.body

  if (typeof electronHttp === 'function') {
    const response = await electronHttp({
      url,
      method: requestMethod,
      headers,
      body: body as any,
    })
    if (response && response.status >= 400) {
      throw new Error(`HTTP ${response.status}`)
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

const toBase64 = (text: string) => Buffer.from(text || '', 'utf8').toString('base64')

const decodeBase64Text = (value: string | undefined): string => {
  if (!value) return ''
  try {
    return Buffer.from(value, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

const decodeHtmlText = (value: string): string => {
  if (!value) return ''
  const Parser = (globalThis as any).DOMParser
  if (typeof Parser === 'function') {
    try {
      return new Parser().parseFromString(value, 'text/html').body.textContent || ''
    } catch {
      // Fall through to the lightweight entity cleanup below.
    }
  }
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

const isValidSongId = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value.trim())

const requestSearch = async(keyword: string, pageSize = 5): Promise<QmSearchMatch[]> => {
  const searchId = String(Math.floor(1e16 + Math.random() * 8e16))
  const reqBody = {
    comm: COMM,
    req_0: {
      method: 'DoSearchForQQMusicLite',
      module: 'music.search.SearchCgiService',
      param: {
        search_id: searchId,
        remoteplace: 'search.android.keyboard',
        query: keyword,
        search_type: 0,
        num_per_page: pageSize,
        page_num: 1,
        highlight: 0,
        nqc_flag: 0,
        page_id: 1,
        grp: 1,
      },
    },
  }
  const resp = await httpFetchJson<QmBaseWrapper<QmSearchData>>(QM_SEARCH_FCG_URL, {
    method: 'POST',
    headers: QM_HEADERS,
    body: JSON.stringify(reqBody),
  })
  const items = resp?.req_0?.data?.body?.item_song || resp?.req?.data?.body?.item_song || []
  return items.map((item) => ({
    id: String(item.id),
    mid: String(item.mid || ''),
    title: String(item.title || ''),
    album: String(item.album?.name || ''),
    artist: (item.singer || []).map((s) => s?.name || '').filter(Boolean).join('/'),
    duration: Number(item.interval || 0) * 1000,
  }))
}

const applySearchMatch = (match: QmSearchMatch, current: QmLyricLookup): QmLyricLookup => ({
  songId: match.id || current.songId,
  songmid: match.mid || current.songmid,
  title: match.title || current.title,
  album: match.album || current.album,
  artist: match.artist || current.artist,
  durationSec: match.duration ? Math.round(match.duration / 1000) : current.durationSec,
})

const requestSongDetailBySongmid = async(songmid: string): Promise<QmLyricLookup | null> => {
  if (!songmid) return null

  const reqBody = {
    comm: COMM,
    req: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: {
        song_type: 0,
        song_mid: songmid,
      },
    },
  }

  const resp = await httpFetchJson<QmBaseWrapper<QmSongDetailData>>(QM_FCG_URL, {
    method: 'POST',
    headers: QM_HEADERS,
    body: JSON.stringify(reqBody),
  })
  const track = resp?.req?.data?.track_info
  const songId = String(track?.id || '').trim()
  if (!isValidSongId(songId)) return null

  return {
    songId,
    songmid: String(track?.mid || songmid),
    title: String(track?.title || track?.name || ''),
    album: String(track?.album?.name || ''),
    artist: (track?.singer || []).map((s) => s?.name || '').filter(Boolean).join('/'),
    durationSec: Number(track?.interval || 0),
  }
}

interface QmLyricLookup {
  songId: number | string
  songmid?: string
  title: string
  album: string
  artist: string
  durationSec: number
}

const requestLyric = async(input: QmLyricLookup): Promise<QmLyricsData | null> => {
  const songIdNumeric = Number(input.songId)
  if (!Number.isFinite(songIdNumeric) || songIdNumeric <= 0) return null

  const reqBody = {
    comm: COMM,
    req_0: {
      method: 'GetPlayLyricInfo',
      module: 'music.musichallSong.PlayLyricInfo',
      param: {
        songID: songIdNumeric,
        songName: toBase64(input.title || ''),
        albumName: toBase64(input.album || ''),
        singerName: toBase64(input.artist || ''),
        format: 'json',
        crypt: 1,
        qrc: 1,
        trans: 1,
        roma: 1,
        cv: 1873,
        ct: 19,
        lrc_t: 0,
        qrc_t: 0,
        roma_t: 0,
        trans_t: 0,
        type: -1,
        interval: input.durationSec,
      },
    },
  }
  const resp = await httpFetchJson<QmBaseWrapper<QmLyricsData>>(QM_FCG_URL, {
    method: 'POST',
    headers: QM_HEADERS,
    body: JSON.stringify(reqBody),
  })
  return resp?.req_0?.data || resp?.req?.data || null
}

const requestLegacyLyricBySongmid = async(songmid: string): Promise<LyricsResult | null> => {
  if (!songmid) return null

  const query = new URLSearchParams({
    songmid,
    g_tk: '5381',
    loginUin: '0',
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    platform: 'yqq',
  })

  const resp = await httpFetchJson<QmLegacyLyricResponse>(`${QM_LEGACY_LYRIC_URL}?${query.toString()}`, {
    method: 'GET',
    headers: QM_LEGACY_HEADERS,
  })
  if (resp?.code !== 0 && resp?.retcode !== 0) return null

  const lyric = decodeHtmlText(decodeBase64Text(resp?.lyric))
  if (!lyric) return null

  return parseLrc(
    lyric,
    decodeHtmlText(decodeBase64Text(resp?.trans)),
    decodeHtmlText(decodeBase64Text(resp?.roma)),
  )
}

const decodeWithNative = async(payload: { lyric?: string; trans?: string; roma?: string }) => {
  const decoder = globalThis.window?.electronAPI?.decodeTxLyric
  if (typeof decoder !== 'function') {
    throw new Error('TX QRC decoder unavailable')
  }
  const result = await decoder({
    lrc: payload.lyric || '',
    tlrc: payload.trans || '',
    rlrc: payload.roma || '',
  })
  return {
    lyric: result?.lyric || '',
    trans: result?.tlyric || '',
    roma: result?.rlyric || '',
  }
}

const decodeQrcValue = async(value: string | undefined) => {
  if (!value) return ''
  try {
    return await decryptQrc(value)
  } catch {
    return ''
  }
}

const decodeAllEncrypted = async(payload: { lyric?: string; trans?: string; roma?: string }) => {
  const [lyric, trans, roma] = await Promise.all([
    decodeQrcValue(payload.lyric),
    decodeQrcValue(payload.trans),
    decodeQrcValue(payload.roma),
  ])

  const needsNativeFallback = Boolean(
    (payload.lyric && !lyric)
    || (payload.trans && !trans)
    || (payload.roma && !roma),
  )
  if (!needsNativeFallback) return { lyric, trans, roma }

  try {
    const nativeDecoded = await decodeWithNative(payload)
    return {
      lyric: lyric || nativeDecoded.lyric,
      trans: trans || nativeDecoded.trans,
      roma: roma || nativeDecoded.roma,
    }
  } catch {
    return { lyric, trans, roma }
  }
}

const isLikelyEncryptedHex = (value: string | undefined): boolean => {
  if (!value) return false
  return /^[0-9A-Fa-f]+$/.test(value.trim()) && value.trim().length >= 16
}

const isLikelyLrc = (value: string | undefined): boolean => {
  if (!value) return false
  return /^\[\d{1,2}:\d{2}/.test(value.trim())
}

const decodeAllPayload = async(payload: QmLyricsData) => {
  const lyricEncrypted = isLikelyEncryptedHex(payload.lyric) && !isLikelyLrc(payload.lyric)
  const transEncrypted = isLikelyEncryptedHex(payload.trans) && !isLikelyLrc(payload.trans)
  const romaEncrypted = isLikelyEncryptedHex(payload.roma) && !isLikelyLrc(payload.roma)

  if (lyricEncrypted || transEncrypted || romaEncrypted) {
    try {
      const decoded = await decodeAllEncrypted({
        lyric: lyricEncrypted ? payload.lyric : '',
        trans: transEncrypted ? payload.trans : '',
        roma: romaEncrypted ? payload.roma : '',
      })
      return {
        lyric: decoded.lyric || (lyricEncrypted ? '' : (payload.lyric || '')),
        trans: decoded.trans || (transEncrypted ? '' : (payload.trans || '')),
        roma: decoded.roma || (romaEncrypted ? '' : (payload.roma || '')),
      }
    } catch {
      return {
        lyric: lyricEncrypted ? '' : (payload.lyric || ''),
        trans: transEncrypted ? '' : (payload.trans || ''),
        roma: romaEncrypted ? '' : (payload.roma || ''),
      }
    }
  }

  return {
    lyric: payload.lyric || '',
    trans: payload.trans || '',
    roma: payload.roma || '',
  }
}

export const fetchQqLyric = async(song: Song): Promise<LyricsResult | null> => {
  const songIdCandidate = song.lx?.songId || (song.platform === 'qq' ? song.id : '')
  const numericSongId = isValidSongId(songIdCandidate) ? songIdCandidate : null
  const songmidCandidate = song.lx?.songmid || (song.platform === 'qq' && !isValidSongId(song.id) ? song.id : '')

  let songId: string | null = numericSongId
  let songmid = songmidCandidate
  let lookup: QmLyricLookup = {
    songId: songId || '',
    songmid,
    title: song.name,
    album: song.album,
    artist: song.artist,
    durationSec: Math.max(0, Math.round(song.duration || 0)),
  }

  if (!songId && songmid) {
    const detail = await requestSongDetailBySongmid(songmid).catch(() => null)
    if (detail) {
      songId = String(detail.songId)
      songmid = detail.songmid || songmid
      lookup = {
        ...lookup,
        ...detail,
        songId,
        songmid,
        title: detail.title || lookup.title,
        album: detail.album || lookup.album,
        artist: detail.artist || lookup.artist,
        durationSec: detail.durationSec || lookup.durationSec,
      }
    }
  }

  if (!songId || !songmid) {
    const matches = await requestSearch(`${song.name} ${song.artist}`.trim(), 5)
    const best = songId ? matches.find((item) => item.id === songId) : matches[0]
    if (!best && !songId) return null
    if (best) {
      songId = best.id
      songmid = best.mid || songmid
      lookup = applySearchMatch(best, {
        ...lookup,
        songId,
        songmid,
      })
    }
  }

  if (!songId) return null

  const payload = await requestLyric({
    songId,
    title: lookup.title,
    album: lookup.album,
    artist: lookup.artist,
    durationSec: lookup.durationSec,
  })

  if (payload) {
    const decoded = await decodeAllPayload(payload)
    if (decoded.lyric) {
      const result = parseQrc(decoded.lyric, decoded.trans, decoded.roma)
      if (result.original.length) return result
    }
  }

  return songmid ? requestLegacyLyricBySongmid(songmid) : null
}
