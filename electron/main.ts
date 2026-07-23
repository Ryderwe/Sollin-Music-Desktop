import { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage, dialog, globalShortcut, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import { inflate, inflateRaw, gunzip, createInflate, constants as zlibConstants } from 'zlib'
import iconv from 'iconv-lite'
import mime from 'mime-types'
import type { IAudioMetadata, ILyricsTag, IPicture } from 'music-metadata'
import {
  File as TagLibFile,
  ByteVector,
  Picture,
  PictureType,
  TagTypes,
  Id3v2Tag,
  Id3v2UnsynchronizedLyricsFrame,
  Id3v2Synchronized as Id3v2SynchronizedFrame,
  Id3v2SynchronizedLyricsFrame as Id3v2SynchronizedText,
  Id3v2SynchronizedTextType,
  Id3v2TimestampFormat,
  Id3v2FrameClassType,
  Id3v2FrameIdentifiers,
  Id3v2UserTextInformationFrame,
  XiphComment,
  Mpeg4AppleTag,
  AsfTag,
  ApeTag,
} from 'node-taglib-sharp'
import { flushPendingWrites, initializeSollinDataRoot, setupAppDataStoreIpc } from './appDataStore'
import { setupLxSourceIpcHandlers, initializeLxSourceRuntime, disposeLxSourceRuntime } from './lxSourceRuntime'
import { initializeDataSyncRuntime, disposeDataSyncRuntime, setupDataSyncIpcHandlers } from './dataSync'

// Redirect all Electron/Chromium userData under ~/.sollin before any getPath('userData').
initializeSollinDataRoot()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let forceQuit = false
const isDev = !app.isPackaged
const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

/** Playback state mirrored into tray / Windows thumbar / macOS dock menu. */
type PlayerMediaState = {
  title: string
  artist: string
  isPlaying: boolean
  empty: boolean
}

let playerMediaState: PlayerMediaState = {
  title: '',
  artist: '',
  isPlaying: false,
  empty: true,
}
let desktopLyricsWindow: BrowserWindow | null = null
let desktopLyricsEnabled = false
let menuBarLyricsEnabled = false
let desktopLyricsBounds: Electron.Rectangle | null = null
let latestLyric = ''
let desktopLyricsStateLoaded = false
let isQuitting = false
let mainWindowBounds: Electron.Rectangle | null = null
let mainWindowStateLoaded = false
let mainWindowMiniMode = false
let mainWindowPreMiniBounds: Electron.Rectangle | null = null
let mainWindowPreMiniWasMaximized = false
let mainWindowAlwaysOnTop = false
let mainWindowMiniBounds: Electron.Rectangle | null = null
let mainWindowOpacity = 1

const DEFAULT_WINDOW_WIDTH = 1400
const DEFAULT_WINDOW_HEIGHT = 900
const DEFAULT_MIN_WINDOW_WIDTH = 1000
const DEFAULT_MIN_WINDOW_HEIGHT = 700
const MINI_WINDOW_WIDTH = 360
const MINI_WINDOW_HEIGHT = 118
const ID3_LYRIC_LANGUAGE = '   '
const MP4_LYRIC_MEAN = 'com.apple.iTunes'
const EXTRA_LYRIC_FIELD_TRANSLATION = 'LYRICS_TRANSLATION'
const EXTRA_LYRIC_FIELD_ROMANIZED = 'LYRICS_ROMANIZED'
const EXTRA_LYRIC_FIELD_WORD_TIMED = 'LYRICS_WORD_TIMED'
const ID3_TRANSLATION_DESCRIPTOR = 'translation'
const ID3_ROMANIZED_DESCRIPTOR = 'romanized'
const ID3_WORD_TIMED_DESCRIPTOR = 'word-by-word'
const STANDARD_LYRIC_TIMESTAMP_REGEX = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g
const KARAOKE_LINE_REGEX = /^\[(\d+),(\d+)\]/
const KARAOKE_CHAR_REGEX = /\((\d+),(\d+),\d+\)([^()]*)/g
const LX_WORD_REGEX = /<(-?\d+),(-?\d+)>([^<]*)/g
const TTML_TAG_REGEX = /<tt[\s>]/i
const TTML_PARAGRAPH_REGEX = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi
const TTML_SPAN_REGEX = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi

type GlobalShortcutAction = 'playPause' | 'previous' | 'next'

type GlobalShortcutConfig = Record<GlobalShortcutAction, string | null>

type GlobalShortcutRegistrationStatus = {
  accelerator: string | null
  registered: boolean
  error?: string
}

type GlobalShortcutState = {
  config: GlobalShortcutConfig
  status: Record<GlobalShortcutAction, GlobalShortcutRegistrationStatus>
}

const GLOBAL_SHORTCUT_ACTIONS: GlobalShortcutAction[] = ['playPause', 'previous', 'next']

const DEFAULT_GLOBAL_SHORTCUTS: GlobalShortcutConfig = {
  playPause: 'MediaPlayPause',
  previous: 'MediaPreviousTrack',
  next: 'MediaNextTrack',
}

const GLOBAL_SHORTCUT_ACTION_LABELS: Record<GlobalShortcutAction, string> = {
  playPause: '播放 / 暂停',
  previous: '上一首',
  next: '下一首',
}

const GLOBAL_SHORTCUT_CHANNELS: Record<GlobalShortcutAction, string> = {
  playPause: 'tray:play-pause',
  previous: 'tray:previous',
  next: 'tray:next',
}

const GLOBAL_SHORTCUT_REGISTER_FAILED_MESSAGE = '快捷键注册失败，可能已被系统或其他应用占用'

let currentGlobalShortcutConfig: GlobalShortcutConfig = { ...DEFAULT_GLOBAL_SHORTCUTS }
let currentGlobalShortcutStatus: GlobalShortcutState['status'] = createGlobalShortcutStatus(DEFAULT_GLOBAL_SHORTCUTS)
const registeredGlobalShortcutAccelerators = new Set<string>()

type DesktopLyricsState = {
  bounds?: Electron.Rectangle
  enabled?: boolean
  menuBarEnabled?: boolean
  alwaysOnTop?: boolean
  locked?: boolean
}

type DesktopLyricsPayload = {
  song: {
    id: string
    name: string
    artist: string
    album?: string
    platform: string
  } | null
  lyricData: {
    lyric: string
    tlyric?: string
    rlyric?: string
    lxlyric?: string
  } | null
  lyrics: string | null
  currentTime: number
  isPlaying: boolean
}

type DesktopLyricsPayloadPatch = Partial<DesktopLyricsPayload>

let desktopLyricsAlwaysOnTop = true
let desktopLyricsLocked = false
let latestDesktopLyricsPayload: DesktopLyricsPayload = {
  song: null,
  lyricData: null,
  lyrics: null,
  currentTime: 0,
  isPlaying: false,
}

function requestAppQuit() {
  if (isQuitting) return

  forceQuit = true
  isQuitting = true

  try {
    tray?.destroy()
  } catch (error) {
    console.warn('Destroy tray failed during quit:', error)
  } finally {
    tray = null
  }

  app.quit()
}

function getDesktopLyricsStatePath() {
  return path.join(app.getPath('userData'), 'desktop-lyrics.json')
}

function loadDesktopLyricsState(): DesktopLyricsState {
  if (desktopLyricsStateLoaded) {
    return {
      bounds: desktopLyricsBounds || undefined,
      enabled: desktopLyricsEnabled,
      menuBarEnabled: menuBarLyricsEnabled,
      alwaysOnTop: desktopLyricsAlwaysOnTop,
      locked: desktopLyricsLocked,
    }
  }
  desktopLyricsStateLoaded = true
  try {
    const statePath = getDesktopLyricsStatePath()
    if (fs.existsSync(statePath)) {
      const raw = fs.readFileSync(statePath, 'utf8').trim()
      if (raw) {
        const parsed = JSON.parse(raw) as DesktopLyricsState
        if (parsed?.bounds) {
          desktopLyricsBounds = parsed.bounds
        }
        if (typeof parsed?.enabled === 'boolean') {
          desktopLyricsEnabled = parsed.enabled
        }
        if (typeof parsed?.menuBarEnabled === 'boolean') {
          menuBarLyricsEnabled = parsed.menuBarEnabled
        }
        if (typeof parsed?.alwaysOnTop === 'boolean') {
          desktopLyricsAlwaysOnTop = parsed.alwaysOnTop
        }
        if (typeof parsed?.locked === 'boolean') {
          desktopLyricsLocked = parsed.locked
        }
      }
    }
  } catch (error) {
    console.warn('Load desktop lyrics state failed:', error)
  }
  return {
    bounds: desktopLyricsBounds || undefined,
    enabled: desktopLyricsEnabled,
    menuBarEnabled: menuBarLyricsEnabled,
    alwaysOnTop: desktopLyricsAlwaysOnTop,
    locked: desktopLyricsLocked,
  }
}

let saveDesktopLyricsStateTimer: NodeJS.Timeout | null = null

function writeDesktopLyricsStateNow(sync = false) {
  const statePath = getDesktopLyricsStatePath()
  const state: DesktopLyricsState = {
    bounds: desktopLyricsBounds || undefined,
    enabled: desktopLyricsEnabled,
    menuBarEnabled: menuBarLyricsEnabled,
    alwaysOnTop: desktopLyricsAlwaysOnTop,
    locked: desktopLyricsLocked,
  }
  if (sync) {
    try {
      fs.writeFileSync(statePath, JSON.stringify(state))
    } catch (error) {
      console.warn('Save desktop lyrics state failed:', error)
    }
    return
  }
  fs.promises.writeFile(statePath, JSON.stringify(state)).catch((error) => {
    console.warn('Save desktop lyrics state failed:', error)
  })
}

// Window drag/resize emits move events per frame; coalesce disk writes.
function saveDesktopLyricsState() {
  if (saveDesktopLyricsStateTimer) return
  saveDesktopLyricsStateTimer = setTimeout(() => {
    saveDesktopLyricsStateTimer = null
    writeDesktopLyricsStateNow()
  }, 500)
}

function flushDesktopLyricsState() {
  if (saveDesktopLyricsStateTimer) {
    clearTimeout(saveDesktopLyricsStateTimer)
    saveDesktopLyricsStateTimer = null
  }
  writeDesktopLyricsStateNow(true)
}

type PersistedPlayerState = {
  playlist?: any[]
  playlistId?: string | null
  currentSong?: any | null
  volume?: number
  playMode?: string
  quality?: string
  preloadSongCount?: number
}

type DownloadFileNamePart = 'artist' | 'album' | 'title'

type DownloadFileNameRule = {
  enabled?: boolean
  parts?: DownloadFileNamePart[]
  separator?: string
}

type SongDownloadPayload = {
  taskId: string
  source: string
  sourceType: 'local' | 'remote'
  targetDirectory: string
  song: {
    title: string
    artist: string
    album: string
    songId: string
    quality?: string
  }
  lyricData?: {
    lyric: string
    tlyric?: string
    rlyric?: string
    lxlyric?: string
  } | null
  lyrics?: string | null
  coverUrl?: string | null
  fileNameRule?: DownloadFileNameRule
  saveExternalMetadataFiles?: boolean
}

type SongDownloadEventPayload = {
  taskId: string
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  progress: number
  filePath?: string
  error?: string
  warning?: string
}

type DownloadBinaryResult = {
  mimeType: string | null
}

type LocalMusicSong = {
  id: string
  name: string
  artist: string
  album: string
  duration: number
  cover?: string
  url?: string
  lrc?: string
  platform: 'local'
  localPath?: string
  localFolder?: string
  localFileSize?: number
  localModifiedAt?: string
  localTrackNo?: number
  localDiscNo?: number
}

type LocalSongEmbeddedTags = {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  composers?: string[]
  genres?: string[]
  year?: number
  trackNo?: number
  trackTotal?: number
  discNo?: number
  discTotal?: number
  comment?: string
  lyrics?: string
  tlyric?: string
  rlyric?: string
  lxlyric?: string
}

type LocalSongMetadataRequest = {
  filePath: string
  rootFolderPath?: string
  skipExternalFallback?: boolean
}

type LocalSongMetadataDetail = {
  song: LocalMusicSong
  filePath: string
  fileName: string
  directoryPath: string
  rootFolderPath?: string
  fileSize?: number
  modifiedAt?: string
  duration: number
  cover?: string
  format?: string
  codec?: string
  bitrate?: number
  sampleRate?: number
  bitsPerSample?: number
  lossless?: boolean
  tags: LocalSongEmbeddedTags
}

type LocalSongMetadataUpdatePayload = LocalSongMetadataRequest & {
  tags: LocalSongEmbeddedTags
}

type LocalMusicScanResult = {
  folders: string[]
  songs: LocalMusicSong[]
  scannedAt: string
}

const SUPPORTED_LOCAL_MUSIC_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.wav',
  '.ogg',
  '.opus',
  '.wma',
])

let localMusicTagPriority: TagPriority = 'embedded-first'

const LOCAL_MUSIC_SCAN_CONCURRENCY = 6
const SUPPORTED_DOWNLOAD_AUDIO_EXTENSIONS = new Set(SUPPORTED_LOCAL_MUSIC_EXTENSIONS)
const SUPPORTED_DOWNLOAD_COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const DOWNLOAD_FILE_NAME_PARTS: DownloadFileNamePart[] = ['artist', 'album', 'title']
const DEFAULT_DOWNLOAD_FILE_NAME_PARTS: DownloadFileNamePart[] = ['artist', 'title']
const DEFAULT_DOWNLOAD_FILE_NAME_SEPARATOR = '-'
const DEFAULT_LEGACY_DOWNLOAD_FILE_NAME_SEPARATOR = ' - '
const DOWNLOAD_BASE_NAME_MAX_LENGTH = 180
const DOWNLOAD_SEPARATOR_MAX_LENGTH = 12

type MusicMetadataModule = typeof import('music-metadata')

const importMusicMetadata = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<MusicMetadataModule>
let musicMetadataModulePromise: Promise<MusicMetadataModule> | null = null

function loadMusicMetadataModule() {
  if (!musicMetadataModulePromise) {
    musicMetadataModulePromise = importMusicMetadata('music-metadata')
  }
  return musicMetadataModulePromise
}

function getPlayerStatePath() {
  return path.join(app.getPath('userData'), 'player-state.json')
}

function loadPlayerState(): PersistedPlayerState | null {
  try {
    const statePath = getPlayerStatePath()
    if (!fs.existsSync(statePath)) return null
    const raw = fs.readFileSync(statePath, 'utf8')
    return JSON.parse(raw) as PersistedPlayerState
  } catch (error) {
    console.warn('Load player state failed:', error)
    return null
  }
}

function savePlayerState(state: PersistedPlayerState) {
  const statePath = getPlayerStatePath()
  fs.promises.writeFile(statePath, JSON.stringify(state)).catch((error) => {
    console.warn('Save player state failed:', error)
  })
}

function cloneGlobalShortcutConfig(config: GlobalShortcutConfig): GlobalShortcutConfig {
  return {
    playPause: config.playPause,
    previous: config.previous,
    next: config.next,
  }
}

function createGlobalShortcutStatus(config: GlobalShortcutConfig): GlobalShortcutState['status'] {
  return {
    playPause: { accelerator: config.playPause, registered: false },
    previous: { accelerator: config.previous, registered: false },
    next: { accelerator: config.next, registered: false },
  }
}

function cloneGlobalShortcutState(): GlobalShortcutState {
  return {
    config: cloneGlobalShortcutConfig(currentGlobalShortcutConfig),
    status: {
      playPause: { ...currentGlobalShortcutStatus.playPause },
      previous: { ...currentGlobalShortcutStatus.previous },
      next: { ...currentGlobalShortcutStatus.next },
    },
  }
}

function getGlobalShortcutStatePath() {
  return path.join(app.getPath('userData'), 'global-shortcuts.json')
}

function normalizeGlobalShortcutValue(value: unknown, fallback: string | null) {
  if (value === undefined) return fallback
  if (value === null) return null
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeGlobalShortcutConfig(value: unknown): GlobalShortcutConfig {
  const raw = value && typeof value === 'object'
    ? value as Partial<Record<GlobalShortcutAction, unknown>>
    : {}

  return {
    playPause: normalizeGlobalShortcutValue(raw.playPause, DEFAULT_GLOBAL_SHORTCUTS.playPause),
    previous: normalizeGlobalShortcutValue(raw.previous, DEFAULT_GLOBAL_SHORTCUTS.previous),
    next: normalizeGlobalShortcutValue(raw.next, DEFAULT_GLOBAL_SHORTCUTS.next),
  }
}

function loadGlobalShortcutConfig(): GlobalShortcutConfig {
  try {
    const statePath = getGlobalShortcutStatePath()
    if (!fs.existsSync(statePath)) {
      return cloneGlobalShortcutConfig(DEFAULT_GLOBAL_SHORTCUTS)
    }

    const raw = fs.readFileSync(statePath, 'utf8').trim()
    if (!raw) {
      return cloneGlobalShortcutConfig(DEFAULT_GLOBAL_SHORTCUTS)
    }

    return normalizeGlobalShortcutConfig(JSON.parse(raw))
  } catch (error) {
    console.warn('Load global shortcut config failed:', error)
    return cloneGlobalShortcutConfig(DEFAULT_GLOBAL_SHORTCUTS)
  }
}

function saveGlobalShortcutConfig(config: GlobalShortcutConfig) {
  const statePath = getGlobalShortcutStatePath()
  fs.promises.writeFile(statePath, JSON.stringify(config)).catch((error) => {
    console.warn('Save global shortcut config failed:', error)
  })
}

function unregisterGlobalShortcuts() {
  registeredGlobalShortcutAccelerators.forEach((accelerator) => {
    try {
      globalShortcut.unregister(accelerator)
    } catch (error) {
      console.warn(`Unregister global shortcut failed (${accelerator}):`, error)
    }
  })
  registeredGlobalShortcutAccelerators.clear()
}

function emitPlayerShortcut(action: GlobalShortcutAction) {
  const targetWindow = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows().find((item) => !item.isDestroyed()) || null

  if (!targetWindow || targetWindow.isDestroyed()) return
  targetWindow.webContents.send(GLOBAL_SHORTCUT_CHANNELS[action])
}

function registerGlobalShortcuts(config: GlobalShortcutConfig): GlobalShortcutState {
  unregisterGlobalShortcuts()

  const status = createGlobalShortcutStatus(config)
  const acceleratorOwners = new Map<string, GlobalShortcutAction>()

  for (const action of GLOBAL_SHORTCUT_ACTIONS) {
    const accelerator = config[action]
    if (!accelerator) continue

    const normalizedAccelerator = accelerator.toLowerCase()
    const conflictAction = acceleratorOwners.get(normalizedAccelerator)
    if (conflictAction) {
      status[action] = {
        accelerator,
        registered: false,
        error: `与「${GLOBAL_SHORTCUT_ACTION_LABELS[conflictAction]}」重复，请重新设置`,
      }
      continue
    }

    acceleratorOwners.set(normalizedAccelerator, action)

    try {
      const registered = globalShortcut.register(accelerator, () => emitPlayerShortcut(action))
      if (registered && globalShortcut.isRegistered(accelerator)) {
        registeredGlobalShortcutAccelerators.add(accelerator)
        status[action] = {
          accelerator,
          registered: true,
        }
      } else {
        status[action] = {
          accelerator,
          registered: false,
          error: GLOBAL_SHORTCUT_REGISTER_FAILED_MESSAGE,
        }
      }
    } catch (error) {
      status[action] = {
        accelerator,
        registered: false,
        error: error instanceof Error ? error.message : GLOBAL_SHORTCUT_REGISTER_FAILED_MESSAGE,
      }
    }
  }

  currentGlobalShortcutConfig = cloneGlobalShortcutConfig(config)
  currentGlobalShortcutStatus = status
  return cloneGlobalShortcutState()
}

function applyGlobalShortcutConfig(value: unknown) {
  const nextConfig = normalizeGlobalShortcutConfig(value)
  saveGlobalShortcutConfig(nextConfig)
  return registerGlobalShortcuts(nextConfig)
}

function getDefaultDownloadDirectory() {
  return path.join(app.getPath('home'), 'Downloads', 'sollin')
}

async function ensureDirectoryExists(directoryPath: string) {
  try {
    await fs.promises.access(directoryPath)
  } catch {
    await fs.promises.mkdir(directoryPath, { recursive: true })
  }
}

function sanitizeFileNamePart(value: string, fallback: string) {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

  return sanitized || fallback
}

function normalizeDownloadFileNameParts(parts: unknown): DownloadFileNamePart[] {
  if (!Array.isArray(parts)) return [...DEFAULT_DOWNLOAD_FILE_NAME_PARTS]

  const normalized: DownloadFileNamePart[] = []
  for (const part of parts) {
    if (!DOWNLOAD_FILE_NAME_PARTS.includes(part) || normalized.includes(part)) continue
    normalized.push(part)
  }

  return normalized.length ? normalized : [...DEFAULT_DOWNLOAD_FILE_NAME_PARTS]
}

function normalizeDownloadFileNameSeparator(separator: unknown) {
  if (typeof separator !== 'string') return DEFAULT_DOWNLOAD_FILE_NAME_SEPARATOR

  const normalized = separator
    .replace(/[<>:"/\\?*\u0000-\u001F]/g, '')
    .replace(/\|/g, '｜')
    .slice(0, DOWNLOAD_SEPARATOR_MAX_LENGTH)

  return normalized || DEFAULT_DOWNLOAD_FILE_NAME_SEPARATOR
}

function getDownloadFileNamePartValue(payload: SongDownloadPayload['song'], part: DownloadFileNamePart) {
  switch (part) {
    case 'artist':
      return sanitizeFileNamePart(payload.artist || '', '未知歌手')
    case 'album':
      return sanitizeFileNamePart(payload.album || '', '未知专辑')
    case 'title':
      return sanitizeFileNamePart(payload.title || '', '未命名歌曲')
    default:
      return ''
  }
}

function normalizeDownloadBaseName(value: string) {
  const normalized = value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DOWNLOAD_BASE_NAME_MAX_LENGTH)

  return normalized || '未命名歌曲'
}

function buildDownloadBaseName(payload: SongDownloadPayload['song']) {
  const artist = sanitizeFileNamePart(payload.artist || '', '未知歌手')
  const title = sanitizeFileNamePart(payload.title || '', '未命名歌曲')
  return normalizeDownloadBaseName(`${artist}${DEFAULT_LEGACY_DOWNLOAD_FILE_NAME_SEPARATOR}${title}`)
}

function buildSongDownloadBaseName(payload: SongDownloadPayload) {
  if (!payload.fileNameRule?.enabled) return buildDownloadBaseName(payload.song)

  const parts = normalizeDownloadFileNameParts(payload.fileNameRule.parts)
  const separator = normalizeDownloadFileNameSeparator(payload.fileNameRule.separator)
  const baseName = parts
    .map((part) => getDownloadFileNamePartValue(payload.song, part))
    .join(separator)

  return normalizeDownloadBaseName(baseName)
}

function mimeTypeToExtension(mimeType?: string | null) {
  const normalized = (mimeType || '').split(';')[0].trim().toLowerCase()
  if (!normalized) return ''

  switch (normalized) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return '.mp3'
    case 'audio/flac':
    case 'audio/x-flac':
      return '.flac'
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
      return '.m4a'
    case 'audio/aac':
    case 'audio/aacp':
      return '.aac'
    case 'audio/wav':
    case 'audio/x-wav':
      return '.wav'
    case 'audio/ogg':
    case 'application/ogg':
      return '.ogg'
    case 'audio/opus':
      return '.opus'
    default: {
      const extension = mime.extension(normalized)
      return extension ? `.${extension}` : ''
    }
  }
}

function normalizeAudioExtension(extension?: string | null) {
  const normalized = (extension || '').trim().toLowerCase()
  if (!normalized) return ''
  const withDot = normalized.startsWith('.') ? normalized : `.${normalized}`
  return SUPPORTED_DOWNLOAD_AUDIO_EXTENSIONS.has(withDot) ? withDot : ''
}

async function detectAudioExtensionFromFile(filePath: string) {
  let handle: fs.promises.FileHandle | null = null

  try {
    handle = await fs.promises.open(filePath, 'r')
    const buffer = Buffer.alloc(64)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead <= 0) return ''

    const header = buffer.subarray(0, bytesRead)
    const textHeader = header.toString('latin1')

    if (header.length >= 3 && textHeader.startsWith('ID3')) return '.mp3'
    if (header.length >= 4 && textHeader.startsWith('fLaC')) return '.flac'
    if (header.length >= 4 && textHeader.startsWith('OggS')) return '.ogg'
    if (header.length >= 12 && textHeader.startsWith('RIFF') && textHeader.slice(8, 12) === 'WAVE') return '.wav'
    if (header.length >= 12 && textHeader.slice(4, 8) === 'ftyp') {
      const brand = textHeader.slice(8, 12)
      if (['M4A ', 'M4B ', 'isom', 'iso2', 'mp41', 'mp42', 'qt  '].includes(brand)) {
        return '.m4a'
      }
    }
    if (header.length >= 2 && header[0] === 0xff && (header[1] & 0xf6) === 0xf0) return '.aac'
    if (header.length >= 4 && textHeader.startsWith('ADIF')) return '.aac'
    if (
      header.length >= 16
      && header[0] === 0x30
      && header[1] === 0x26
      && header[2] === 0xb2
      && header[3] === 0x75
      && header[4] === 0x8e
      && header[5] === 0x66
      && header[6] === 0xcf
      && header[7] === 0x11
    ) {
      return '.wma'
    }
    if (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0) return '.mp3'
  } finally {
    await handle?.close().catch(() => {})
  }

  return ''
}

function getExtensionFromUrl(value: string) {
  try {
    const parsed = new URL(value)
    const extension = path.extname(parsed.pathname).toLowerCase()
    if (extension && extension.length <= 10) return extension
  } catch {
    const extension = path.extname(value.split('?')[0]).toLowerCase()
    if (extension && extension.length <= 10) return extension
  }

  return ''
}

async function resolveAudioExtension(source: string, mimeType: string | null, filePath: string) {
  const sourceExtension = normalizeAudioExtension(getExtensionFromUrl(source))
  if (sourceExtension) return sourceExtension

  const detectedExtension = normalizeAudioExtension(await detectAudioExtensionFromFile(filePath))
  if (detectedExtension) return detectedExtension

  const mimeExtension = normalizeAudioExtension(mimeTypeToExtension(mimeType))
  if (mimeExtension) return mimeExtension

  return '.mp3'
}

function normalizeSourcePath(source: string) {
  if (/^file:/i.test(source)) {
    return fileURLToPath(source)
  }

  return source
}

function getLocalPathFromSource(source: string) {
  if (/^(https?|data):/i.test(source)) return null
  return normalizeSourcePath(source)
}

async function getUniqueFilePath(directoryPath: string, baseName: string, extension: string) {
  let attempt = 0

  while (attempt < 1000) {
    const suffix = attempt === 0 ? '' : ` (${attempt})`
    const candidate = path.join(directoryPath, `${baseName}${suffix}${extension}`)
    try {
      await fs.promises.access(candidate)
      attempt += 1
    } catch {
      return candidate
    }
  }

  throw new Error('生成下载文件名失败，请稍后重试')
}

function normalizeEmbeddedLyricContent(content: string | null | undefined) {
  if (typeof content !== 'string') return undefined

  const normalized = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

  return normalized || undefined
}

function normalizeXmlText(value: string, preserveSpacing = false) {
  const decoded = decodeXmlEntities(value.replace(/<[^>]+>/g, ''))
    .replace(/[\r\n\t]/g, preserveSpacing ? '' : ' ')

  return preserveSpacing ? decoded : decoded.replace(/\s+/g, ' ').trim()
}

function formatPreciseLrcTimestamp(timestampMs: number) {
  const safeTimestamp = Math.max(0, Math.round(Number(timestampMs) || 0))
  const minutes = Math.floor(safeTimestamp / 60000)
  const seconds = Math.floor((safeTimestamp % 60000) / 1000)
  const milliseconds = safeTimestamp % 1000
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}]`
}

function renderInlineTimestampLine(segments: Array<{ start: number; end?: number; text: string }>) {
  const meaningfulSegments = segments.filter((segment) => segment.text.length > 0)
  if (!meaningfulSegments.length) return ''

  let line = ''
  for (const segment of meaningfulSegments) {
    line += `${formatPreciseLrcTimestamp(segment.start)}${segment.text}`
  }

  const lastSegment = meaningfulSegments[meaningfulSegments.length - 1]
  if (typeof lastSegment.end === 'number' && Number.isFinite(lastSegment.end) && lastSegment.end >= lastSegment.start) {
    line += formatPreciseLrcTimestamp(lastSegment.end)
  }

  return line
}

function normalizeWordTimedSegments(
  segments: Array<{ start: number; end?: number; text: string }>,
  baseTime: number,
) {
  if (segments.length < 2) return segments

  let normalized = segments.map((segment) => ({ ...segment }))

  while (true) {
    const lastEnd = normalized.reduce((max, segment) => {
      const end = typeof segment.end === 'number' && Number.isFinite(segment.end) ? segment.end : segment.start
      return Math.max(max, end)
    }, baseTime)
    const span = Math.max(lastEnd - baseTime, 0)
    const averageSpanPerSegment = span / normalized.length

    if (averageSpanPerSegment <= 2500 || span <= 15000) break

    normalized = normalized.map((segment) => ({
      ...segment,
      start: Math.round(baseTime + (segment.start - baseTime) / 10),
      end: typeof segment.end === 'number' && Number.isFinite(segment.end)
        ? Math.round(baseTime + (segment.end - baseTime) / 10)
        : segment.end,
    }))
  }

  return normalized
}

function convertWordTimedLrcToInline(content: string | undefined) {
  if (!content) return undefined

  if (TTML_TAG_REGEX.test(content)) {
    const lines: string[] = []
    const paragraphRegex = new RegExp(TTML_PARAGRAPH_REGEX)
    let paragraphMatch: RegExpExecArray | null

    while ((paragraphMatch = paragraphRegex.exec(content)) !== null) {
      const paragraphAttributes = paragraphMatch[1] || ''
      const paragraphBody = paragraphMatch[2] || ''
      const paragraphBegin = parseTtmlTimeToMs(extractXmlAttribute(paragraphAttributes, 'begin'))
      const paragraphEnd = parseTtmlTimeToMs(extractXmlAttribute(paragraphAttributes, 'end'))
      const segments: Array<{ start: number; end?: number; text: string }> = []
      let hasSpan = false

      const spanRegex = new RegExp(TTML_SPAN_REGEX)
      let spanMatch: RegExpExecArray | null
      while ((spanMatch = spanRegex.exec(paragraphBody)) !== null) {
        hasSpan = true
        const spanAttributes = spanMatch[1] || ''
        const text = normalizeXmlText(spanMatch[2] || '', true)
        const start = parseTtmlTimeToMs(extractXmlAttribute(spanAttributes, 'begin')) ?? paragraphBegin
        const end = parseTtmlTimeToMs(extractXmlAttribute(spanAttributes, 'end')) ?? paragraphEnd ?? start ?? undefined
        if (start == null || !text) continue
        segments.push({ start, end, text })
      }

      if (!hasSpan && paragraphBegin != null) {
        const text = normalizeXmlText(paragraphBody, true)
        if (text) {
          segments.push({ start: paragraphBegin, end: paragraphEnd ?? paragraphBegin, text })
        }
      }

      const line = renderInlineTimestampLine(segments)
      if (line) lines.push(line)
    }

    return lines.length ? lines.join('\n') : undefined
  }

  const lines: string[] = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const karaokeMatch = line.match(KARAOKE_LINE_REGEX)
    if (karaokeMatch) {
      const startMs = Number.parseInt(karaokeMatch[1], 10)
      const body = line.slice(karaokeMatch[0].length)
      let segments: Array<{ start: number; end?: number; text: string }> = []
      const charRegex = new RegExp(KARAOKE_CHAR_REGEX)
      let charMatch: RegExpExecArray | null
      while ((charMatch = charRegex.exec(body)) !== null) {
        const offset = Number(charMatch[1] || 0)
        const duration = Number(charMatch[2] || 0)
        const text = charMatch[3] || ''
        if (!text) continue
        const start = Math.max(startMs + offset, startMs)
        segments.push({ start, end: Math.max(start + duration, start), text })
      }
      segments = normalizeWordTimedSegments(segments, startMs)
      const inlineLine = renderInlineTimestampLine(segments)
      if (inlineLine) lines.push(inlineLine)
      continue
    }

    const matches = Array.from(line.matchAll(STANDARD_LYRIC_TIMESTAMP_REGEX))
    if (!matches.length) continue

    const contentWithoutTimestamp = line.replace(STANDARD_LYRIC_TIMESTAMP_REGEX, '')
    if (!contentWithoutTimestamp.includes('<')) continue

    for (const match of matches) {
      const baseTime = parseStandardTimestampToMs(match as RegExpExecArray)
      let segments: Array<{ start: number; end?: number; text: string }> = []
      const wordRegex = new RegExp(LX_WORD_REGEX)
      let wordMatch: RegExpExecArray | null
      while ((wordMatch = wordRegex.exec(contentWithoutTimestamp)) !== null) {
        const offset = Number(wordMatch[1] || 0)
        const duration = Number(wordMatch[2] || 0)
        const text = wordMatch[3] || ''
        if (!text) continue
        const start = Math.max(baseTime + offset, baseTime)
        segments.push({ start, end: Math.max(start + duration, start), text })
      }
      segments = normalizeWordTimedSegments(segments, baseTime)
      const inlineLine = renderInlineTimestampLine(segments)
      if (inlineLine) lines.push(inlineLine)
    }
  }

  return lines.length ? lines.join('\n') : undefined
}

type EmbeddedLyricLineRecord = {
  time: number
  priority: number
  sequence: number
  line: string
}

function toEmbeddedLyricLineRecord(time: number, priority: number, sequence: number, text: string) {
  return {
    time,
    priority,
    sequence,
    line: `${formatPreciseLrcTimestamp(time)}${text}`,
  }
}

function parseEmbeddedLyricLineTimestamps(line: string) {
  return Array.from(line.matchAll(STANDARD_LYRIC_TIMESTAMP_REGEX))
}

function parsePrimaryEmbeddedLyricRecords(content: string | undefined) {
  if (!content) return []

  const records: EmbeddedLyricLineRecord[] = []
  let sequence = 0

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const [firstTimestamp] = parseEmbeddedLyricLineTimestamps(line)
    if (!firstTimestamp) {
      records.push({
        time: -1,
        priority: -1,
        sequence: sequence++,
        line,
      })
      continue
    }

    records.push({
      time: parseStandardTimestampToMs(firstTimestamp as RegExpExecArray),
      priority: 0,
      sequence: sequence++,
      line,
    })
  }

  return records
}

function parseTtmlEmbeddedLyricLineRecords(content: string, priority: number) {
  const records: EmbeddedLyricLineRecord[] = []
  const paragraphRegex = new RegExp(TTML_PARAGRAPH_REGEX)
  let paragraphMatch: RegExpExecArray | null
  let sequence = 0

  while ((paragraphMatch = paragraphRegex.exec(content)) !== null) {
    const paragraphAttributes = paragraphMatch[1] || ''
    const paragraphBody = paragraphMatch[2] || ''
    const paragraphBegin = parseTtmlTimeToMs(extractXmlAttribute(paragraphAttributes, 'begin'))
    const paragraphText = stripXmlTags(paragraphBody)
    if (paragraphBegin == null || !paragraphText) continue

    records.push(toEmbeddedLyricLineRecord(paragraphBegin, priority, sequence++, paragraphText))
  }

  return records
}

function parseCompanionEmbeddedLyricRecords(content: string | undefined, priority: number) {
  if (!content) return []

  if (TTML_TAG_REGEX.test(content)) {
    return parseTtmlEmbeddedLyricLineRecords(content, priority)
  }

  const records: EmbeddedLyricLineRecord[] = []
  let sequence = 0

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const timestamps = parseEmbeddedLyricLineTimestamps(line)
    if (!timestamps.length) continue

    const text = line.replace(STANDARD_LYRIC_TIMESTAMP_REGEX, '').trim()
    if (!text) continue

    const leadingTimestampBlock = line.match(/^(?:\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\])+\s*/)
    const leadingTimestampLength = leadingTimestampBlock?.[0].replace(/\s/g, '').length ?? 0
    const totalTimestampLength = timestamps.reduce((length, match) => length + match[0].length, 0)
    const timestampsToUse = leadingTimestampLength >= totalTimestampLength ? timestamps : timestamps.slice(0, 1)

    for (const timestamp of timestampsToUse) {
      records.push(toEmbeddedLyricLineRecord(
        parseStandardTimestampToMs(timestamp as RegExpExecArray),
        priority,
        sequence++,
        text,
      ))
    }
  }

  return records
}

function buildCompositeEmbeddedLyric(primary: string | undefined, rlyric: string | undefined, tlyric: string | undefined) {
  const primaryRecords = parsePrimaryEmbeddedLyricRecords(primary)
  const companionRecords = [
    ...parseCompanionEmbeddedLyricRecords(rlyric, 1),
    ...parseCompanionEmbeddedLyricRecords(tlyric, 2),
  ]

  if (!primaryRecords.length && !companionRecords.length) return undefined
  if (!companionRecords.length) return primary

  const seenLines = new Set<string>()
  const mergedLines = [...primaryRecords, ...companionRecords]
    .sort((left, right) => (
      left.time - right.time
      || left.priority - right.priority
      || left.sequence - right.sequence
    ))
    .map((record) => record.line)
    .filter((line) => {
      if (seenLines.has(line)) return false
      seenLines.add(line)
      return true
    })

  return mergedLines.length ? mergedLines.join('\n') : primary
}

function collectEmbeddedLyricTracks(payload: SongDownloadPayload) {
  const lxlyric = normalizeEmbeddedLyricContent(payload.lyricData?.lxlyric)
  const inlineWordLyric = normalizeEmbeddedLyricContent(convertWordTimedLrcToInline(lxlyric))
  const rawBaseLyric = normalizeEmbeddedLyricContent(payload.lyricData?.lyric || payload.lyrics)
  const convertedBaseLyric = normalizeEmbeddedLyricContent(convertWordTimedLrcToInline(rawBaseLyric))
  const baseLyric = normalizeEmbeddedLyricContent(inlineWordLyric || convertedBaseLyric || rawBaseLyric)
  const tlyric = normalizeEmbeddedLyricContent(payload.lyricData?.tlyric)
  const rlyric = normalizeEmbeddedLyricContent(payload.lyricData?.rlyric)
  const lyric = normalizeEmbeddedLyricContent(buildCompositeEmbeddedLyric(baseLyric, rlyric, tlyric) || baseLyric)

  return {
    lyric,
    tlyric,
    rlyric,
    lxlyric,
  }
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&nbsp;/g, ' ')
}

function extractXmlAttribute(attributes: string, name: string) {
  const match = new RegExp(`${name}\\s*=\\s*(['"])(.*?)\\1`, 'i').exec(attributes)
  return match?.[2] || null
}

function stripXmlTags(value: string) {
  return normalizeXmlText(value)
}

function parseTtmlTimeToMs(value: string | null) {
  if (!value) return null

  const normalized = value.trim()
  if (!normalized) return null

  if (/^\d+(?:\.\d+)?ms$/i.test(normalized)) {
    return Math.round(Number.parseFloat(normalized) * 1)
  }

  if (/^\d+(?:\.\d+)?s$/i.test(normalized)) {
    return Math.round(Number.parseFloat(normalized) * 1000)
  }

  if (/^\d+(?:\.\d+)?m$/i.test(normalized)) {
    return Math.round(Number.parseFloat(normalized) * 60_000)
  }

  if (/^\d+(?:\.\d+)?h$/i.test(normalized)) {
    return Math.round(Number.parseFloat(normalized) * 3_600_000)
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return Math.round(Number.parseFloat(normalized) * 1000)
  }

  if (!normalized.includes(':')) return null

  const parts = normalized.split(':').map((item) => Number.parseFloat(item))
  if (!parts.length || parts.some((item) => Number.isNaN(item))) return null

  const seconds = parts.reduce((accumulator, current) => accumulator * 60 + current, 0)
  return Math.round(seconds * 1000)
}

function parseStandardTimestampToMs(match: RegExpExecArray) {
  const mins = Number.parseInt(match[1], 10)
  const secs = Number.parseInt(match[2], 10)
  const ms = match[3] ? Number.parseInt(match[3].padEnd(3, '0'), 10) : 0
  return mins * 60_000 + secs * 1000 + ms
}

function parseTtmlSynchronizedText(content: string) {
  if (!TTML_TAG_REGEX.test(content)) return []

  const entries: Array<{ time: number; text: string }> = []
  const paragraphRegex = new RegExp(TTML_PARAGRAPH_REGEX)
  let paragraphMatch: RegExpExecArray | null

  while ((paragraphMatch = paragraphRegex.exec(content)) !== null) {
    const paragraphAttributes = paragraphMatch[1] || ''
    const paragraphBody = paragraphMatch[2] || ''
    const paragraphBegin = parseTtmlTimeToMs(extractXmlAttribute(paragraphAttributes, 'begin'))
    const paragraphText = stripXmlTags(paragraphBody)
    let paragraphHasSpans = false

    let spanMatch: RegExpExecArray | null
    const spanRegex = new RegExp(TTML_SPAN_REGEX)
    while ((spanMatch = spanRegex.exec(paragraphBody)) !== null) {
      paragraphHasSpans = true
      const spanAttributes = spanMatch[1] || ''
      const spanText = stripXmlTags(spanMatch[2] || '')
      const spanBegin = parseTtmlTimeToMs(extractXmlAttribute(spanAttributes, 'begin')) ?? paragraphBegin
      if (spanBegin == null || !spanText) continue
      entries.push({ time: spanBegin, text: spanText })
    }

    if (!paragraphHasSpans && paragraphBegin != null && paragraphText) {
      entries.push({ time: paragraphBegin, text: paragraphText })
    }
  }

  return entries
    .filter((entry) => entry.text)
    .sort((left, right) => left.time - right.time)
}

function parseLrcSynchronizedText(content: string) {
  const entries: Array<{ time: number; text: string }> = []
  const lines = content.split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const karaokeMatch = line.match(KARAOKE_LINE_REGEX)
    if (karaokeMatch) {
      const startMs = Number.parseInt(karaokeMatch[1], 10)
      const body = line.slice(karaokeMatch[0].length)
      let charMatch: RegExpExecArray | null
      const charRegex = new RegExp(KARAOKE_CHAR_REGEX)
      while ((charMatch = charRegex.exec(body)) !== null) {
        const offset = Number(charMatch[1] || 0)
        const text = (charMatch[3] || '').trim()
        if (!text) continue
        entries.push({
          time: Math.max(startMs + offset, startMs),
          text,
        })
      }
      continue
    }

    const timedSegments = Array.from(line.matchAll(STANDARD_LYRIC_TIMESTAMP_REGEX))
    if (timedSegments.length > 1) {
      const segments = timedSegments.map((match, index) => {
        const startIndex = (match.index || 0) + match[0].length
        const endIndex = index + 1 < timedSegments.length
          ? (timedSegments[index + 1].index || line.length)
          : line.length

        return {
          time: parseStandardTimestampToMs(match as RegExpExecArray),
          text: line.slice(startIndex, endIndex).trim(),
        }
      }).filter((segment) => segment.text)

      if (segments.length > 1) {
        entries.push(...segments)
        continue
      }
    }

    const matches = Array.from(line.matchAll(STANDARD_LYRIC_TIMESTAMP_REGEX))
    if (!matches.length) continue

    const contentWithoutTimestamp = line.replace(STANDARD_LYRIC_TIMESTAMP_REGEX, '').trim()
    if (!contentWithoutTimestamp.includes('<')) continue

    for (const match of matches) {
      const baseTime = parseStandardTimestampToMs(match as RegExpExecArray)
      let wordMatch: RegExpExecArray | null
      const wordRegex = new RegExp(LX_WORD_REGEX)
      while ((wordMatch = wordRegex.exec(contentWithoutTimestamp)) !== null) {
        const offset = Number(wordMatch[1] || 0)
        const text = (wordMatch[3] || '').trim()
        if (!text) continue
        entries.push({
          time: Math.max(baseTime + offset, baseTime),
          text,
        })
      }
    }
  }

  return entries
    .filter((entry) => entry.text)
    .sort((left, right) => left.time - right.time)
}

function buildSynchronizedLyricEntries(content: string | undefined) {
  if (!content) return []
  if (TTML_TAG_REGEX.test(content)) {
    return parseTtmlSynchronizedText(content)
  }
  return parseLrcSynchronizedText(content)
}

function removeId3UserTextFrame(tag: Id3v2Tag, description: string) {
  const frames = tag.getFramesByClassType<Id3v2UserTextInformationFrame>(Id3v2FrameClassType.UserTextInformationFrame)
  for (const frame of frames) {
    if (frame.description === description) {
      tag.removeFrame(frame)
    }
  }
}

function setId3UserTextFrame(tag: Id3v2Tag, description: string, value: string | undefined) {
  removeId3UserTextFrame(tag, description)
  if (!value) return

  const frame = Id3v2UserTextInformationFrame.fromDescription(description)
  frame.text = [value]
  tag.addFrame(frame)
}

function setId3UnsynchronizedLyrics(tag: Id3v2Tag, description: string, text: string | undefined) {
  const frames = tag.getFramesByClassType<Id3v2UnsynchronizedLyricsFrame>(Id3v2FrameClassType.UnsynchronizedLyricsFrame)
  for (const frame of frames) {
    if (frame.description === description) {
      tag.removeFrame(frame)
    }
  }

  if (!text) return

  const frame = Id3v2UnsynchronizedLyricsFrame.fromData(description, ID3_LYRIC_LANGUAGE)
  frame.text = text
  tag.addFrame(frame)
}

function embedLyricsToId3Tag(tagFile: ReturnType<typeof TagLibFile.createFromPath>, tracks: ReturnType<typeof collectEmbeddedLyricTracks>) {
  const id3Tag = tagFile.getTag(TagTypes.Id3v2, true) as Id3v2Tag | undefined
  if (!id3Tag) return false

  setId3UnsynchronizedLyrics(id3Tag, '', tracks.lyric)
  setId3UnsynchronizedLyrics(id3Tag, ID3_TRANSLATION_DESCRIPTOR, tracks.tlyric)
  setId3UnsynchronizedLyrics(id3Tag, ID3_ROMANIZED_DESCRIPTOR, tracks.rlyric)

  id3Tag.removeFrames(Id3v2FrameIdentifiers.SYLT)
  const synchronizedEntries = buildSynchronizedLyricEntries(tracks.lxlyric)
  if (synchronizedEntries.length) {
    const frame = Id3v2SynchronizedFrame.fromInfo(
      ID3_WORD_TIMED_DESCRIPTOR,
      ID3_LYRIC_LANGUAGE,
      Id3v2SynchronizedTextType.Lyrics,
    )
    frame.format = Id3v2TimestampFormat.AbsoluteMilliseconds
    frame.text = synchronizedEntries.map((entry) => new Id3v2SynchronizedText(entry.time, entry.text))
    id3Tag.addFrame(frame)
  }

  setId3UserTextFrame(id3Tag, EXTRA_LYRIC_FIELD_WORD_TIMED, tracks.lxlyric)
  return true
}

function setXiphField(tag: XiphComment, key: string, value: string | undefined) {
  if (value) {
    tag.setFieldAsStrings(key, value)
    return
  }

  tag.removeField(key)
}

function embedLyricsToXiphTag(tagFile: ReturnType<typeof TagLibFile.createFromPath>, tracks: ReturnType<typeof collectEmbeddedLyricTracks>) {
  const xiphTag = tagFile.getTag(TagTypes.Xiph, true) as XiphComment | undefined
  if (!xiphTag) return false

  xiphTag.lyrics = tracks.lyric || ''
  setXiphField(xiphTag, EXTRA_LYRIC_FIELD_TRANSLATION, tracks.tlyric)
  setXiphField(xiphTag, EXTRA_LYRIC_FIELD_ROMANIZED, tracks.rlyric)
  setXiphField(xiphTag, EXTRA_LYRIC_FIELD_WORD_TIMED, tracks.lxlyric)
  return true
}

function setAppleFreeformText(tag: Mpeg4AppleTag, name: string, value: string | undefined) {
  if (value) {
    tag.setItunesStrings(MP4_LYRIC_MEAN, name, value)
    return
  }

  tag.setItunesStrings(MP4_LYRIC_MEAN, name)
}

function embedLyricsToAppleTag(tagFile: ReturnType<typeof TagLibFile.createFromPath>, tracks: ReturnType<typeof collectEmbeddedLyricTracks>) {
  const appleTag = tagFile.getTag(TagTypes.Apple, true) as Mpeg4AppleTag | undefined
  if (!appleTag) return false

  appleTag.lyrics = tracks.lyric || ''
  setAppleFreeformText(appleTag, EXTRA_LYRIC_FIELD_TRANSLATION, tracks.tlyric)
  setAppleFreeformText(appleTag, EXTRA_LYRIC_FIELD_ROMANIZED, tracks.rlyric)
  setAppleFreeformText(appleTag, EXTRA_LYRIC_FIELD_WORD_TIMED, tracks.lxlyric)
  return true
}

function setAsfDescriptor(tag: AsfTag, name: string, value: string | undefined) {
  tag.setDescriptorString(value || '', name)
}

function embedLyricsToAsfTag(tagFile: ReturnType<typeof TagLibFile.createFromPath>, tracks: ReturnType<typeof collectEmbeddedLyricTracks>) {
  const asfTag = tagFile.getTag(TagTypes.Asf, true) as AsfTag | undefined
  if (!asfTag) return false

  asfTag.lyrics = tracks.lyric || ''
  setAsfDescriptor(asfTag, EXTRA_LYRIC_FIELD_TRANSLATION, tracks.tlyric)
  setAsfDescriptor(asfTag, EXTRA_LYRIC_FIELD_ROMANIZED, tracks.rlyric)
  setAsfDescriptor(asfTag, EXTRA_LYRIC_FIELD_WORD_TIMED, tracks.lxlyric)
  return true
}

function setApeStringValue(tag: ApeTag, key: string, value: string | undefined) {
  tag.setStringValue(key, value || '')
}

function embedLyricsToApeTag(tagFile: ReturnType<typeof TagLibFile.createFromPath>, tracks: ReturnType<typeof collectEmbeddedLyricTracks>) {
  const apeTag = tagFile.getTag(TagTypes.Ape, true) as ApeTag | undefined
  if (!apeTag) return false

  apeTag.lyrics = tracks.lyric || ''
  setApeStringValue(apeTag, EXTRA_LYRIC_FIELD_TRANSLATION, tracks.tlyric)
  setApeStringValue(apeTag, EXTRA_LYRIC_FIELD_ROMANIZED, tracks.rlyric)
  setApeStringValue(apeTag, EXTRA_LYRIC_FIELD_WORD_TIMED, tracks.lxlyric)
  return true
}

function embedLyricsIntoTagFile(
  tagFile: ReturnType<typeof TagLibFile.createFromPath>,
  filePath: string,
  payload: SongDownloadPayload,
) {
  const tracks = collectEmbeddedLyricTracks(payload)
  const hasAnyLyrics = Boolean(tracks.lyric || tracks.tlyric || tracks.rlyric || tracks.lxlyric)
  if (!hasAnyLyrics) return undefined

  const extension = path.extname(filePath).toLowerCase()

  const embeddingStrategies = [
    () => (new Set(['.mp3', '.wav', '.wave', '.aif', '.aiff']).has(extension) ? embedLyricsToId3Tag(tagFile, tracks) : false),
    () => (new Set(['.flac', '.ogg', '.oga', '.opus', '.spx']).has(extension) ? embedLyricsToXiphTag(tagFile, tracks) : false),
    () => (new Set(['.m4a', '.m4b', '.m4p', '.mp4', '.aac', '.alac']).has(extension) ? embedLyricsToAppleTag(tagFile, tracks) : false),
    () => (new Set(['.wma', '.wmv', '.asf']).has(extension) ? embedLyricsToAsfTag(tagFile, tracks) : false),
    () => (new Set(['.ape', '.wv', '.mpc']).has(extension) ? embedLyricsToApeTag(tagFile, tracks) : false),
    () => (tagFile.getTag(TagTypes.Id3v2, false) ? embedLyricsToId3Tag(tagFile, tracks) : false),
    () => (tagFile.getTag(TagTypes.Xiph, false) ? embedLyricsToXiphTag(tagFile, tracks) : false),
    () => (tagFile.getTag(TagTypes.Apple, false) ? embedLyricsToAppleTag(tagFile, tracks) : false),
    () => (tagFile.getTag(TagTypes.Asf, false) ? embedLyricsToAsfTag(tagFile, tracks) : false),
    () => (tagFile.getTag(TagTypes.Ape, false) ? embedLyricsToApeTag(tagFile, tracks) : false),
  ]

  for (const strategy of embeddingStrategies) {
    try {
      if (strategy()) return undefined
    } catch (error) {
      console.warn('Try embed lyrics with specific tag failed:', error)
    }
  }

  const fallbackTag = tagFile.tag
  fallbackTag.lyrics = tracks.lyric || ''

  if (tracks.tlyric || tracks.rlyric || tracks.lxlyric) {
    return '当前音频格式仅内嵌了主歌词，翻译/罗马音/逐字歌词未找到可写入的标准标签槽位'
  }

  return undefined
}

function mergeDownloadWarnings(...warnings: Array<string | undefined>) {
  const normalized = warnings
    .map((warning) => warning?.trim())
    .filter((warning): warning is string => Boolean(warning))

  if (!normalized.length) return undefined
  return normalized.join('；')
}

function emitSongDownloadEvent(targetWindow: BrowserWindow | null, payload: SongDownloadEventPayload) {
  if (!targetWindow || targetWindow.isDestroyed()) return
  targetWindow.webContents.send('downloads:event', payload)
}

const activeDownloads = new Map<string, AbortController>()

async function downloadHttpSourceToFile(
  source: string,
  destinationPath: string,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<DownloadBinaryResult> {
  const fetchFn = (globalThis as any).fetch as
    | ((input: string, init?: { method?: string; signal?: AbortSignal }) => Promise<any>)
    | undefined

  if (!fetchFn) {
    throw new Error('当前环境不支持网络下载')
  }

  const response = await fetchFn(source, { method: 'GET', signal })
  if (!response?.ok) {
    throw new Error(`下载失败 (${response?.status || 'unknown'})`)
  }

  const contentType = response.headers?.get?.('content-type') || null
  const totalBytes = Number(response.headers?.get?.('content-length') || 0) || 0
  const reader = response.body?.getReader?.()

  if (!reader) {
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    await fs.promises.writeFile(destinationPath, buffer)
    onProgress(100)
    return { mimeType: contentType }
  }

  const output = fs.createWriteStream(destinationPath)
  let writtenBytes = 0

  try {
    while (true) {
      signal?.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break

      const buffer = Buffer.from(chunk.value)
      writtenBytes += buffer.length
      await new Promise<void>((resolve, reject) => {
        output.write(buffer, (error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })

      if (totalBytes > 0) {
        onProgress(Math.min(99, Math.round((writtenBytes / totalBytes) * 100)))
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      output.end((error?: Error | null) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  onProgress(100)
  return { mimeType: contentType }
}

async function copyLocalSourceToFile(sourcePath: string, destinationPath: string, onProgress: (progress: number) => void): Promise<DownloadBinaryResult> {
  await fs.promises.copyFile(sourcePath, destinationPath)
  onProgress(100)
  return { mimeType: mime.lookup(path.extname(sourcePath)) || null }
}

async function writeDownloadSourceToTempFile(
  source: string,
  destinationPath: string,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<DownloadBinaryResult> {
  const localPath = getLocalPathFromSource(source)
  if (localPath) {
    return copyLocalSourceToFile(localPath, destinationPath, onProgress)
  }

  return downloadHttpSourceToFile(source, destinationPath, onProgress, signal)
}

function decodeDataUrl(value: string) {
  const commaIndex = value.indexOf(',')
  if (commaIndex < 0) {
    throw new Error('无效的 data URL')
  }

  const meta = value.slice(5, commaIndex)
  const body = value.slice(commaIndex + 1)
  const mimeType = meta.split(';')[0] || 'application/octet-stream'
  const isBase64 = meta.includes(';base64')

  return {
    mimeType,
    buffer: isBase64
      ? Buffer.from(body, 'base64')
      : Buffer.from(decodeURIComponent(body)),
  }
}

async function loadBinaryDataFromSource(source: string): Promise<{ buffer: Buffer; mimeType: string | null }> {
  if (/^data:/i.test(source)) {
    return decodeDataUrl(source)
  }

  const localPath = getLocalPathFromSource(source)
  if (localPath) {
    return {
      buffer: await fs.promises.readFile(localPath),
      mimeType: mime.lookup(path.extname(localPath)) || null,
    }
  }

  const fetchFn = (globalThis as any).fetch as
    | ((input: string, init?: { method?: string }) => Promise<any>)
    | undefined

  if (!fetchFn) {
    throw new Error('当前环境不支持远程文件读取')
  }

  const response = await fetchFn(source, { method: 'GET' })
  if (!response?.ok) {
    throw new Error(`读取远程资源失败 (${response?.status || 'unknown'})`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: response.headers?.get?.('content-type') || null,
  }
}

function mimeTypeToCoverExtension(mimeType?: string | null) {
  const normalized = (mimeType || '').split(';')[0].trim().toLowerCase()
  if (!normalized) return ''

  switch (normalized) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'image/bmp':
    case 'image/x-ms-bmp':
      return '.bmp'
    default: {
      const extension = mime.extension(normalized)
      return extension ? `.${extension}` : ''
    }
  }
}

function normalizeCoverExtension(extension?: string | null) {
  const normalized = (extension || '').trim().toLowerCase()
  if (!normalized) return ''
  const withDot = normalized.startsWith('.') ? normalized : `.${normalized}`
  return SUPPORTED_DOWNLOAD_COVER_EXTENSIONS.has(withDot) ? withDot : ''
}

function resolveCoverExtension(source: string, mimeType: string | null) {
  return normalizeCoverExtension(mimeTypeToCoverExtension(mimeType))
    || normalizeCoverExtension(getExtensionFromUrl(source))
    || '.jpg'
}

function getExternalLyricContent(payload: SongDownloadPayload) {
  const tracks = collectEmbeddedLyricTracks(payload)
  return tracks.lyric || normalizeEmbeddedLyricContent(payload.lyrics || payload.lyricData?.lyric)
}

async function writeExternalLyricFile(targetDirectory: string, baseName: string, payload: SongDownloadPayload) {
  const lyric = getExternalLyricContent(payload)
  if (!lyric) return '未获取到歌词，未生成外挂 .lrc 文件'

  const lyricPath = await getUniqueFilePath(targetDirectory, baseName, '.lrc')
  await fs.promises.writeFile(lyricPath, `${lyric}\n`, 'utf8')
  return undefined
}

async function writeExternalCoverFile(targetDirectory: string, baseName: string, payload: SongDownloadPayload) {
  if (!payload.coverUrl) return '未获取到封面，未生成外挂封面文件'

  const cover = await loadBinaryDataFromSource(payload.coverUrl)
  const extension = resolveCoverExtension(payload.coverUrl, cover.mimeType)
  const coverPath = await getUniqueFilePath(targetDirectory, baseName, extension)
  await fs.promises.writeFile(coverPath, cover.buffer)
  return undefined
}

async function writeExternalMetadataFiles(targetDirectory: string, baseName: string, payload: SongDownloadPayload) {
  if (!payload.saveExternalMetadataFiles) return undefined

  const warnings: Array<string | undefined> = []

  try {
    warnings.push(await writeExternalLyricFile(targetDirectory, baseName, payload))
  } catch (error) {
    console.warn('Write external lyric file failed:', error)
    warnings.push(error instanceof Error ? `外挂歌词写入失败：${error.message}` : '外挂歌词写入失败')
  }

  try {
    warnings.push(await writeExternalCoverFile(targetDirectory, baseName, payload))
  } catch (error) {
    console.warn('Write external cover file failed:', error)
    warnings.push(error instanceof Error ? `外挂封面写入失败：${error.message}` : '外挂封面写入失败')
  }

  return mergeDownloadWarnings(...warnings)
}

async function embedAudioMetadata(filePath: string, payload: SongDownloadPayload) {
  const tagFile = TagLibFile.createFromPath(filePath)

  try {
    const tag = tagFile.tag
    tag.title = payload.song.title || ''
    tag.performers = payload.song.artist ? [payload.song.artist] : []
    tag.albumArtists = payload.song.artist ? [payload.song.artist] : []
    tag.album = payload.song.album || ''
    const lyricWarning = embedLyricsIntoTagFile(tagFile, filePath, payload)

    if (payload.coverUrl) {
      const cover = await loadBinaryDataFromSource(payload.coverUrl)
      tag.pictures = [
        Picture.fromFullData(
          ByteVector.fromByteArray(cover.buffer),
          PictureType.FrontCover,
          cover.mimeType || 'image/jpeg',
          'Cover',
        ),
      ]
    }

    tagFile.save()
    return lyricWarning
  } finally {
    tagFile.dispose()
  }
}

async function handleSongDownload(targetWindow: BrowserWindow | null, payload: SongDownloadPayload) {
  if (!payload?.taskId || !payload?.source || !payload?.targetDirectory) {
    throw new Error('下载参数不完整')
  }

  const targetDirectory = payload.targetDirectory.trim() || getDefaultDownloadDirectory()
  ensureDirectoryExists(targetDirectory)

  const baseName = buildSongDownloadBaseName(payload)
  const tempPath = path.join(targetDirectory, `${payload.taskId}.download`)
  let finalPath = ''

  const abortController = new AbortController()
  activeDownloads.set(payload.taskId, abortController)

  emitSongDownloadEvent(targetWindow, {
    taskId: payload.taskId,
    status: 'pending',
    progress: 0,
  })

  try {
    const sourceResult = await writeDownloadSourceToTempFile(payload.source, tempPath, (progress) => {
      emitSongDownloadEvent(targetWindow, {
        taskId: payload.taskId,
        status: 'downloading',
        progress,
      })
    }, abortController.signal)

    const extension = await resolveAudioExtension(payload.source, sourceResult.mimeType, tempPath)
    finalPath = await getUniqueFilePath(targetDirectory, baseName, extension)

    await fs.promises.rename(tempPath, finalPath)

    let metadataWarning: string | undefined
    try {
      metadataWarning = await embedAudioMetadata(finalPath, payload)
    } catch (error) {
      console.warn('Embed audio metadata failed:', error)
      metadataWarning = error instanceof Error ? `音频已下载，但元数据写入失败：${error.message}` : '音频已下载，但元数据写入失败'
    }

    const externalFileWarning = await writeExternalMetadataFiles(targetDirectory, baseName, payload)
    const warning = mergeDownloadWarnings(metadataWarning, externalFileWarning)

    activeDownloads.delete(payload.taskId)

    emitSongDownloadEvent(targetWindow, {
      taskId: payload.taskId,
      status: 'completed',
      progress: 100,
      filePath: finalPath,
      warning,
    })

    return {
      taskId: payload.taskId,
      filePath: finalPath,
      warning,
      metadataEmbedded: !metadataWarning,
    }
  } catch (error) {
    activeDownloads.delete(payload.taskId)
    await fs.promises.unlink(tempPath).catch(() => {})

    if (abortController.signal.aborted) return undefined as never

    emitSongDownloadEvent(targetWindow, {
      taskId: payload.taskId,
      status: 'failed',
      progress: 0,
      error: error instanceof Error ? error.message : '下载失败',
      filePath: finalPath || undefined,
    })

    throw error
  }
}

function getLocalMusicCoverCacheDir() {
  return path.join(app.getPath('userData'), 'local-music-covers')
}

function ensureLocalMusicCoverCacheDir() {
  const coverDir = getLocalMusicCoverCacheDir()
  fs.mkdirSync(coverDir, { recursive: true })
  return coverDir
}

function getLocalMusicPlaybackCacheDir() {
  return path.join(app.getPath('userData'), 'local-music-playback-cache')
}

function ensureLocalMusicPlaybackCacheDir() {
  const cacheDir = getLocalMusicPlaybackCacheDir()
  fs.mkdirSync(cacheDir, { recursive: true })
  return cacheDir
}

function toLocalMusicFileUrl(filePath: string) {
  return pathToFileURL(filePath).toString()
}

function buildLocalMusicSongId(filePath: string) {
  return createHash('sha1').update(filePath).digest('hex')
}

function getPictureExtension(format?: string) {
  switch ((format || '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg'
    case 'image/avif':
      return '.avif'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'image/bmp':
      return '.bmp'
    default:
      return '.img'
  }
}

function shouldNormalizeLocalMusicCover(format?: string, byteLength = 0) {
  const normalizedFormat = (format || '').toLowerCase()
  return normalizedFormat === 'image/avif'
    || normalizedFormat === 'image/gif'
    || normalizedFormat === 'image/webp'
    || byteLength > 2 * 1024 * 1024
}

function convertCoverWithSips(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/sips',
      ['-s', 'format', 'jpeg', '-Z', '1200', inputPath, '--out', outputPath],
      (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      },
    )
  })
}

async function persistLocalMusicCover(picture: IPicture | null): Promise<string | undefined> {
  if (!picture?.data?.length) return undefined

  const buffer = Buffer.from(picture.data)
  const coverHash = createHash('sha1').update(buffer).digest('hex')
  const coverCacheDir = ensureLocalMusicCoverCacheDir()
  const extension = getPictureExtension(picture.format)
  const shouldNormalize = process.platform === 'darwin' && shouldNormalizeLocalMusicCover(picture.format, buffer.length)
  const outputPath = path.join(coverCacheDir, `${coverHash}${shouldNormalize ? '.jpg' : extension}`)

  if (!fs.existsSync(outputPath)) {
    if (shouldNormalize) {
      const tempInputPath = path.join(coverCacheDir, `${coverHash}${extension}`)
      try {
        await fs.promises.writeFile(tempInputPath, buffer)
        await convertCoverWithSips(tempInputPath, outputPath)
      } catch (error) {
        console.warn('Normalize local music cover failed, fallback to original buffer:', error)
        await fs.promises.writeFile(outputPath, buffer)
      } finally {
        await fs.promises.unlink(tempInputPath).catch(() => {})
      }
    } else {
      await fs.promises.writeFile(outputPath, buffer)
    }
  }

  return toLocalMusicFileUrl(outputPath)
}

const EXTERNAL_COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']

async function findExternalCoverFile(filePath: string): Promise<string | undefined> {
  const dir = path.dirname(filePath)
  const baseName = path.basename(filePath, path.extname(filePath))
  for (const ext of EXTERNAL_COVER_EXTENSIONS) {
    const candidate = path.join(dir, baseName + ext)
    try {
      await fs.promises.access(candidate, fs.constants.R_OK)
      return candidate
    } catch { /* not found, try next */ }
  }
  return undefined
}

function transcodeLocalAudioForPlayback(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') {
      reject(new Error('当前系统暂不支持本地音频转码兜底'))
      return
    }

    const playbackCacheDir = ensureLocalMusicPlaybackCacheDir()
    const outputHash = createHash('sha1').update(filePath).digest('hex')
    const outputPath = path.join(playbackCacheDir, `${outputHash}.wav`)

    const finish = async() => {
      try {
        const stat = await fs.promises.stat(outputPath)
        if (stat.size > 0) {
          resolve(toLocalMusicFileUrl(outputPath))
          return
        }
      } catch {
        // continue to convert
      }

      execFile(
        '/usr/bin/afconvert',
        ['-f', 'WAVE', '-d', 'LEI16', filePath, outputPath],
        (error) => {
          if (error) {
            reject(error)
            return
          }
          resolve(toLocalMusicFileUrl(outputPath))
        },
      )
    }

    void finish()
  })
}

async function cacheRemoteAudioForPlayback(source: string): Promise<string> {
  const playbackCacheDir = ensureLocalMusicPlaybackCacheDir()
  const sourceHash = createHash('sha1').update(source).digest('hex')
  const tempPath = path.join(playbackCacheDir, `${sourceHash}.download`)
  let finalPath = ''

  try {
    const sourceResult = await writeDownloadSourceToTempFile(source, tempPath, () => {})
    const extension = await resolveAudioExtension(source, sourceResult.mimeType, tempPath)
    finalPath = path.join(playbackCacheDir, `${sourceHash}${extension}`)

    if (fs.existsSync(finalPath)) {
      await fs.promises.unlink(finalPath).catch(() => {})
    }

    await fs.promises.rename(tempPath, finalPath)
    return toLocalMusicFileUrl(finalPath)
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {})
    throw error
  }
}

function formatLrcTimestamp(timestampMs: number) {
  return formatPreciseLrcTimestamp(timestampMs)
}

function lyricDescriptorPriority(descriptor: string | undefined) {
  const normalized = descriptor?.trim().toLowerCase() || ''
  if (!normalized) return 0
  if (normalized.includes('translation') || normalized.includes('trans') || normalized.includes('翻译')) return 3
  if (normalized.includes('roman') || normalized.includes('roma') || normalized.includes('拼音')) return 4
  if (normalized.includes('word') || normalized.includes('karaoke') || normalized.includes('逐字')) return 1
  return 2
}

function lyricTagToText(tag: ILyricsTag) {
  const syncLines = Array.isArray(tag.syncText) ? tag.syncText : []
  const hasTimedSyncText = syncLines.length > 0
    && tag.timeStampFormat === 2
    && syncLines.some((line) => typeof line.timestamp === 'number' && Number.isFinite(line.timestamp))

  if (hasTimedSyncText) {
    return syncLines
      .map((line) => {
        const text = line.text?.trim()
        if (!text) return ''
        if (typeof line.timestamp === 'number' && Number.isFinite(line.timestamp)) {
          return `${formatLrcTimestamp(line.timestamp)}${text}`
        }
        return text
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  const unsyncedText = tag.text?.trim()
  if (unsyncedText) return unsyncedText

  if (!syncLines.length) return ''

  return syncLines
    .map((line) => line.text?.trim() || '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

function extractEmbeddedLyrics(lyrics: ILyricsTag[] | undefined) {
  if (!Array.isArray(lyrics) || !lyrics.length) return undefined

  const normalized = lyrics
    .map((item) => ({
      text: lyricTagToText(item).trim(),
      descriptor: item.descriptor?.trim(),
      hasText: Boolean(item.text?.trim()),
      hasTimedSyncText: Array.isArray(item.syncText)
        && item.timeStampFormat === 2
        && item.syncText.some((line) => typeof line.timestamp === 'number' && Number.isFinite(line.timestamp)),
    }))
    .filter((item) => Boolean(item.text))

  if (!normalized.length) return undefined

  normalized.sort((left, right) => {
    const descriptorDelta = lyricDescriptorPriority(left.descriptor) - lyricDescriptorPriority(right.descriptor)
    if (descriptorDelta !== 0) return descriptorDelta

    if (left.hasText !== right.hasText) {
      return left.hasText ? -1 : 1
    }

    if (left.hasTimedSyncText !== right.hasTimedSyncText) {
      return left.hasTimedSyncText ? -1 : 1
    }

    return right.text.length - left.text.length
  })

  return normalized[0]?.text || undefined
}

async function readExternalLrcFile(filePath: string): Promise<string | undefined> {
  const dir = path.dirname(filePath)
  const baseName = path.basename(filePath, path.extname(filePath))
  const lrcPath = path.join(dir, baseName + '.lrc')
  try {
    const content = await fs.promises.readFile(lrcPath, 'utf-8')
    const trimmed = content.trim()
    return trimmed || undefined
  } catch { return undefined }
}

type EmbeddedLyricTracks = {
  lyric?: string
  tlyric?: string
  rlyric?: string
  lxlyric?: string
}

function pickFirstEmbeddedLyric(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeEmbeddedLyricContent(value)
    if (normalized) return normalized
  }
  return undefined
}

function getId3LyricsByDescriptor(tag: Id3v2Tag | undefined, description: string) {
  if (!tag) return undefined

  const normalizedDescription = description.trim().toLowerCase()
  const frames = tag.getFramesByClassType<Id3v2UnsynchronizedLyricsFrame>(Id3v2FrameClassType.UnsynchronizedLyricsFrame)
  const matchedFrame = frames.find((frame) => (frame.description?.trim().toLowerCase() || '') === normalizedDescription)
  return normalizeEmbeddedLyricContent(matchedFrame?.text)
}

function getId3UserText(tag: Id3v2Tag | undefined, description: string) {
  if (!tag) return undefined

  const frames = tag.getFramesByClassType<Id3v2UserTextInformationFrame>(Id3v2FrameClassType.UserTextInformationFrame)
  const matchedFrame = Id3v2UserTextInformationFrame.findUserTextInformationFrame(frames, description, false)
  return normalizeEmbeddedLyricContent(matchedFrame?.text.join('\n'))
}

function getXiphFieldText(tag: XiphComment | undefined, key: string) {
  return normalizeEmbeddedLyricContent(tag?.getFieldFirstValue(key))
}

function getAppleFreeformText(tag: Mpeg4AppleTag | undefined, name: string) {
  return normalizeEmbeddedLyricContent(tag?.getFirstItunesString(MP4_LYRIC_MEAN, name))
}

function getAsfDescriptorText(tag: AsfTag | undefined, name: string) {
  return normalizeEmbeddedLyricContent(tag?.getDescriptorString(name))
}

function getApeItemText(tag: ApeTag | undefined, key: string) {
  return normalizeEmbeddedLyricContent(tag?.getItem(key)?.text.join('\n'))
}

function extractEmbeddedLyricTracksFromTagFile(filePath: string, fallbackLyric?: string): EmbeddedLyricTracks {
  let tagFile: ReturnType<typeof TagLibFile.createFromPath> | null = null

  try {
    tagFile = TagLibFile.createFromPath(filePath)

    const id3Tag = tagFile.getTag(TagTypes.Id3v2, false) as Id3v2Tag | undefined
    const xiphTag = tagFile.getTag(TagTypes.Xiph, false) as XiphComment | undefined
    const appleTag = tagFile.getTag(TagTypes.Apple, false) as Mpeg4AppleTag | undefined
    const asfTag = tagFile.getTag(TagTypes.Asf, false) as AsfTag | undefined
    const apeTag = tagFile.getTag(TagTypes.Ape, false) as ApeTag | undefined

    return {
      lyric: pickFirstEmbeddedLyric(
        fallbackLyric,
        id3Tag?.lyrics,
        xiphTag?.lyrics,
        appleTag?.lyrics,
        asfTag?.lyrics,
        apeTag?.lyrics,
      ),
      tlyric: pickFirstEmbeddedLyric(
        getId3LyricsByDescriptor(id3Tag, ID3_TRANSLATION_DESCRIPTOR),
        getXiphFieldText(xiphTag, EXTRA_LYRIC_FIELD_TRANSLATION),
        getAppleFreeformText(appleTag, EXTRA_LYRIC_FIELD_TRANSLATION),
        getAsfDescriptorText(asfTag, EXTRA_LYRIC_FIELD_TRANSLATION),
        getApeItemText(apeTag, EXTRA_LYRIC_FIELD_TRANSLATION),
      ),
      rlyric: pickFirstEmbeddedLyric(
        getId3LyricsByDescriptor(id3Tag, ID3_ROMANIZED_DESCRIPTOR),
        getXiphFieldText(xiphTag, EXTRA_LYRIC_FIELD_ROMANIZED),
        getAppleFreeformText(appleTag, EXTRA_LYRIC_FIELD_ROMANIZED),
        getAsfDescriptorText(asfTag, EXTRA_LYRIC_FIELD_ROMANIZED),
        getApeItemText(apeTag, EXTRA_LYRIC_FIELD_ROMANIZED),
      ),
      lxlyric: pickFirstEmbeddedLyric(
        getId3UserText(id3Tag, EXTRA_LYRIC_FIELD_WORD_TIMED),
        getXiphFieldText(xiphTag, EXTRA_LYRIC_FIELD_WORD_TIMED),
        getAppleFreeformText(appleTag, EXTRA_LYRIC_FIELD_WORD_TIMED),
        getAsfDescriptorText(asfTag, EXTRA_LYRIC_FIELD_WORD_TIMED),
        getApeItemText(apeTag, EXTRA_LYRIC_FIELD_WORD_TIMED),
      ),
    }
  } catch (error) {
    console.warn('Read embedded lyric tracks from tag file failed:', filePath, error)
    return {
      lyric: normalizeEmbeddedLyricContent(fallbackLyric),
    }
  } finally {
    tagFile?.dispose()
  }
}

function buildLocalPlaybackLyricFromTracks(tracks: EmbeddedLyricTracks) {
  const lxlyric = normalizeEmbeddedLyricContent(tracks.lxlyric)
  const inlineWordLyric = normalizeEmbeddedLyricContent(convertWordTimedLrcToInline(lxlyric))
  const rawBaseLyric = normalizeEmbeddedLyricContent(tracks.lyric)
  const convertedBaseLyric = normalizeEmbeddedLyricContent(convertWordTimedLrcToInline(rawBaseLyric))
  const baseLyric = normalizeEmbeddedLyricContent(inlineWordLyric || convertedBaseLyric || rawBaseLyric)
  const tlyric = normalizeEmbeddedLyricContent(tracks.tlyric)
  const rlyric = normalizeEmbeddedLyricContent(tracks.rlyric)

  return normalizeEmbeddedLyricContent(buildCompositeEmbeddedLyric(baseLyric, rlyric, tlyric) || baseLyric)
}

function normalizeTagText(value: string | undefined | null) {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeTagStringArray(values: Array<string | undefined | null> | undefined) {
  if (!Array.isArray(values)) return undefined

  const normalized = values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))

  return normalized.length ? Array.from(new Set(normalized)) : undefined
}

function extractEmbeddedComment(comments: IAudioMetadata['common']['comment']) {
  if (!Array.isArray(comments) || !comments.length) return undefined

  const normalized = comments
    .map((item) => item.text?.trim())
    .filter((item): item is string => Boolean(item))

  return normalized.length ? Array.from(new Set(normalized)).join('\n\n') : undefined
}

function getRawLocalSongArtist(common: IAudioMetadata['common']) {
  return normalizeTagText(common.artist)
    || normalizeTagText(common.artists?.filter(Boolean).join(', '))
    || undefined
}

function getRawLocalSongTags(metadata: IAudioMetadata, embeddedTracks?: EmbeddedLyricTracks): LocalSongEmbeddedTags {
  return {
    title: normalizeTagText(metadata.common.title),
    artist: getRawLocalSongArtist(metadata.common),
    album: normalizeTagText(metadata.common.album),
    albumArtist: normalizeTagText(metadata.common.albumartist),
    composers: normalizeTagStringArray(metadata.common.composer),
    genres: normalizeTagStringArray(metadata.common.genre),
    year: typeof metadata.common.year === 'number' && Number.isFinite(metadata.common.year) ? metadata.common.year : undefined,
    trackNo: typeof metadata.common.track.no === 'number' && Number.isFinite(metadata.common.track.no) ? metadata.common.track.no : undefined,
    trackTotal: typeof metadata.common.track.of === 'number' && Number.isFinite(metadata.common.track.of) ? metadata.common.track.of : undefined,
    discNo: typeof metadata.common.disk.no === 'number' && Number.isFinite(metadata.common.disk.no) ? metadata.common.disk.no : undefined,
    discTotal: typeof metadata.common.disk.of === 'number' && Number.isFinite(metadata.common.disk.of) ? metadata.common.disk.of : undefined,
    comment: extractEmbeddedComment(metadata.common.comment),
    lyrics: embeddedTracks?.lyric || extractEmbeddedLyrics(metadata.common.lyrics),
    tlyric: embeddedTracks?.tlyric,
    rlyric: embeddedTracks?.rlyric,
    lxlyric: embeddedTracks?.lxlyric,
  }
}

function resolveLocalMusicRootFolder(filePath: string, rootFolderPath?: string) {
  const normalizedRoot = typeof rootFolderPath === 'string' ? rootFolderPath.trim() : ''
  return normalizedRoot || path.dirname(filePath)
}

async function loadLocalMusicFileMetadata(filePath: string, externalFirst?: boolean) {
  const musicMetadata = await loadMusicMetadataModule()
  const [metadata, fileStat] = await Promise.all([
    musicMetadata.parseFile(filePath, {
      duration: true,
      skipCovers: false,
    }),
    fs.promises.stat(filePath),
  ])

  const embeddedCover = await persistLocalMusicCover(musicMetadata.selectCover(metadata.common.picture))
  const externalCover = await (async () => {
    const externalPath = await findExternalCoverFile(filePath)
    return externalPath ? toLocalMusicFileUrl(externalPath) : undefined
  })()
  const cover = externalFirst
    ? (externalCover || embeddedCover)
    : (embeddedCover || externalCover)

  return {
    metadata,
    fileStat,
    cover,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return []

  const results = new Array<R>(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async() => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  })

  await Promise.all(runners)
  return results
}

async function collectLocalMusicFiles(folderPaths: string[]) {
  const fileMap = new Map<string, string>()

  for (const folderPath of folderPaths) {
    const stack = [folderPath]

    while (stack.length) {
      const currentDir = stack.pop()
      if (!currentDir) continue

      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
      } catch (error) {
        console.warn('Read local music directory failed:', currentDir, error)
        continue
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue

        const fullPath = path.join(currentDir, entry.name)

        if (entry.isDirectory()) {
          stack.push(fullPath)
          continue
        }

        if (!entry.isFile()) continue

        const extension = path.extname(entry.name).toLowerCase()
        if (!SUPPORTED_LOCAL_MUSIC_EXTENSIONS.has(extension)) continue
        if (!fileMap.has(fullPath)) {
          fileMap.set(fullPath, folderPath)
        }
      }
    }
  }

  return Array.from(fileMap.entries()).map(([filePath, rootFolder]) => ({ filePath, rootFolder }))
}

function isHiddenLocalMusicPath(filePath: string) {
  return path.basename(filePath).startsWith('.')
}

function buildFallbackLocalSong(filePath: string, rootFolder: string): LocalMusicSong {
  const fileName = path.basename(filePath, path.extname(filePath))

  return {
    id: buildLocalMusicSongId(filePath),
    name: fileName,
    artist: '未知歌手',
    album: '',
    duration: 0,
    platform: 'local',
    url: toLocalMusicFileUrl(filePath),
    localPath: filePath,
    localFolder: rootFolder,
  }
}

async function parseLocalMusicSong(filePath: string, rootFolder: string, skipExternalFallback?: boolean, externalFirst?: boolean): Promise<LocalMusicSong> {
  const fallback = buildFallbackLocalSong(filePath, rootFolder)

  try {
    const { metadata, fileStat, cover } = await loadLocalMusicFileMetadata(filePath, externalFirst)

    const title = metadata.common.title?.trim() || fallback.name
    const artist = metadata.common.artist?.trim()
      || metadata.common.artists?.filter(Boolean).join(', ').trim()
      || metadata.common.albumartist?.trim()
      || fallback.artist
    const album = metadata.common.album?.trim() || ''
    const duration = metadata.format.duration && Number.isFinite(metadata.format.duration)
      ? Math.round(metadata.format.duration)
      : 0
    const embeddedLyricTracks = extractEmbeddedLyricTracksFromTagFile(
      filePath,
      extractEmbeddedLyrics(metadata.common.lyrics),
    )
    const embeddedLyrics = buildLocalPlaybackLyricFromTracks(embeddedLyricTracks) || embeddedLyricTracks.lyric
    const externalLyrics = skipExternalFallback ? undefined : await readExternalLrcFile(filePath)
    const lyrics = externalFirst
      ? (externalLyrics || embeddedLyrics)
      : (embeddedLyrics || externalLyrics)
    const trackNo = typeof metadata.common.track.no === 'number' && Number.isFinite(metadata.common.track.no)
      ? metadata.common.track.no
      : undefined
    const discNo = typeof metadata.common.disk.no === 'number' && Number.isFinite(metadata.common.disk.no)
      ? metadata.common.disk.no
      : undefined

    return {
      ...fallback,
      name: title,
      artist,
      album,
      duration,
      cover,
      lrc: lyrics,
      localFileSize: fileStat.size,
      localModifiedAt: fileStat.mtime.toISOString(),
      localTrackNo: trackNo,
      localDiscNo: discNo,
    }
  } catch (error) {
    console.warn('Parse local music metadata failed:', filePath, error)
    try {
      const fileStat = await fs.promises.stat(filePath)
      return {
        ...fallback,
        localFileSize: fileStat.size,
        localModifiedAt: fileStat.mtime.toISOString(),
      }
    } catch {
      return fallback
    }
  }
}

async function readLocalSongMetadataDetail(filePath: string, rootFolderPath?: string, options?: { skipExternalFallback?: boolean }): Promise<LocalSongMetadataDetail> {
  const normalizedPath = filePath.trim()
  if (!normalizedPath) {
    throw new Error('无效的本地文件路径')
  }

  const skipExternal = options?.skipExternalFallback === true
  const externalFirst = localMusicTagPriority === 'external-first'
  const rootFolder = resolveLocalMusicRootFolder(normalizedPath, rootFolderPath)
  const fallbackSong = buildFallbackLocalSong(normalizedPath, rootFolder)
  const { metadata, fileStat, cover } = await loadLocalMusicFileMetadata(normalizedPath, externalFirst)
  const embeddedLyricTracks = extractEmbeddedLyricTracksFromTagFile(
    normalizedPath,
    extractEmbeddedLyrics(metadata.common.lyrics),
  )
  let rawTags = getRawLocalSongTags(metadata, embeddedLyricTracks)
  if (!rawTags.lyrics && !skipExternal) {
    const externalLrc = await readExternalLrcFile(normalizedPath)
    if (externalLrc) rawTags = { ...rawTags, lyrics: externalLrc }
  }
  const displaySong = await parseLocalMusicSong(normalizedPath, rootFolder, skipExternal, externalFirst)

  return {
    song: displaySong,
    filePath: normalizedPath,
    fileName: path.basename(normalizedPath),
    directoryPath: path.dirname(normalizedPath),
    rootFolderPath: rootFolderPath?.trim() || undefined,
    fileSize: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    duration: displaySong.duration || fallbackSong.duration,
    cover: cover || displaySong.cover,
    format: normalizeTagText(metadata.format.container),
    codec: normalizeTagText(metadata.format.codec),
    bitrate: typeof metadata.format.bitrate === 'number' && Number.isFinite(metadata.format.bitrate)
      ? metadata.format.bitrate
      : undefined,
    sampleRate: typeof metadata.format.sampleRate === 'number' && Number.isFinite(metadata.format.sampleRate)
      ? metadata.format.sampleRate
      : undefined,
    bitsPerSample: typeof metadata.format.bitsPerSample === 'number' && Number.isFinite(metadata.format.bitsPerSample)
      ? metadata.format.bitsPerSample
      : undefined,
    lossless: typeof metadata.format.lossless === 'boolean' ? metadata.format.lossless : undefined,
    tags: rawTags,
  }
}

function normalizeTagArrayInput(values: string[] | undefined) {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(
    values
      .map((value) => value.trim())
      .filter(Boolean),
  ))
}

function normalizeTagScalarInput(value: string | undefined) {
  const normalized = value?.trim()
  return normalized || ''
}

function normalizeOptionalTagNumber(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : 0
}

async function writeLocalSongMetadata(payload: LocalSongMetadataUpdatePayload): Promise<LocalSongMetadataDetail> {
  const normalizedPath = payload.filePath.trim()
  if (!normalizedPath) {
    throw new Error('无效的本地文件路径')
  }

  const tagFile = TagLibFile.createFromPath(normalizedPath)

  try {
    const tag = tagFile.tag
    const nextTags = payload.tags || {}

    tag.title = normalizeTagScalarInput(nextTags.title)
    tag.performers = normalizeTagScalarInput(nextTags.artist)
      ? [normalizeTagScalarInput(nextTags.artist)]
      : []
    tag.album = normalizeTagScalarInput(nextTags.album)
    tag.albumArtists = normalizeTagScalarInput(nextTags.albumArtist)
      ? [normalizeTagScalarInput(nextTags.albumArtist)]
      : []
    tag.composers = normalizeTagArrayInput(nextTags.composers)
    tag.genres = normalizeTagArrayInput(nextTags.genres)
    tag.year = normalizeOptionalTagNumber(nextTags.year)
    tag.track = normalizeOptionalTagNumber(nextTags.trackNo)
    tag.trackCount = normalizeOptionalTagNumber(nextTags.trackTotal)
    tag.disc = normalizeOptionalTagNumber(nextTags.discNo)
    tag.discCount = normalizeOptionalTagNumber(nextTags.discTotal)
    tag.comment = normalizeTagScalarInput(nextTags.comment)
    tag.lyrics = normalizeTagScalarInput(nextTags.lyrics)

    tagFile.save()
  } finally {
    tagFile.dispose()
  }

  return readLocalSongMetadataDetail(normalizedPath, payload.rootFolderPath, { skipExternalFallback: true })
}

function compareLocalMusicSongs(left: LocalMusicSong, right: LocalMusicSong) {
  const artistCompare = left.artist.localeCompare(right.artist, 'zh-CN')
  if (artistCompare !== 0) return artistCompare

  const albumCompare = left.album.localeCompare(right.album, 'zh-CN')
  if (albumCompare !== 0) return albumCompare

  const discCompare = (left.localDiscNo || 0) - (right.localDiscNo || 0)
  if (discCompare !== 0) return discCompare

  const trackCompare = (left.localTrackNo || 0) - (right.localTrackNo || 0)
  if (trackCompare !== 0) return trackCompare

  return left.name.localeCompare(right.name, 'zh-CN')
}

type TagPriority = 'embedded-first' | 'external-first'

async function scanLocalMusicFolders(folderPaths: string[]): Promise<LocalMusicScanResult> {
  const uniqueFolders = Array.from(new Set(
    folderPaths
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  ))

  const existingFolders: string[] = []
  for (const folderPath of uniqueFolders) {
    try {
      const stat = await fs.promises.stat(folderPath)
      if (stat.isDirectory()) {
        existingFolders.push(folderPath)
      }
    } catch {
      // folder doesn't exist or inaccessible
    }
  }

  if (!existingFolders.length) {
    return {
      folders: [],
      songs: [],
      scannedAt: new Date().toISOString(),
    }
  }

  const files = await collectLocalMusicFiles(existingFolders)
  const externalFirst = localMusicTagPriority === 'external-first'
  const songs = (await mapWithConcurrency(files, LOCAL_MUSIC_SCAN_CONCURRENCY, async({ filePath, rootFolder }) => (
    parseLocalMusicSong(filePath, rootFolder, false, externalFirst)
  ))).filter((song) => !isHiddenLocalMusicPath(song.localPath || ''))

  songs.sort(compareLocalMusicSongs)

  return {
    folders: existingFolders,
    songs,
    scannedAt: new Date().toISOString(),
  }
}

// Window state persistence
type WindowState = {
  bounds?: Electron.Rectangle
  isMaximized?: boolean
  alwaysOnTop?: boolean
  miniBounds?: Electron.Rectangle
  opacity?: number
}

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState | null {
  if (mainWindowStateLoaded) {
    return { bounds: mainWindowBounds || undefined }
  }
  mainWindowStateLoaded = true
  try {
    const statePath = getWindowStatePath()
    if (fs.existsSync(statePath)) {
      const raw = fs.readFileSync(statePath, 'utf8')
      const parsed = JSON.parse(raw) as WindowState
      if (parsed?.bounds) {
        mainWindowBounds = parsed.bounds
      }
      if (typeof parsed?.alwaysOnTop === 'boolean') {
        mainWindowAlwaysOnTop = parsed.alwaysOnTop
      }
      if (parsed?.miniBounds) {
        mainWindowMiniBounds = parsed.miniBounds
      }
      if (typeof parsed?.opacity === 'number' && Number.isFinite(parsed.opacity)) {
        mainWindowOpacity = Math.min(1, Math.max(0.35, parsed.opacity))
      }
      return parsed
    }
  } catch (error) {
    console.warn('Load window state failed:', error)
  }
  return null
}

function saveWindowState() {
  if (!mainWindow) return
  const statePath = getWindowStatePath()
  const bounds = mainWindowMiniMode
    ? mainWindowPreMiniBounds || mainWindowBounds || mainWindow.getBounds()
    : (mainWindow.isMaximized() ? mainWindowBounds || undefined : mainWindow.getBounds())
  const state: WindowState = {
    bounds,
    isMaximized: mainWindowMiniMode ? mainWindowPreMiniWasMaximized : mainWindow.isMaximized(),
    alwaysOnTop: mainWindowAlwaysOnTop,
    miniBounds: mainWindowMiniBounds || undefined,
    opacity: mainWindowOpacity,
  }
  fs.promises.writeFile(statePath, JSON.stringify(state)).catch((error) => {
    console.warn('Save window state failed:', error)
  })
}

function clampWindowBounds(bounds: Electron.Rectangle) {
  const display = screen.getDisplayMatching(bounds)
  const { x, y, width, height } = display.workArea

  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, x), x + width - bounds.width),
    y: Math.min(Math.max(bounds.y, y), y + height - bounds.height),
  }
}

function setMainWindowAlwaysOnTop(enabled: boolean) {
  mainWindowAlwaysOnTop = enabled
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (process.platform === 'darwin') {
      mainWindow.setAlwaysOnTop(enabled, enabled ? 'screen-saver' : 'normal')
      mainWindow.setVisibleOnAllWorkspaces(enabled, { visibleOnFullScreen: enabled })
    } else {
      mainWindow.setAlwaysOnTop(enabled)
    }

    if (enabled) {
      mainWindow.show()
      mainWindow.moveTop()
      mainWindow.focus()
    }
  }
  saveWindowState()
  return mainWindowAlwaysOnTop
}

function setMainWindowOpacity(opacity: number) {
  const clampedOpacity = Math.min(1, Math.max(0.35, opacity))
  mainWindowOpacity = clampedOpacity

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(clampedOpacity)
  }

  saveWindowState()
  return mainWindowOpacity
}

function setMainWindowMiniMode(enabled: boolean) {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (mainWindowMiniMode === enabled) return mainWindowMiniMode

  if (enabled) {
    const currentBounds = mainWindow.isMaximized()
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds()

    mainWindowPreMiniBounds = currentBounds
    mainWindowPreMiniWasMaximized = mainWindow.isMaximized()
    mainWindowBounds = currentBounds

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    }

    mainWindow.setResizable(false)
    mainWindow.setMinimumSize(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT)
    mainWindow.setMaximumSize(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT)

    const targetBounds = clampWindowBounds(mainWindowMiniBounds
      ? {
          ...mainWindowMiniBounds,
          width: MINI_WINDOW_WIDTH,
          height: MINI_WINDOW_HEIGHT,
        }
      : {
          width: MINI_WINDOW_WIDTH,
          height: MINI_WINDOW_HEIGHT,
          x: Math.round(currentBounds.x + (currentBounds.width - MINI_WINDOW_WIDTH) / 2),
          y: Math.round(currentBounds.y + (currentBounds.height - MINI_WINDOW_HEIGHT) / 2),
        })

    mainWindow.setContentSize(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT)
    mainWindow.setSize(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT, true)
    mainWindow.setBounds(targetBounds, true)
    mainWindowMiniBounds = mainWindow.getBounds()
    if (mainWindowAlwaysOnTop) {
      setMainWindowAlwaysOnTop(true)
    }
    mainWindowMiniMode = true
    return true
  }

  mainWindow.setResizable(true)
  mainWindow.setMinimumSize(DEFAULT_MIN_WINDOW_WIDTH, DEFAULT_MIN_WINDOW_HEIGHT)
  mainWindow.setMaximumSize(10000, 10000)
  mainWindow.setOpacity(1)

  const restoreBounds = mainWindowPreMiniBounds || mainWindowBounds
  if (restoreBounds) {
    mainWindow.setBounds(restoreBounds, true)
    mainWindowBounds = restoreBounds
  }

  if (mainWindowPreMiniWasMaximized) {
    mainWindow.maximize()
  }

  mainWindowMiniMode = false
  mainWindowPreMiniBounds = null
  mainWindowPreMiniWasMaximized = false
  return false
}

function createWindow() {
  // Load saved window state
  const savedState = loadWindowState()

  mainWindow = new BrowserWindow({
    width: savedState?.bounds?.width || DEFAULT_WINDOW_WIDTH,
    height: savedState?.bounds?.height || DEFAULT_WINDOW_HEIGHT,
    x: savedState?.bounds?.x,
    y: savedState?.bounds?.y,
    minWidth: DEFAULT_MIN_WINDOW_WIDTH,
    minHeight: DEFAULT_MIN_WINDOW_HEIGHT,
    alwaysOnTop: mainWindowAlwaysOnTop,
    frame: false,
    transparent: false,
    backgroundColor: '#1c1c1e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow loading local resources
      allowRunningInsecureContent: true,
      // Let Chromium throttle rAF/timers when the window is hidden or occluded.
      // Audio playback keeps the page audible, which exempts media/timer events
      // from throttling, so playback and desktop-lyrics sync are unaffected.
      backgroundThrottling: true,
    },
    show: false,
  })
  mainWindow.setOpacity(1)
  mainWindow.setAspectRatio(DEFAULT_WINDOW_WIDTH / DEFAULT_WINDOW_HEIGHT)

  // Maximize if was maximized before
  if (savedState?.isMaximized) {
    mainWindow.maximize()
  }

  // Graceful show
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    // Windows thumbar buttons (prev / play-pause / next)
    setWindowsThumbarButtons()
    if (isDev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // Re-apply thumbar after hide→show (Windows may drop them)
  mainWindow.on('show', () => {
    setWindowsThumbarButtons()
  })

  if (!isDev) {
    // Keep DevTools shortcuts blocked in production builds only.
    mainWindow.webContents.on('before-input-event', (event, input) => {
      // Block F12
      if (input.key === 'F12') {
        event.preventDefault()
        return
      }
      // Block Cmd+Option+I (macOS) / Ctrl+Shift+I (Windows/Linux)
      if (input.key.toLowerCase() === 'i' && ((isMac && input.meta && input.alt) || (!isMac && input.control && input.shift))) {
        event.preventDefault()
        return
      }
      // Block Cmd+Option+J (macOS) / Ctrl+Shift+J (Windows/Linux) - console
      if (input.key.toLowerCase() === 'j' && ((isMac && input.meta && input.alt) || (!isMac && input.control && input.shift))) {
        event.preventDefault()
        return
      }
      // Block Cmd+Option+C (macOS) / Ctrl+Shift+C (Windows/Linux) - inspect element
      if (input.key.toLowerCase() === 'c' && ((isMac && input.meta && input.alt) || (!isMac && input.control && input.shift))) {
        event.preventDefault()
        return
      }
    })
  }

  // Load app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
    mainWindow.loadFile(indexPath)
  }

  // External links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Window events
  mainWindow.on('closed', () => {
    mainWindowMiniMode = false
    mainWindowPreMiniBounds = null
    mainWindowPreMiniWasMaximized = false
    mainWindow = null
  })

  // Keep desktop lyrics visible when the main window is minimized (Windows may minimize all app windows together).
  mainWindow.on('minimize', () => {
    if (process.platform === 'darwin') return
    if (!desktopLyricsEnabled) return
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
    setTimeout(() => {
      if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
      if (desktopLyricsWindow.isMinimized()) {
        desktopLyricsWindow.restore()
      }
      desktopLyricsWindow.showInactive()
      applyDesktopLyricsAlwaysOnTopState()
    }, 0)
  })

  // Save window bounds when moved or resized
  mainWindow.on('move', () => {
    if (!mainWindow) return

    if (mainWindowMiniMode) {
      mainWindowMiniBounds = mainWindow.getBounds()
      saveWindowState()
      return
    }

    if (!mainWindow.isMaximized()) {
      mainWindowBounds = mainWindow.getBounds()
    }
  })

  mainWindow.on('resize', () => {
    if (!mainWindow) return

    if (mainWindowMiniMode) {
      mainWindowMiniBounds = mainWindow.getBounds()
      saveWindowState()
      return
    }

    if (!mainWindow.isMaximized()) {
      mainWindowBounds = mainWindow.getBounds()
    }
  })

  // Windows system-level close should fully quit the app.
  // On macOS we still keep the native window close interception unless the app is already quitting.
  mainWindow.on('close', (event) => {
    // Save window state before closing
    saveWindowState()

    if (isQuitting || forceQuit) return

    if (isWin) {
      event.preventDefault()
      requestAppQuit()
      return
    }

    if (process.platform === 'darwin') {
      event.preventDefault()
      mainWindow?.webContents.send('window:show-close-dialog')
    }
  })
}

function getBuildAssetDir(...subpaths: string[]): string | null {
  const candidates = [
    path.join(__dirname, '../build', ...subpaths),
    path.join(__dirname, '../../build', ...subpaths),
    path.join(app.getAppPath(), 'build', ...subpaths),
    path.join(process.resourcesPath || '', 'build', ...subpaths),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function sendTrayPlayerAction(action: 'play-pause' | 'previous' | 'next') {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(`tray:${action}`)
}

function getTaskbarIcon(name: 'prev' | 'play' | 'pause' | 'next'): Electron.NativeImage {
  const iconPath = getBuildAssetDir('taskbar', `${name}.png`)
  if (!iconPath) {
    console.warn(`Taskbar icon not found: ${name}.png`)
    return nativeImage.createEmpty()
  }
  return nativeImage.createFromPath(iconPath)
}

/** Windows taskbar thumbnail toolbar (prev / play-pause / next), same idea as lx-music. */
function setWindowsThumbarButtons() {
  if (!isWin || !mainWindow || mainWindow.isDestroyed()) return

  const empty = playerMediaState.empty
  const flags: Array<'disabled' | 'nobackground'> = empty
    ? ['nobackground', 'disabled']
    : ['nobackground']

  const buttons: Electron.ThumbarButton[] = [
    {
      icon: getTaskbarIcon('prev'),
      tooltip: '上一首',
      flags,
      click: () => sendTrayPlayerAction('previous'),
    },
    playerMediaState.isPlaying
      ? {
          icon: getTaskbarIcon('pause'),
          tooltip: '暂停',
          flags,
          click: () => sendTrayPlayerAction('play-pause'),
        }
      : {
          icon: getTaskbarIcon('play'),
          tooltip: '播放',
          flags,
          click: () => sendTrayPlayerAction('play-pause'),
        },
    {
      icon: getTaskbarIcon('next'),
      tooltip: '下一首',
      flags,
      click: () => sendTrayPlayerAction('next'),
    },
  ]

  try {
    mainWindow.setThumbarButtons(buttons)
  } catch (error) {
    console.warn('setThumbarButtons failed:', error)
  }
}

function updateTrayContextMenu() {
  if (!tray) return

  const empty = playerMediaState.empty
  const playLabel = playerMediaState.isPlaying ? '暂停' : '播放'

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    {
      label: playLabel,
      enabled: !empty,
      click: () => sendTrayPlayerAction('play-pause'),
    },
    {
      label: '上一首',
      enabled: !empty,
      click: () => sendTrayPlayerAction('previous'),
    },
    {
      label: '下一首',
      enabled: !empty,
      click: () => sendTrayPlayerAction('next'),
    },
    { type: 'separator' },
    { label: '退出', click: () => requestAppQuit() },
  ])

  tray.setContextMenu(contextMenu)
}

function updateMacDockMenu() {
  if (!isMac || !app.dock) return

  const empty = playerMediaState.empty
  const playLabel = playerMediaState.isPlaying ? '暂停' : '播放'

  const dockMenu = Menu.buildFromTemplate([
    {
      label: playLabel,
      enabled: !empty,
      click: () => sendTrayPlayerAction('play-pause'),
    },
    {
      label: '上一首',
      enabled: !empty,
      click: () => sendTrayPlayerAction('previous'),
    },
    {
      label: '下一首',
      enabled: !empty,
      click: () => sendTrayPlayerAction('next'),
    },
  ])

  app.dock.setMenu(dockMenu)
}

function updateTrayTooltip() {
  if (!tray) return
  if (playerMediaState.empty || !playerMediaState.title) {
    tray.setToolTip('Sollin')
    return
  }
  const title = playerMediaState.title.length > 40
    ? `${playerMediaState.title.slice(0, 40)}...`
    : playerMediaState.title
  const artist = playerMediaState.artist
    ? playerMediaState.artist.length > 40
      ? `${playerMediaState.artist.slice(0, 40)}...`
      : playerMediaState.artist
    : ''
  tray.setToolTip(artist ? `Sollin\n${title}\n${artist}` : `Sollin\n${title}`)
}

function applyPlayerMediaState(partial: Partial<PlayerMediaState>) {
  const next: PlayerMediaState = { ...playerMediaState, ...partial }
  const changed =
    next.title !== playerMediaState.title ||
    next.artist !== playerMediaState.artist ||
    next.isPlaying !== playerMediaState.isPlaying ||
    next.empty !== playerMediaState.empty

  playerMediaState = next
  if (!changed) return

  updateTrayTooltip()
  updateTrayContextMenu()
  setWindowsThumbarButtons()
  updateMacDockMenu()
}

function createTray() {
  // Try to load tray icon from multiple possible paths
  let icon = nativeImage.createEmpty()

  // Try multiple paths for dev and production
  const basePaths = [
    path.join(__dirname, '../build'),
    path.join(__dirname, '../../build'),
    path.join(app.getAppPath(), 'build'),
    path.join(process.resourcesPath || '', 'build'),
  ]

  let iconDir = ''
  for (const p of basePaths) {
    if (fs.existsSync(path.join(p, 'tray-icon.png'))) {
      iconDir = p
      console.log('Found tray icon at:', p)
      break
    }
  }

  if (iconDir) {
    try {
      if (isMac) {
        // macOS: use colored circle icon with @2x for Retina
        const icon1x = path.join(iconDir, 'tray-icon.png')
        const icon2x = path.join(iconDir, 'tray-icon@2x.png')

        icon = nativeImage.createFromPath(icon1x)
        if (fs.existsSync(icon2x)) {
          const icon2xImage = nativeImage.createFromPath(icon2x)
          icon.addRepresentation({
            scaleFactor: 2,
            width: 18,
            height: 18,
            buffer: icon2xImage.toPNG(),
          })
        }
      } else if (isWin) {
        // Windows: use 32x32 icon
        const winIcon = path.join(iconDir, 'tray-icon-win.png')
        if (fs.existsSync(winIcon)) {
          icon = nativeImage.createFromPath(winIcon)
        } else {
          icon = nativeImage.createFromPath(path.join(iconDir, 'tray-icon.png'))
          icon = icon.resize({ width: 32, height: 32 })
        }
      } else {
        // Linux
        icon = nativeImage.createFromPath(path.join(iconDir, 'tray-icon.png'))
        icon = icon.resize({ width: 24, height: 24 })
      }
    } catch (e) {
      console.log('Error loading tray icon:', e)
    }
  } else {
    console.log('Tray icon not found in any path, tried:', basePaths)
  }

  tray = new Tray(icon)

  tray.setToolTip('Sollin')
  updateTrayContextMenu()
  updateMacDockMenu()

  tray.on('click', () => {
    mainWindow?.show()
  })

  // macOS: restore menu bar lyrics title if enabled
  if (process.platform === 'darwin' && menuBarLyricsEnabled) {
    try {
      tray.setTitle(latestLyric || '')
    } catch {
      // ignore
    }
  }
}

function sendDesktopLyricsStatus(enabled: boolean) {
  desktopLyricsEnabled = enabled
  saveDesktopLyricsState()
  mainWindow?.webContents.send('desktop-lyrics:status', enabled)
}

function sendDesktopLyricsLockStatus(locked: boolean) {
  desktopLyricsLocked = locked
  saveDesktopLyricsState()
  mainWindow?.webContents.send('desktop-lyrics:lock-status', locked)
}

function sendMenuBarLyricsStatus(enabled: boolean) {
  menuBarLyricsEnabled = enabled
  saveDesktopLyricsState()
  mainWindow?.webContents.send('menu-bar-lyrics:status', enabled)

  if (process.platform === 'darwin' && tray) {
    try {
      tray.setTitle(enabled ? (latestLyric || '') : '')
    } catch {
      // ignore
    }
  }
}

function toggleMenuBarLyrics() {
  const next = !menuBarLyricsEnabled
  sendMenuBarLyricsStatus(next)
}

function getDesktopLyricsUrl() {
  if (isDev) {
    return 'http://localhost:5173/desktop-lyrics.html'
  }
  const lyricsPath = path.join(__dirname, '..', 'dist', 'desktop-lyrics.html')
  return `file://${lyricsPath}`
}

function applyDesktopLyricsAlwaysOnTopState() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
  desktopLyricsWindow.setAlwaysOnTop(desktopLyricsAlwaysOnTop, isMac ? 'floating' : 'screen-saver')
}

function applyDesktopLyricsWindowShadow(hasShadow: boolean) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
  if (typeof desktopLyricsWindow.setHasShadow === 'function') {
    desktopLyricsWindow.setHasShadow(hasShadow)
  }
}

function setDesktopLyricsInteractive(interactive: boolean) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return

  desktopLyricsWindow.setFocusable(interactive)
  desktopLyricsWindow.setSkipTaskbar(true)
  applyDesktopLyricsAlwaysOnTopState()

  if (interactive) {
    desktopLyricsWindow.show()
  } else {
    desktopLyricsWindow.showInactive()
  }
}

function createDesktopLyricsWindow() {
  loadDesktopLyricsState()
  if (desktopLyricsWindow) return desktopLyricsWindow

  const width = desktopLyricsBounds?.width ?? 760
  const height = desktopLyricsBounds?.height ?? 220
  const x = desktopLyricsBounds?.x
  const y = desktopLyricsBounds?.y

  desktopLyricsWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })

  // Some Windows shells will minimize all windows in the same app group.
  // Force-restore the desktop lyrics window so it can stay visible.
  desktopLyricsWindow.on('minimize', () => {
    if (!desktopLyricsEnabled) return
    setTimeout(() => {
      if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
      if (desktopLyricsWindow.isMinimized()) {
        desktopLyricsWindow.restore()
      }
      desktopLyricsWindow.showInactive()
      applyDesktopLyricsAlwaysOnTopState()
    }, 0)
  })

  desktopLyricsWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  })
  applyDesktopLyricsAlwaysOnTopState()
  desktopLyricsWindow.setSkipTaskbar(true)
  desktopLyricsWindow.setMenu(null)

  desktopLyricsWindow.once('ready-to-show', () => {
    desktopLyricsWindow?.showInactive()
    setDesktopLyricsInteractive(false)
    sendDesktopLyricsStatus(true)
  })

  desktopLyricsWindow.on('show', () => {
    sendDesktopLyricsStatus(true)
    // The lyrics renderer keeps backgroundThrottling off, so tell it explicitly
    // when it is visible; it pauses its animation clock while hidden.
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsWindow.webContents.send('desktop-lyrics:visibility', true)
      desktopLyricsWindow.webContents.send('desktop-lyrics:state', latestDesktopLyricsPayload)
    }
  })
  desktopLyricsWindow.on('hide', () => {
    sendDesktopLyricsStatus(false)
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsWindow.webContents.send('desktop-lyrics:visibility', false)
    }
  })
  desktopLyricsWindow.on('blur', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
    if (desktopLyricsWindow.isVisible()) {
      setDesktopLyricsInteractive(false)
    }
  })
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null
    // App quit will close all windows; don't overwrite persisted enabled flag.
    if (!isQuitting) {
      sendDesktopLyricsStatus(false)
    }
  })

  desktopLyricsWindow.on('move', () => {
    if (!desktopLyricsWindow) return
    desktopLyricsBounds = desktopLyricsWindow.getBounds()
    saveDesktopLyricsState()
  })

  desktopLyricsWindow.on('resize', () => {
    if (!desktopLyricsWindow) return
    desktopLyricsBounds = desktopLyricsWindow.getBounds()
    saveDesktopLyricsState()
  })

  desktopLyricsWindow.webContents.on('did-finish-load', () => {
    if (latestLyric && desktopLyricsWindow) {
      desktopLyricsWindow.webContents.send('lyrics:update', latestLyric)
    }
    if (desktopLyricsWindow) {
      desktopLyricsWindow.webContents.send('desktop-lyrics:state', latestDesktopLyricsPayload)
    }
  })

  desktopLyricsWindow.loadURL(getDesktopLyricsUrl())
  return desktopLyricsWindow
}

function toggleDesktopLyricsWindow() {
  const win = createDesktopLyricsWindow()
  if (!win) return

  if (win.isVisible()) {
    win.hide()
    sendDesktopLyricsStatus(false)
  } else {
    if (desktopLyricsBounds) {
      win.setBounds(desktopLyricsBounds)
    }
    win.showInactive()
    applyDesktopLyricsAlwaysOnTopState()
    sendDesktopLyricsStatus(true)
    if (latestLyric) {
      win.webContents.send('lyrics:update', latestLyric)
    }
    win.webContents.send('desktop-lyrics:state', latestDesktopLyricsPayload)
  }
}

const kugouKrcKey = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69])
const kuwoLyricKey = Buffer.from('yeelion')
let qrcDecodeBinding: ((buf: Buffer, len: number) => Buffer) | null = null

const inflateBuffer = (data: Buffer) => new Promise<Buffer>((resolve, reject) => {
  inflate(data, (error, result) => {
    if (error) {
      reject(error)
      return
    }
    resolve(result)
  })
})

const inflateRawBuffer = (data: Buffer) => new Promise<Buffer>((resolve, reject) => {
  inflateRaw(data, (error, result) => {
    if (error) {
      reject(error)
      return
    }
    resolve(result)
  })
})

const gunzipBuffer = (data: Buffer) => new Promise<Buffer>((resolve, reject) => {
  gunzip(data, (error, result) => {
    if (error) {
      reject(error)
      return
    }
    resolve(result)
  })
})

const inflateBufferAuto = async(data: Buffer) => {
  try {
    return await inflateBuffer(data)
  } catch {
    try {
      return await inflateRawBuffer(data)
    } catch {
      return gunzipBuffer(data)
    }
  }
}

const inflateText = async(data: Buffer) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = []
  const stream = createInflate()
    .on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    .on('close', () => {
      resolve(Buffer.concat(chunks).toString())
    })
    .on('error', (error: any) => {
      if (error?.errno !== zlibConstants.Z_BUF_ERROR) {
        reject(error)
      }
    })

  stream.end(data)
})

const resolveQrcDecodeBindingPath = () => {
  const candidates = [
    path.join(__dirname, '../build/Release/qrc_decode.node'),
    path.join(__dirname, '../../build/Release/qrc_decode.node'),
    path.join(app.getAppPath(), 'build/Release/qrc_decode.node'),
    path.join(process.cwd(), 'build/Release/qrc_decode.node'),
    path.join(process.resourcesPath || '', 'build/Release/qrc_decode.node'),
  ]

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }

  throw new Error('未找到 qrc_decode.node')
}

const getQrcDecodeBinding = () => {
  if (qrcDecodeBinding) return qrcDecodeBinding
  const nativeBindingPath = resolveQrcDecodeBindingPath()
  const addon = require(nativeBindingPath)
  qrcDecodeBinding = addon.qrc_decode
  return qrcDecodeBinding
}

const decodeTxLyricPayload = async(payload: { lrc: string; tlrc: string; rlrc: string }) => {
  const qrcDecode = getQrcDecodeBinding()!
  const decodeOne = async(value: string) => {
    if (!value) return ''
    const buf = Buffer.from(value, 'hex')
    return inflateText(qrcDecode(buf, buf.length))
  }

  const [lyric, tlyric, rlyric] = await Promise.all([
    decodeOne(payload?.lrc || ''),
    decodeOne(payload?.tlrc || ''),
    decodeOne(payload?.rlrc || ''),
  ])

  return { lyric, tlyric, rlyric }
}

const decodeKwLyricPayload = async(payload: { lrcBase64: string; isGetLyricx: boolean }) => {
  try {
    const buf = Buffer.from(payload?.lrcBase64 || '', 'base64')
    if (buf.toString('utf8', 0, 10) !== 'tp=content') return ''

    const index = buf.indexOf('\r\n\r\n')
    if (index < 0) return ''

    const lrcData = await inflateBufferAuto(buf.subarray(index + 4))
    if (!payload?.isGetLyricx) {
      return Buffer.from(iconv.decode(lrcData, 'gb18030')).toString('base64')
    }

    const bufStr = Buffer.from(lrcData.toString(), 'base64')
    const output = new Uint8Array(bufStr.length)
    let i = 0
    while (i < bufStr.length) {
      let j = 0
      while (j < kuwoLyricKey.length && i < bufStr.length) {
        output[i] = bufStr[i] ^ kuwoLyricKey[j]
        i++
        j++
      }
    }

    return Buffer.from(iconv.decode(Buffer.from(output), 'gb18030')).toString('base64')
  } catch {
    return ''
  }
}

const decodeKrcLyricPayload = async(data: string) => {
  const buf = Buffer.from(data || '', 'base64').subarray(4)
  for (let index = 0; index < buf.length; index += 1) {
    buf[index] = buf[index] ^ kugouKrcKey[index % 16]
  }
  const result = await inflateBuffer(buf)
  return result.toString()
}

// IPC Handlers
function setupIpcHandlers() {
  setupAppDataStoreIpc()
  setupLxSourceIpcHandlers()
  setupDataSyncIpcHandlers()
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:set-mini-mode', (_event, enabled: boolean) => setMainWindowMiniMode(Boolean(enabled)))
  ipcMain.handle('window:set-always-on-top', (_event, enabled: boolean) => setMainWindowAlwaysOnTop(Boolean(enabled)))
  ipcMain.handle('window:set-opacity', (_event, opacity: number) => setMainWindowOpacity(Number(opacity)))
  ipcMain.on('window:close', () => mainWindow?.hide())
  ipcMain.on('window:quit', () => {
    requestAppQuit()
  })

  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())

  // System info
  ipcMain.handle('system:platform', () => process.platform)
  ipcMain.handle('system:version', () => app.getVersion())
  ipcMain.handle('global-shortcuts:get-state', () => cloneGlobalShortcutState())
  ipcMain.handle('global-shortcuts:set-config', (_event, config: unknown) => applyGlobalShortcutConfig(config))

  // Update tray tooltip / thumbar / dock from renderer playback state
  ipcMain.on('player:update-info', (_event, info: { title: string; artist: string; isPlaying?: boolean }) => {
    const title = typeof info?.title === 'string' ? info.title : ''
    const artist = typeof info?.artist === 'string' ? info.artist : ''
    const hasSong = Boolean(title || artist)
    applyPlayerMediaState({
      title,
      artist,
      empty: !hasSong,
      ...(typeof info?.isPlaying === 'boolean' ? { isPlaying: info.isPlaying } : {}),
    })
  })

  ipcMain.on('player:update-state', (_event, state: { isPlaying?: boolean; empty?: boolean; title?: string; artist?: string }) => {
    if (!state || typeof state !== 'object') return
    const patch: Partial<PlayerMediaState> = {}
    if (typeof state.isPlaying === 'boolean') patch.isPlaying = state.isPlaying
    if (typeof state.empty === 'boolean') patch.empty = state.empty
    if (typeof state.title === 'string') patch.title = state.title
    if (typeof state.artist === 'string') patch.artist = state.artist
    if (Object.keys(patch).length === 0) return
    applyPlayerMediaState(patch)
  })

  ipcMain.on('debug:preload-ready', (_event, payload) => {
    console.log('[preload:ready]', payload)
  })

  // Player state persistence (renderer -> main -> disk)
  ipcMain.handle('player-state:get', () => loadPlayerState())
  ipcMain.on('player-state:set', (_event, state: PersistedPlayerState) => savePlayerState(state))

  ipcMain.handle('background:pick-image', async() => {
    const dialogOptions = {
      title: '选择背景图片',
      filters: [
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] },
      ],
      properties: ['openFile'] as Array<'openFile'>,
    }

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || !result.filePaths[0]) return null
    return `file://${result.filePaths[0]}`
  })

  ipcMain.handle('local-music:pick-folders', async() => {
    const dialogOptions = {
      title: '选择本地音乐文件夹',
      properties: ['openDirectory', 'multiSelections'] as Array<'openDirectory' | 'multiSelections'>,
    }

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('local-music:scan-folders', async(_event, folders: unknown) => {
    const folderPaths = Array.isArray(folders)
      ? folders.filter((item): item is string => typeof item === 'string')
      : []
    return scanLocalMusicFolders(folderPaths)
  })

  ipcMain.handle('local-music:set-tag-priority', async(_event, priority: unknown) => {
    if (priority === 'external-first') {
      localMusicTagPriority = 'external-first'
    } else {
      localMusicTagPriority = 'embedded-first'
    }
  })

  ipcMain.handle('local-music:get-metadata', async(_event, payload: unknown) => {
    const request = payload as Partial<LocalSongMetadataRequest> | null | undefined
    if (!request?.filePath || typeof request.filePath !== 'string') {
      throw new Error('无效的本地文件路径')
    }
    return readLocalSongMetadataDetail(request.filePath, request.rootFolderPath, {
      skipExternalFallback: request.skipExternalFallback === true,
    })
  })

  ipcMain.handle('local-music:update-metadata', async(_event, payload: unknown) => {
    const request = payload as Partial<LocalSongMetadataUpdatePayload> | null | undefined
    if (!request?.filePath || typeof request.filePath !== 'string') {
      throw new Error('无效的本地文件路径')
    }
    return writeLocalSongMetadata({
      filePath: request.filePath,
      rootFolderPath: typeof request.rootFolderPath === 'string' ? request.rootFolderPath : undefined,
      tags: (request.tags || {}) as LocalSongEmbeddedTags,
    })
  })

  ipcMain.handle('local-music:prepare-playback', async(_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error('无效的本地文件路径')
    }
    return transcodeLocalAudioForPlayback(filePath)
  })

  ipcMain.handle('music:prepare-remote-playback', async(_event, source: unknown) => {
    if (typeof source !== 'string' || !source.trim()) {
      throw new Error('Invalid remote playback source')
    }
    return cacheRemoteAudioForPlayback(source)
  })

  ipcMain.handle('downloads:get-default-directory', () => {
    const defaultDirectory = getDefaultDownloadDirectory()
    ensureDirectoryExists(defaultDirectory)
    return defaultDirectory
  })

  ipcMain.handle('downloads:pick-directory', async() => {
    const dialogOptions = {
      title: '选择下载目录',
      defaultPath: getDefaultDownloadDirectory(),
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) return null

    ensureDirectoryExists(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle('downloads:open-directory', async(_event, directoryPath: unknown) => {
    if (typeof directoryPath !== 'string' || !directoryPath.trim()) {
      throw new Error('下载目录无效')
    }

    ensureDirectoryExists(directoryPath)
    const errorMessage = await shell.openPath(directoryPath)
    if (errorMessage) {
      throw new Error(errorMessage)
    }

    return true
  })

  ipcMain.handle('downloads:show-item-in-folder', async(_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error('文件路径无效')
    }

    shell.showItemInFolder(filePath)
    return true
  })

  ipcMain.handle('downloads:start', async(event, payload: SongDownloadPayload) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    return handleSongDownload(targetWindow, payload)
  })

  ipcMain.handle('downloads:cancel', async(_event, taskId: unknown) => {
    if (typeof taskId !== 'string' || !taskId) {
      throw new Error('任务 ID 无效')
    }

    const controller = activeDownloads.get(taskId)
    if (controller) {
      controller.abort()
      activeDownloads.delete(taskId)
    }

    return true
  })

  ipcMain.handle('downloads:delete-temp-file', async(_event, directory: unknown, taskId: unknown) => {
    if (typeof directory !== 'string' || typeof taskId !== 'string') return false
    const tempPath = path.join(directory, `${taskId}.download`)
    try {
      await fs.promises.unlink(tempPath)
    } catch {}
    return true
  })

  // Desktop lyrics
  ipcMain.on('lyrics:update', (_event, lyric: string) => {
    latestLyric = lyric
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsWindow.webContents.send('lyrics:update', lyric)
    }

    // macOS menu bar lyrics
    if (process.platform === 'darwin' && tray && menuBarLyricsEnabled) {
      try {
        tray.setTitle(lyric || '')
      } catch {
        // ignore
      }
    }
  })

  ipcMain.on('desktop-lyrics:toggle', () => {
    toggleDesktopLyricsWindow()
  })

  ipcMain.handle('desktop-lyrics:status', () => desktopLyricsEnabled)
  ipcMain.handle('desktop-lyrics:lock-status', () => desktopLyricsLocked)

  ipcMain.on('desktop-lyrics:lock', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
    if (!desktopLyricsWindow.isVisible()) {
      desktopLyricsWindow.showInactive()
      sendDesktopLyricsStatus(true)
    }
    sendDesktopLyricsLockStatus(true)
    desktopLyricsWindow.webContents.send('desktop-lyrics:lock')
  })

  ipcMain.on('desktop-lyrics:unlock', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
    if (!desktopLyricsWindow.isVisible()) {
      desktopLyricsWindow.showInactive()
      sendDesktopLyricsStatus(true)
    }
    sendDesktopLyricsLockStatus(false)
    desktopLyricsWindow.webContents.send('desktop-lyrics:unlock')
  })

  ipcMain.on('menu-bar-lyrics:toggle', () => {
    toggleMenuBarLyrics()
  })

  ipcMain.handle('menu-bar-lyrics:status', () => menuBarLyricsEnabled)

  ipcMain.on('desktop-lyrics:sync-state', (_event, payload: DesktopLyricsPayloadPatch) => {
    latestDesktopLyricsPayload = {
      ...latestDesktopLyricsPayload,
      ...payload,
    }
    const win = desktopLyricsWindow
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const keys = Object.keys(payload)
    const timingOnly = keys.length > 0 && keys.every((key) => key === 'currentTime' || key === 'isPlaying')
    if (timingOnly) {
      // Progress ticks arrive ~4x/s; don't re-send the song + full lyrics text each time.
      win.webContents.send('desktop-lyrics:timing', {
        currentTime: latestDesktopLyricsPayload.currentTime,
        isPlaying: latestDesktopLyricsPayload.isPlaying,
      })
    } else {
      win.webContents.send('desktop-lyrics:state', latestDesktopLyricsPayload)
    }
  })

  ipcMain.on('desktop-lyrics:set-position', (_event, payload: { x: number; y: number }) => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
    const { width, height } = desktopLyricsWindow.getBounds()
    desktopLyricsWindow.setBounds({ x: Math.round(payload.x), y: Math.round(payload.y), width, height })
    desktopLyricsBounds = desktopLyricsWindow.getBounds()
    saveDesktopLyricsState()
  })

  ipcMain.on('desktop-lyrics:set-ignore-mouse', (_event, ignore: boolean) => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
    desktopLyricsWindow.setIgnoreMouseEvents(ignore, { forward: true })
    setDesktopLyricsInteractive(!ignore)
  })

  ipcMain.on('desktop-lyrics:set-lock-status', (_event, locked: boolean) => {
    sendDesktopLyricsLockStatus(Boolean(locked))
  })

  ipcMain.on('desktop-lyrics:set-interactive', (_event, interactive: boolean) => {
    setDesktopLyricsInteractive(interactive)
  })

  ipcMain.on('desktop-lyrics:set-always-on-top', (_event, alwaysOnTop: boolean) => {
    desktopLyricsAlwaysOnTop = Boolean(alwaysOnTop)
    saveDesktopLyricsState()
    applyDesktopLyricsAlwaysOnTopState()
  })

  ipcMain.on('desktop-lyrics:set-has-shadow', (_event, hasShadow: boolean) => {
    applyDesktopLyricsWindowShadow(Boolean(hasShadow))
  })

  ipcMain.handle('music:decode-tx-lyric', (_event, payload: { lrc: string; tlrc: string; rlrc: string }) => {
    return decodeTxLyricPayload(payload)
  })

  ipcMain.handle('music:decode-kw-lyric', (_event, payload: { lrcBase64: string; isGetLyricx: boolean }) => {
    return decodeKwLyricPayload(payload)
  })

  ipcMain.handle('music:decode-krc-lyric', (_event, data: string) => {
    return decodeKrcLyricPayload(data)
  })

  ipcMain.handle('image:fetch-data-url', async(_event, url?: string) => {
    if (!url || typeof url !== 'string') return null

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return null
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null
    }

    const fetchFn = (globalThis as any).fetch as
      | ((input: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<any>)
      | undefined

    if (!fetchFn) return null

    try {
      const response = await fetchFn(parsedUrl.toString(), {
        method: 'GET',
      })

      if (!response?.ok) return null

      const contentType = response.headers?.get?.('content-type') || 'application/octet-stream'
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      return `data:${contentType};base64,${buffer.toString('base64')}`
    } catch (error) {
      console.warn('Fetch image as data URL failed:', error)
      return null
    }
  })

  // Resolve music play URL (follow 302 in main process to avoid CORS in renderer)
  ipcMain.handle('music:resolve-play-url', async (_event, payload: { url?: string; headers?: Record<string, string> }) => {
    const url = payload?.url
    if (!url || typeof url !== 'string') return null

    const headers = payload?.headers || undefined
    const parsedForLocal = new URL(url)
    const isLocalhost = parsedForLocal.hostname === 'localhost' || parsedForLocal.hostname === '::1' || parsedForLocal.hostname === '127.0.0.1'
    const resolveLocation = (location: string | undefined | null): string | null => {
      if (!location) return null
      try {
        return new URL(location, url).toString()
      } catch {
        return location
      }
    }

    const fetchFn = (globalThis as any).fetch as
      | ((input: string, init?: { method?: string; headers?: Record<string, string>; redirect?: 'manual' | 'follow' }) => Promise<any>)
      | undefined

    if (fetchFn && !isLocalhost) {
      try {
        const response = await fetchFn(url, {
          method: 'GET',
          headers,
          redirect: 'manual',
        })

        const location = response?.headers?.get?.('Location') || response?.headers?.get?.('location')
        const resolved = resolveLocation(location)
        if (resolved) return resolved

        if (response?.redirected && response?.url) {
          return response.url
        }

        if (response?.ok) {
          const text = await response.text()
          if (text) {
            try {
              const json = JSON.parse(text)
              const data = json?.data || json
              if (typeof data?.url === 'string' && data.url.length > 0) {
                return data.url
              }
            } catch {
              if (typeof text === 'string' && text.startsWith('http')) {
                return text
              }
            }
          }
        }
      } catch (error) {
        console.warn('Resolve play URL failed (fetch):', error)
      }
    }

    try {
      const resolved = await new Promise<string | null>((resolve) => {
        const parsed = new URL(url)
        const lib = parsed.protocol === 'https:' ? https : http
        const hostname =
          parsed.hostname === '::1'
            ? '127.0.0.1'
            : parsed.hostname
        const requestHeaders: Record<string, string> | undefined = headers
          ? { ...headers }
          : undefined
        if (hostname !== parsed.hostname && requestHeaders && !requestHeaders.Host && !requestHeaders.host) {
          requestHeaders.Host = parsed.host
        }

        const req = lib.request(
          {
            method: 'GET',
            protocol: parsed.protocol,
            hostname,
            port: parsed.port,
            path: `${parsed.pathname}${parsed.search}`,
            headers: requestHeaders,
            family: isLocalhost ? 4 : undefined,
          },
          (res) => {
            const location = resolveLocation(res.headers.location)
            if (location) {
              res.resume()
              resolve(location)
              return
            }

            const chunks: Buffer[] = []
            res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
            res.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8')
              if (!body) {
                resolve(null)
                return
              }
              try {
                const json = JSON.parse(body)
                const data = json?.data || json
                if (typeof data?.url === 'string' && data.url.length > 0) {
                  resolve(data.url)
                  return
                }
              } catch {
                if (body.startsWith('http')) {
                  resolve(body)
                  return
                }
              }
              resolve(null)
            })
          }
        )

        req.on('error', (error) => {
          console.warn('Resolve play URL failed (http):', error)
          resolve(null)
        })

        req.end()
      })

      if (resolved) return resolved
    } catch (error) {
      console.warn('Resolve play URL failed (http wrapper):', error)
    }

    return null
  })
}

// App lifecycle
app.whenReady().then(async() => {
  currentGlobalShortcutConfig = loadGlobalShortcutConfig()
  registerGlobalShortcuts(currentGlobalShortcutConfig)
  loadDesktopLyricsState()
  createWindow()
  createTray()
  setupIpcHandlers()
  await initializeLxSourceRuntime()
  await initializeDataSyncRuntime()

  if (desktopLyricsEnabled) {
    toggleDesktopLyricsWindow()
  }

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      mainWindow.show()
    }
  })
})



app.on('before-quit', () => {
  forceQuit = true
  isQuitting = true
  unregisterGlobalShortcuts()
  void disposeLxSourceRuntime()
  void disposeDataSyncRuntime()
  // Persist the current enabled state one last time.
  flushDesktopLyricsState()
  flushPendingWrites()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Security
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => {
    event.preventDefault()
  })
})
