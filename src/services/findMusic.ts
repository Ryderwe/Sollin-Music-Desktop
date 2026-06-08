import type { LxSongMeta, Platform, Song } from '@/types'
import { formatTime } from '@/utils/format'
import musicSdk from '@/vendor/lxmusic/renderer/utils/musicSdk/index.js'

// Thin wrapper around the vendored musicSdk.findMusic.  Converts lx-music-style musicInfo records
// into our internal Song shape so the playback pipeline can replay resolution using the regular
// LX source runtime path.

type LxSource = 'wy' | 'tx' | 'kw' | 'kg' | 'mg'

const LX_TO_PLATFORM: Record<LxSource, Platform> = {
  wy: 'netease',
  tx: 'qq',
  kw: 'kuwo',
  kg: 'kugou',
  mg: 'migu',
}

const PLATFORM_TO_LX: Record<Platform, LxSource> = {
  netease: 'wy',
  qq: 'tx',
  kuwo: 'kw',
  kugou: 'kg',
  migu: 'mg',
}

const parseIntervalSeconds = (interval: string | undefined): number => {
  if (!interval) return 0
  const parts = String(interval).split(':').map((part) => parseInt(part, 10))
  if (parts.some((value) => Number.isNaN(value))) return 0
  let seconds = 0
  let unit = 1
  while (parts.length) {
    seconds += (parts.pop() ?? 0) * unit
    unit *= 60
  }
  return seconds
}

const pickQualities = (item: any): LxSongMeta['types'] => {
  if (!Array.isArray(item?.types)) return undefined
  const qualities = item.types.map((quality: any) => ({
    type: String(quality?.type || ''),
    size: quality?.size ? String(quality.size) : undefined,
    hash: quality?.hash ? String(quality.hash) : undefined,
  })).filter((quality: { type: string }) => quality.type)
  return qualities.length ? (qualities as LxSongMeta['types']) : undefined
}

const musicInfoToSong = (item: any): Song | null => {
  if (!item) return null
  const lxSource = typeof item.source === 'string' ? item.source : null
  if (!lxSource || !(lxSource in LX_TO_PLATFORM)) return null

  const platform = LX_TO_PLATFORM[lxSource as LxSource]
  const id = String(item.songmid || item.songId || item.hash || item.rid || '')
  if (!id) return null

  const duration = item.interval ? parseIntervalSeconds(item.interval) : (typeof item.duration === 'number' ? item.duration : 0)
  const qualities = pickQualities(item)

  return {
    id,
    name: String(item.name || item.songName || ''),
    artist: String(item.singer || item.artist || ''),
    album: String(item.albumName || item.album || ''),
    albumId: item.albumId ? String(item.albumId) : undefined,
    duration,
    cover: typeof item.img === 'string' ? item.img : (typeof item.cover === 'string' ? item.cover : undefined),
    platform,
    lx: {
      source: lxSource as LxSource,
      songmid: item.songmid ? String(item.songmid) : undefined,
      songId: item.songId ? String(item.songId) : undefined,
      albumId: item.albumId ? String(item.albumId) : undefined,
      albumMid: item.albumMid ? String(item.albumMid) : undefined,
      strMediaMid: item.strMediaMid ? String(item.strMediaMid) : undefined,
      hash: item.hash ? String(item.hash) : undefined,
      copyrightId: item.copyrightId ? String(item.copyrightId) : undefined,
      lrcUrl: item.lrcUrl,
      mrcUrl: item.mrcUrl,
      trcUrl: item.trcUrl,
      interval: typeof item.interval === 'string' ? item.interval : formatTime(duration),
      albumName: item.albumName ? String(item.albumName) : undefined,
      img: typeof item.img === 'string' ? item.img : undefined,
      types: qualities,
      _types: item._types && typeof item._types === 'object' ? item._types : undefined,
    },
  }
}

export interface FindMusicOptions {
  excludePlatforms?: Platform[]
  maxResults?: number
  platformOrder?: Platform[]
}

export const findAlternativeSongs = async (
  song: Song,
  options: FindMusicOptions = {},
): Promise<Song[]> => {
  if (!song || song.platform === 'local') return []
  if (!song.name) return []

  const excludeSet = new Set<Platform>([song.platform, ...(options.excludePlatforms || [])])
  const maxResults = Math.max(1, options.maxResults ?? 5)
  const platformOrder = Array.isArray(options.platformOrder) && options.platformOrder.length > 0
    ? options.platformOrder
    : null

  try {
    const raw = await musicSdk.findMusic({
      name: song.name,
      singer: song.artist || '',
      albumName: song.album || '',
      interval: song.lx?.interval || formatTime(song.duration || 0),
      source: PLATFORM_TO_LX[song.platform as Platform],
    })
    if (!Array.isArray(raw)) return []

    const converted: Song[] = []
    for (const item of raw) {
      const candidate = musicInfoToSong(item)
      if (!candidate) continue
      if (excludeSet.has(candidate.platform as Platform)) continue
      excludeSet.add(candidate.platform as Platform)
      converted.push(candidate)
    }

    // When the caller supplied a preferred platform ordering (user's settings), honor it so that
    // the most-trusted platform is tried first regardless of how the SDK ranked the match.
    const ordered = platformOrder
      ? converted
        .slice()
        .sort((left, right) => {
          const leftRank = platformOrder.indexOf(left.platform as Platform)
          const rightRank = platformOrder.indexOf(right.platform as Platform)
          const leftScore = leftRank === -1 ? Number.POSITIVE_INFINITY : leftRank
          const rightScore = rightRank === -1 ? Number.POSITIVE_INFINITY : rightRank
          return leftScore - rightScore
        })
      : converted

    return ordered.slice(0, maxResults)
  } catch (error) {
    console.warn('[findMusic] lookup failed:', error)
    return []
  }
}

export { LX_TO_PLATFORM, PLATFORM_TO_LX }
