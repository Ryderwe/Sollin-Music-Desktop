import type { AudioQuality, LyricData, Song } from '@/types'
import api from '@/services/api'
import { cache } from '@/services/cache'
import { buildPlaybackLyricData } from '@/utils/format'

export interface SongPlaybackResource {
  song: Song
  requestUrl: string
  streamUrl: string
  actualQuality: AudioQuality | null
  sourceSwitch: string | null
  toggleSong: Song | null
  toggleAlternatives: Song[]
}

export interface SongPlaybackLyrics {
  lyricData: LyricData | null
  lyrics: string | null
}

interface CachedSongPlaybackUrl {
  url: string
  actualQuality?: AudioQuality | null
  sourceSwitch?: string | null
  toggleSong?: Song | null
  toggleAlternatives?: Song[]
}

export function buildLocalSongPlaybackLyrics(lrc: string | null | undefined): SongPlaybackLyrics {
  const lyricData = buildPlaybackLyricData(lrc)

  return {
    lyricData,
    lyrics: lyricData?.lyric || null,
  }
}

function isProbablyUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  if (!normalized) return false
  if (normalized.startsWith('//')) return true
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)
}

function isRemoteHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

export function toFileUrlFromLocalPath(filePath: string | undefined): string | null {
  if (!filePath) return null
  if (/^file:/i.test(filePath)) return filePath

  const normalizedPath = filePath.replace(/\\/g, '/')
  const pathWithLeadingSlash = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  return encodeURI(`file://${pathWithLeadingSlash}`)
}

async function resolveRendererPlaybackUrl(url: string) {
  if (!window.electronAPI?.resolvePlayUrl || !isRemoteHttpUrl(url)) {
    return url
  }

  try {
    const resolvedUrl = await window.electronAPI.resolvePlayUrl(url)
    return resolvedUrl || url
  } catch (error) {
    console.warn('Resolve playback URL failed, fallback to original URL:', error)
    return url
  }
}

export async function resolveSongPlaybackFallbackUrl(url: string) {
  return resolveRendererPlaybackUrl(url)
}

function getCachedSongUrl(song: Song, quality: AudioQuality): CachedSongPlaybackUrl | null {
  const cached = cache.get<string | CachedSongPlaybackUrl>('songUrl', song.platform, song.id, quality)
  if (!cached) return null
  if (typeof cached === 'string') return { url: cached }
  if (typeof cached.url === 'string' && cached.url) return cached
  return null
}

function saveCachedSongUrl(
  song: Song,
  requestedQuality: AudioQuality,
  actualQuality: AudioQuality,
  url: string,
  metadata?: Pick<CachedSongPlaybackUrl, 'sourceSwitch' | 'toggleSong' | 'toggleAlternatives'>,
) {
  const payload: CachedSongPlaybackUrl = {
    url,
    actualQuality,
    sourceSwitch: metadata?.sourceSwitch ?? null,
    toggleSong: metadata?.toggleSong ?? null,
    toggleAlternatives: Array.isArray(metadata?.toggleAlternatives) ? metadata.toggleAlternatives : [],
  }
  cache.set('songUrl', payload, undefined, song.platform, song.id, requestedQuality)
  if (requestedQuality !== actualQuality) {
    cache.set('songUrl', payload, undefined, song.platform, song.id, actualQuality)
  }
}

export function clearCachedSongUrl(song: Song | null | undefined) {
  if (!song?.id || !song.platform) return
  // Song URL cache keys embed the quality value.  Because we do not know which quality produced
  // the failing URL, clear every quality slot so the next resolution definitely hits the network.
  const qualities: AudioQuality[] = ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master']
  for (const quality of qualities) {
    cache.remove('songUrl', song.platform, song.id, quality)
  }
}

export async function resolveSongPlaybackResource(
  song: Song,
  options: {
    quality: AudioQuality
    refresh?: boolean
    allowTempSourceFallback?: boolean
    excludeFailedSongKeys?: string[]
  },
): Promise<SongPlaybackResource> {
  if (song.platform === 'local') {
    const requestUrl = toFileUrlFromLocalPath(song.localPath)
    if (!requestUrl) {
      throw new Error('本地文件路径无效，无法播放')
    }

    return {
      song,
      requestUrl,
      streamUrl: requestUrl,
      actualQuality: null,
      sourceSwitch: null,
      toggleSong: null,
      toggleAlternatives: [],
    }
  }

  const refresh = Boolean(options.refresh)
  const failedKeys = Array.isArray(options.excludeFailedSongKeys) ? options.excludeFailedSongKeys : []
  const originKey = `${song.platform}:${song.id}`
  // When the origin song is known to be unplayable, skip any cached value (which is probably the
  // broken URL that just failed) and force a fresh resolution round-trip.
  const skipOrigin = failedKeys.includes(originKey)

  let requestUrl = !refresh && !skipOrigin && isRemoteHttpUrl(song.url) ? song.url : null
  let actualQuality: AudioQuality = options.quality
  let sourceSwitch: string | null = null
  let toggleSong: Song | null = null
  let toggleAlternatives: Song[] = []
  let cachedPlaybackUrl: CachedSongPlaybackUrl | null = null

  if (!requestUrl && !refresh && !skipOrigin) {
    cachedPlaybackUrl = getCachedSongUrl(song, options.quality)
    if ((cachedPlaybackUrl?.sourceSwitch || cachedPlaybackUrl?.toggleSong) && options.allowTempSourceFallback === false) {
      cachedPlaybackUrl = null
    }
    requestUrl = cachedPlaybackUrl?.url ?? null
    if (cachedPlaybackUrl) {
      actualQuality = cachedPlaybackUrl.actualQuality ?? options.quality
      sourceSwitch = cachedPlaybackUrl.sourceSwitch ?? null
      toggleSong = cachedPlaybackUrl.toggleSong ?? null
      toggleAlternatives = Array.isArray(cachedPlaybackUrl.toggleAlternatives)
        ? cachedPlaybackUrl.toggleAlternatives
        : []
    }
  }

  if (!requestUrl) {
    const result = await api.getSongUrl(song.platform, song.id, options.quality, {
      song,
      allowTempSourceFallback: options.allowTempSourceFallback,
      excludeFailedSongKeys: failedKeys,
    })

    if (!result) {
      throw new Error('无法获取播放链接，请稍后重试')
    }

    if (result.error) {
      throw new Error(result.error.message || '无法获取播放链接，请检查网络或会员状态')
    }

    requestUrl = result.url
    actualQuality = result.quality
    sourceSwitch = result.sourceSwitch || null
    toggleSong = result.toggleSong || null
    toggleAlternatives = Array.isArray(result.toggleAlternatives) ? result.toggleAlternatives : []
    saveCachedSongUrl(song, options.quality, result.quality, result.url, {
      sourceSwitch,
      toggleSong,
      toggleAlternatives,
    })
  }

  return {
    song,
    requestUrl,
    streamUrl: requestUrl,
    actualQuality,
    sourceSwitch,
    toggleSong,
    toggleAlternatives,
  }
}

export async function resolveSongPlaybackLyrics(song: Song): Promise<SongPlaybackLyrics> {
  if (song.platform === 'local') {
    if (song.localPath && window.electronAPI?.getLocalSongMetadata) {
      try {
        const detail = await window.electronAPI.getLocalSongMetadata({
          filePath: song.localPath,
          rootFolderPath: song.localFolder,
        })
        const lyric = detail.song.lrc ?? detail.tags.lyrics ?? song.lrc ?? null
        const lyricData = lyric
          ? {
            lyric,
            tlyric: detail.tags.tlyric,
            rlyric: detail.tags.rlyric,
            lxlyric: detail.tags.lxlyric,
          }
          : null

        return {
          lyricData,
          lyrics: lyricData?.lyric || null,
        }
      } catch (error) {
        console.warn('Refresh local song lyrics failed, fallback to cached metadata:', error)
      }
    }

    return buildLocalSongPlaybackLyrics(song.lrc)
  }

  const lyricData = await api.getLyricData(song)
  return {
    lyricData,
    lyrics: lyricData?.lyric || null,
  }
}

export function hasSongRuntimeUrl(song: Song | null | undefined): song is Song & { url: string } {
  return Boolean(song && isProbablyUrl(song.url))
}
