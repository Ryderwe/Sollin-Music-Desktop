/**
 * Netease Cloud Music API Encryption (Browser-compatible)
 * Implements weapi and eapi encryption for direct API calls
 */

import CryptoJS from 'crypto-js'
import forge from 'node-forge'

// Constants
const IV = '0102030405060708'
const PRESET_KEY = '0CoJUm6Qyw8W8jud'
const EAPI_KEY = 'e82ckenh8dichen8'
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`

// Domains
const DOMAIN = 'https://music.163.com'
const API_DOMAIN = 'https://interface.music.163.com'

// AES encrypt helper
function aesEncrypt(text: string, mode: 'CBC' | 'ECB', key: string, iv: string): string {
    const encrypted = CryptoJS.AES.encrypt(
        CryptoJS.enc.Utf8.parse(text),
        CryptoJS.enc.Utf8.parse(key),
        {
            iv: iv ? CryptoJS.enc.Utf8.parse(iv) : undefined,
            mode: CryptoJS.mode[mode],
            padding: CryptoJS.pad.Pkcs7,
        },
    )
    return encrypted.toString()
}

// AES encrypt to hex
function aesEncryptHex(text: string, key: string): string {
    const encrypted = CryptoJS.AES.encrypt(
        CryptoJS.enc.Utf8.parse(text),
        CryptoJS.enc.Utf8.parse(key),
        {
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7,
        },
    )
    return encrypted.ciphertext.toString().toUpperCase()
}

// RSA encrypt (no padding, raw)
function rsaEncrypt(text: string): string {
    const publicKey = forge.pki.publicKeyFromPem(PUBLIC_KEY)
    const encrypted = publicKey.encrypt(text, 'NONE')
    return forge.util.bytesToHex(encrypted)
}

// Generate random 16-char key
function randomKey(): string {
    let key = ''
    for (let i = 0; i < 16; i++) {
        key += BASE62.charAt(Math.round(Math.random() * 61))
    }
    return key
}

// weapi encryption: double AES-CBC + RSA
export function weapiEncrypt(data: Record<string, unknown>): { params: string; encSecKey: string } {
    const text = JSON.stringify(data)
    const secretKey = randomKey()
    const params = aesEncrypt(
        aesEncrypt(text, 'CBC', PRESET_KEY, IV),
        'CBC',
        secretKey,
        IV,
    )
    const encSecKey = rsaEncrypt(secretKey.split('').reverse().join(''))
    return { params, encSecKey }
}

// eapi encryption: AES-ECB + MD5
export function eapiEncrypt(url: string, data: Record<string, unknown>): { params: string } {
    const text = JSON.stringify(data)
    const message = `nobody${url}use${text}md5forencrypt`
    const digest = CryptoJS.MD5(message).toString()
    const payload = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
    return { params: aesEncryptHex(payload, EAPI_KEY) }
}

// Cookie management
let COOKIE: Record<string, string> = {}

export function setCookie(cookie: string | Record<string, string>) {
    if (typeof cookie === 'string') {
        COOKIE = {}
        cookie.split(';').forEach((pair) => {
            const [key, ...vals] = pair.trim().split('=')
            if (key) COOKIE[key.trim()] = vals.join('=').trim()
        })
    } else {
        COOKIE = { ...cookie }
    }
}

export function getCookie(): Record<string, string> {
    return { ...COOKIE }
}

// Generate persistent anonymous token
function getAnonymousToken(): string {
    const key = 'netease_anonymous_token'
    let token = localStorage.getItem(key)
    if (!token) {
        token = CryptoJS.lib.WordArray.random(32).toString()
        localStorage.setItem(key, token)
    }
    return token
}

// Generate persistent device ID
function getDeviceId(): string {
    const key = 'netease_device_id'
    let id = localStorage.getItem(key)
    if (!id) {
        id = CryptoJS.lib.WordArray.random(32).toString()
        localStorage.setItem(key, id)
    }
    return id
}

// Generate random tracking values
function generateTracking() {
    const nuid = CryptoJS.lib.WordArray.random(32).toString()
    return {
        _ntes_nuid: nuid,
        _ntes_nnid: `${nuid},${Date.now()}`,
        WNMCID: `${Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('')}.${Date.now()}.01.0`,
    }
}

// Process cookies: add device info and tracking
function processCookies(uri: string): Record<string, string> {
    const tracking = generateTracking()
    const processed: Record<string, string> = {
        __remember_me: 'true',
        ntes_kaola_ad: '1',
        _ntes_nuid: COOKIE._ntes_nuid || tracking._ntes_nuid,
        _ntes_nnid: COOKIE._ntes_nnid || tracking._ntes_nnid,
        WNMCID: COOKIE.WNMCID || tracking.WNMCID,
        WEVNSM: '1.0.0',
        osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
        deviceId: COOKIE.deviceId || getDeviceId(),
        os: 'pc',
        channel: 'netease',
        appver: '3.1.17.204416',
    }

    if (uri.indexOf('login') === -1) {
        processed['NMTID'] = CryptoJS.lib.WordArray.random(16).toString()
    }

    // Merge stored cookies (MUSIC_U, MUSIC_A, __csrf, etc.)
    Object.keys(COOKIE).forEach((key) => {
        if (COOKIE[key]) processed[key] = COOKIE[key]
    })

    if (!processed.MUSIC_U) {
        processed.MUSIC_A = processed.MUSIC_A || getAnonymousToken()
    }

    return processed
}

// Serialize cookies to header string
function serializeCookies(cookies: Record<string, string>): string {
    return Object.entries(cookies)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('; ')
}

// Extract __csrf from cookie
function getCsrfToken(cookies: Record<string, string>): string {
    return cookies['__csrf'] || ''
}

// Generate eapi header object
function buildEapiHeader(cookies: Record<string, string>): Record<string, string> {
    const header: Record<string, string> = {
        osver: cookies.osver || 'Microsoft-Windows-10-Professional-build-19045-64bit',
        deviceId: cookies.deviceId || getDeviceId(),
        os: cookies.os || 'pc',
        appver: cookies.appver || '3.1.17.204416',
        versioncode: '140',
        mobilename: '',
        buildver: Date.now().toString().substring(0, 10),
        resolution: '1920x1080',
        __csrf: getCsrfToken(cookies),
        channel: cookies.channel || 'netease',
        requestId: `${Date.now()}_${Math.floor(Math.random() * 1000).toString().padStart(4, '0')}`,
    }
    if (cookies.MUSIC_U) header['MUSIC_U'] = cookies.MUSIC_U
    if (cookies.MUSIC_A) header['MUSIC_A'] = cookies.MUSIC_A
    return header
}

// Parse Set-Cookie header value and update COOKIE store
function updateCookiesFromSetCookie(setCookies: string[]) {
    for (const c of setCookies) {
        const parts = c.split(';')[0].split('=')
        if (parts.length >= 2) {
            COOKIE[parts[0].trim()] = parts.slice(1).join('=').trim()
        }
    }
}

// Check if Electron IPC is available
function hasElectronHttp(): boolean {
    return typeof window !== 'undefined' && !!window.electronAPI?.httpRequest
}

// Make direct request to Netease API
type CryptoType = 'weapi' | 'eapi'

export async function neteaseRequest(
    uri: string,
    data: Record<string, unknown>,
    crypto: CryptoType = 'eapi',
    extraCookie?: string,
): Promise<{ status: number; body: any; cookie: string[] } | null> {
    try {
        // Merge extra cookie if provided
        if (extraCookie) {
            const extra: Record<string, string> = {}
            extraCookie.split(';').forEach((pair) => {
                const [key, ...vals] = pair.trim().split('=')
                if (key) extra[key.trim()] = vals.join('=').trim()
            })
            Object.assign(COOKIE, extra)
        }

        const cookies = processCookies(uri)
        const headers: Record<string, string> = {}
        let url = ''
        let encryptedData: Record<string, string> = {}

        if (crypto === 'weapi') {
            headers['Referer'] = DOMAIN
            headers['User-Agent'] =
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
            data.csrf_token = getCsrfToken(cookies)
            encryptedData = weapiEncrypt(data)
            url = `${DOMAIN}/weapi/${uri.substring(5)}`
        } else {
            // eapi
            const header = buildEapiHeader(cookies)
            headers['Referer'] = DOMAIN
            headers['Cookie'] = serializeCookies({
                osver: header.osver,
                deviceId: header.deviceId,
                os: header.os,
                appver: header.appver,
                versioncode: header.versioncode,
                mobilename: header.mobilename,
                buildver: header.buildver,
                resolution: header.resolution,
                __csrf: header.__csrf,
                channel: header.channel,
                requestId: header.requestId,
                ...(header.MUSIC_U ? { MUSIC_U: header.MUSIC_U } : {}),
                ...(header.MUSIC_A ? { MUSIC_A: header.MUSIC_A } : {}),
            })
            headers['User-Agent'] =
                'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)'
            data.header = header
            encryptedData = eapiEncrypt(uri, data)
            url = `${API_DOMAIN}/eapi/${uri.substring(5)}`
        }

        if (crypto === 'weapi') {
            headers['Cookie'] = serializeCookies(cookies)
        }

        headers['Content-Type'] = 'application/x-www-form-urlencoded'
        const body = new URLSearchParams(encryptedData).toString()

        let status: number
        let responseBody: any
        let setCookies: string[] = []

        const useElectron = hasElectronHttp()
        if (useElectron) {
            // Use Electron's Node.js HTTP bridge (no CORS, full cookie access)
            const res = await window.electronAPI!.httpRequest({
                url,
                method: 'POST',
                headers,
                body,
            })
            status = res.status
            try {
                responseBody = JSON.parse(res.bodyText)
            } catch {
                responseBody = res.bodyText
            }
            setCookies = res.setCookies || []
        } else {
            // Fallback to fetch (browser dev mode)
            const res = await fetch(url, {
                method: 'POST',
                headers,
                body,
                credentials: 'include',
            })
            status = res.status
            responseBody = await res.json()
            res.headers.forEach((value, key) => {
                if (key.toLowerCase() === 'set-cookie') {
                    setCookies.push(value)
                }
            })
        }

        // Always update stored cookies from response (for session continuity)
        if (setCookies.length > 0) {
            updateCookiesFromSetCookie(setCookies)
        }

        return { status, body: responseBody, cookie: setCookies }
    } catch (error) {
        console.error('Netease request error:', error)
        return null
    }
}
