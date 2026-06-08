import { Buffer } from 'buffer'
import CryptoJS from 'crypto-js'
import type { Song } from '@/types'
import { parseYrc } from './parsers'
import type { LyricsResult } from './types'

const EAPI_KEY = 'e82ckenh8dichen8'
const HOST = 'https://interface.music.163.com'
const APP_VER = '3.1.3.203419'
const OS_VER = 'Microsoft-Windows-10--build-19045-64bit'
const DEVICEID_XOR_KEY = '3go8&$8*3*3h0k(2)2'

const STORAGE_KEY = 'sollin.netease.lyricSource.v1'
const SESSION_TTL = 10 * 24 * 60 * 60 * 1000 // 10 days

// ---------------- Crypto helpers ----------------

const md5Hex = (input: string): string =>
  CryptoJS.MD5(input).toString(CryptoJS.enc.Hex)

const aesEcbEncrypt = (text: string): string => {
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(text),
    CryptoJS.enc.Utf8.parse(EAPI_KEY),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  )
  return encrypted.ciphertext.toString(CryptoJS.enc.Hex).toUpperCase()
}

const aesEcbDecryptToString = (cipherBase64: string): string => {
  const params = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(cipherBase64),
  })
  const decrypted = CryptoJS.AES.decrypt(
    params,
    CryptoJS.enc.Utf8.parse(EAPI_KEY),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  )
  return decrypted.toString(CryptoJS.enc.Utf8)
}

const buildEapiParams = (path: string, jsonParams: string): string => {
  const message = `nobody${path}use${jsonParams}md5forencrypt`
  const digest = md5Hex(message)
  const data = `${path}-36cd479b6b5-${jsonParams}-36cd479b6b5-${digest}`
  return aesEcbEncrypt(data)
}

const randomHex = (len: number) => {
  let out = ''
  while (out.length < len) {
    out += Math.random().toString(16).slice(2)
  }
  return out.slice(0, len)
}

const buildClientSign = (): string => {
  const mac = Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase(),
  ).join(':')
  const random = Array.from({ length: 8 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join('')
  return `${mac}@@@${random}@@@@@@${randomHex(64)}`
}

const buildDeviceId = () => randomHex(32)

// ---------------- Session management ----------------

interface NeSession {
  cookies: Record<string, string>
  userId: number
  initAt: number
  deviceId: string
  clientSign: string
}

let session: NeSession | null = null
let initPromise: Promise<void> | null = null

const loadSession = (): NeSession | null => {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as NeSession
    if (!parsed?.cookies || !parsed.userId) return null
    if (Date.now() - parsed.initAt > SESSION_TTL) return null
    return parsed
  } catch {
    return null
  }
}

const saveSession = (next: NeSession) => {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

const clearSession = () => {
  try { window.localStorage?.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  session = null
}

// ---------------- HTTP helpers ----------------

const httpRaw = async(
  url: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: string,
) => {
  const electronHttp = globalThis.window?.electronAPI?.httpRequest
  if (typeof electronHttp !== 'function') {
    throw new Error('Netease lyric source requires electronAPI.httpRequest')
  }
  const response = await electronHttp({ url, method, headers, body })
  if (!response) throw new Error('No response')

  const status = response.status
  const setCookies = Array.isArray((response as any).setCookies) ? (response as any).setCookies as string[] : []
  const bodyBase64 = (response as any).bodyBase64 as string | undefined
  const bodyBuffer = bodyBase64 ? Buffer.from(bodyBase64, 'base64') : Buffer.from(response.bodyText || '', 'utf8')
  return { status, headers: response.headers || {}, setCookies, bodyBuffer }
}

const cookieToString = (cookies: Record<string, string>) =>
  Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ')

const parseSetCookies = (setCookies: string[], current: Record<string, string>) => {
  const next = { ...current }
  for (const raw of setCookies) {
    const first = raw.split(';')[0]
    const eq = first.indexOf('=')
    if (eq < 0) continue
    const key = first.slice(0, eq).trim()
    const value = first.slice(eq + 1).trim()
    if (key) next[key] = value
  }
  return next
}

// ---------------- Anonymous init ----------------

const buildAnonimousUsername = (deviceId: string): string => {
  const keyLength = DEVICEID_XOR_KEY.length
  let xored = ''
  for (let i = 0; i < deviceId.length; i++) {
    const codePoint = deviceId.charCodeAt(i) ^ DEVICEID_XOR_KEY.charCodeAt(i % keyLength)
    xored += String.fromCharCode(codePoint)
  }
  const md5Bytes = CryptoJS.MD5(CryptoJS.enc.Utf8.parse(xored))
  const md5Base64 = md5Bytes.toString(CryptoJS.enc.Base64)
  const combined = `${deviceId} ${md5Base64}`
  return Buffer.from(combined, 'utf-8').toString('base64')
}

const buildEapiBody = (
  path: string,
  params: Record<string, unknown>,
  preCookies: Record<string, string>,
) => {
  const headerParam = {
    clientSign: preCookies.clientSign || '',
    osver: preCookies.osver || '',
    deviceId: preCookies.deviceId || '',
    os: preCookies.os || '',
    appver: preCookies.appver || '',
    requestId: String(Date.now()),
  }

  const finalParams: Record<string, unknown> = { ...params }
  finalParams.header = JSON.stringify(headerParam)
  if (!('e_r' in finalParams)) finalParams.e_r = true

  const paramsStr = JSON.stringify(finalParams)
  const encryptPath = path.replace('/eapi/', '/api/')
  const encrypted = buildEapiParams(encryptPath, paramsStr)
  return `params=${encrypted}`
}

const PRE_COOKIE_MODES = [
  'MS-iCraft B760M WIFI',
  'ASUS ROG STRIX Z790',
  'MSI MAG B550 TOMAHAWK',
  'ASRock X670E Taichi',
  'GIGABYTE Z790 AORUS ELITE',
]

const ensureInit = async(): Promise<void> => {
  if (session) return
  if (initPromise) return initPromise

  initPromise = (async() => {
    const cached = loadSession()
    if (cached) {
      session = cached
      return
    }

    const deviceId = buildDeviceId()
    const clientSign = buildClientSign()
    const preCookies: Record<string, string> = {
      os: 'pc',
      deviceId,
      osver: `Microsoft-Windows-10--build-${20000 + Math.floor(Math.random() * 10000)}-64bit`,
      clientSign,
      channel: 'netease',
      mode: PRE_COOKIE_MODES[Math.floor(Math.random() * PRE_COOKIE_MODES.length)],
      appver: APP_VER,
    }

    const path = '/eapi/register/anonimous'
    const username = buildAnonimousUsername(deviceId)
    const body = buildEapiBody(path, { username, e_r: true }, preCookies)
    const headers: Record<string, string> = {
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/${APP_VER}`,
      Referer: 'https://music.163.com/',
      Cookie: cookieToString(preCookies),
      Accept: '*/*',
      Host: 'interface.music.163.com',
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    const response = await httpRaw(`${HOST}${path}`, 'POST', headers, body)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Anonymous login failed: ${response.status}`)
    }

    const cookies = parseSetCookies(response.setCookies, preCookies)
    cookies.WNMCID = `${randomHex(6)}.${Date.now()}.01.0`

    const decoded = aesEcbDecryptToString(response.bodyBuffer.toString('base64'))
    if (!decoded) throw new Error('Anonymous login decryption failed')

    let parsed: any
    try { parsed = JSON.parse(decoded) } catch { throw new Error('Anonymous login response invalid') }
    const code = parsed?.code
    if (code !== 200 && code !== '200') throw new Error(`Anonymous login code: ${code}`)
    const userId = Number(parsed?.userId || 0)

    const next: NeSession = {
      cookies,
      userId,
      initAt: Date.now(),
      deviceId,
      clientSign,
    }
    session = next
    saveSession(next)
  })().finally(() => {
    initPromise = null
  })

  return initPromise
}

// ---------------- API request ----------------

const doEapiRequest = async(path: string, params: Record<string, unknown>): Promise<string> => {
  await ensureInit()
  if (!session) throw new Error('Netease session unavailable')
  const cookies = session.cookies

  const headerParam = {
    clientSign: session.clientSign,
    osver: OS_VER,
    deviceId: session.deviceId,
    os: 'pc',
    appver: APP_VER,
    requestId: String(Date.now()),
  }

  const finalParams: Record<string, unknown> = { ...params }
  finalParams.header = JSON.stringify(headerParam)
  if (!('e_r' in finalParams)) finalParams.e_r = true

  const paramsStr = JSON.stringify(finalParams)
  const encryptPath = path.replace('/eapi/', '/api/')
  const encrypted = buildEapiParams(encryptPath, paramsStr)
  const body = `params=${encrypted}`

  const headers: Record<string, string> = {
    'User-Agent': `Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/${APP_VER}`,
    Referer: 'https://music.163.com/',
    Cookie: cookieToString(cookies),
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  const response = await httpRaw(`${HOST}${path}`, 'POST', headers, body)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Netease eapi request failed: ${response.status}`)
  }
  if (!response.bodyBuffer.length) return ''

  let decoded = ''
  try {
    decoded = aesEcbDecryptToString(response.bodyBuffer.toString('base64'))
  } catch (error) {
    throw new Error(`Netease eapi decrypt failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!decoded) return ''

  if (decoded.includes('"code":301') || decoded.includes('"code":401')) {
    clearSession()
  }

  return decoded
}

// ---------------- Lyric fetching ----------------

interface NeSearchSongData {
  id?: number
  name?: string
  alia?: string[]
  ar?: Array<{ id?: number; name?: string }>
  al?: { id?: number; name?: string; picUrl?: string }
  dt?: number
}

interface NeSearchResponse {
  code?: number
  data?: {
    resources?: Array<{
      baseInfo?: { simpleSongData?: NeSearchSongData }
    }>
  }
}

interface NeLyricResponse {
  code?: number
  yrc?: { lyric?: string }
  lrc?: { lyric?: string }
  tlyric?: { lyric?: string }
  romalrc?: { lyric?: string }
}

const searchSong = async(keyword: string, pageSize = 5): Promise<string | null> => {
  const path = '/eapi/search/song/list/page'
  const params = {
    limit: String(pageSize),
    offset: '0',
    keyword,
    scene: 'NORMAL',
    needCorrect: 'true',
  }
  let raw = ''
  try {
    raw = await doEapiRequest(path, params)
  } catch {
    return null
  }
  if (!raw) return null
  let resp: NeSearchResponse | null = null
  try { resp = JSON.parse(raw) as NeSearchResponse } catch { return null }
  if (!resp || resp.code !== 200) return null
  const first = resp.data?.resources?.[0]?.baseInfo?.simpleSongData
  return first?.id ? String(first.id) : null
}

export const fetchNeteaseLyric = async(song: Song): Promise<LyricsResult | null> => {
  let songId = (song.platform === 'netease' && song.id && /^\d+$/.test(song.id)) ? song.id : ''
  if (!songId && song.lx?.songmid && /^\d+$/.test(song.lx.songmid)) songId = song.lx.songmid

  if (!songId) {
    const fallback = await searchSong(`${song.name} ${song.artist}`.trim(), 5)
    if (!fallback) return null
    songId = fallback
  }

  const path = '/eapi/song/lyric/v1'
  const params = {
    id: Number(songId),
    lv: '-1',
    tv: '-1',
    rv: '-1',
    yv: '-1',
  }

  const raw = await doEapiRequest(path, params)
  if (!raw) return null

  let resp: NeLyricResponse
  try { resp = JSON.parse(raw) as NeLyricResponse } catch { return null }

  const yrc = resp.yrc?.lyric || ''
  const lrc = resp.lrc?.lyric || ''
  const tlyric = resp.tlyric?.lyric || ''
  const romalrc = resp.romalrc?.lyric || ''

  return parseYrc(yrc, lrc, tlyric, romalrc)
}
