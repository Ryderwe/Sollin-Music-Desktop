import type { Platform, Playlist, Song, SongPlatform } from '@/types'
import { neteaseAuthApi } from './neteaseAuth'
import { songRegistry } from './songRegistry'
import officialSearchApi from './officialSearchApi'
import { httpFetch } from '@/vendor/lxmusic/renderer/utils/request.js'
import getTxMusicInfo from '@/vendor/lxmusic/renderer/utils/musicSdk/tx/musicInfo.js'
import kgAlbum from '@/vendor/lxmusic/renderer/utils/musicSdk/kg/album.js'
import { getMusicInfo as getKugouMusicInfo } from '@/vendor/lxmusic/renderer/utils/musicSdk/kg/musicInfo.js'
import kwAlbum from '@/vendor/lxmusic/renderer/utils/musicSdk/kw/album.js'
import { getMusicInfo as getMiguMusicInfo } from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/musicInfo.js'

const DEFAULT_COVER_SIZE = 240

const requestCache = new Map<string, Promise<string | null>>()

const getSongKey = (song: Pick<Song, 'platform' | 'id'>) => `${song.platform}:${song.id}`

const isPlatform = (value: string | null): value is Platform => {
  return value === 'netease' || value === 'qq' || value === 'kuwo' || value === 'kugou' || value === 'migu'
}

const extractGatewayCoverMeta = (value: string): { platform: Platform; id: string } | null => {
  try {
    const url = new URL(value)
    const platform = url.searchParams.get('source')
    const id = url.searchParams.get('id')
    if (!isPlatform(platform) || !id) return null
    return { platform, id }
  } catch {
    return null
  }
}

const normalizeCoverUrl = (value: unknown, platform?: SongPlatform, size: number = DEFAULT_COVER_SIZE): string => {
  if (typeof value !== 'string') return ''
  let normalized = value.trim()
  if (!normalized) return ''

  if (normalized.includes('{size}')) {
    normalized = normalized.replace(/{size}/g, String(size))
  }

  if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`
  } else if (normalized.startsWith('http://')) {
    normalized = `https://${normalized.slice('http://'.length)}`
  }

  if (platform !== 'netease') return normalized

  try {
    const url = new URL(normalized)
    const host = url.hostname.toLowerCase()
    if ((host.endsWith('music.126.net') || host.endsWith('126.net')) && !url.searchParams.has('param')) {
      url.searchParams.set('param', `${size}y${size}`)
    }
    return url.toString()
  } catch {
    return normalized
  }
}

export const isGatewayCoverUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  if (!normalized) return false
  if (/^(blob:|data:|file:)/i.test(normalized)) return false

  try {
    const url = new URL(normalized)
    const path = url.pathname.toLowerCase()
    const search = url.search.toLowerCase()
    if (path.includes('/music/api')) return true
    if (search.includes('type=pic') && (search.includes('source=') || search.includes('id='))) return true
    return false
  } catch {
    const lowered = normalized.toLowerCase()
    return lowered.includes('/music/api') || (lowered.includes('type=pic') && lowered.includes('source='))
  }
}

const pickPreferredCover = (platform: SongPlatform | undefined, ...values: unknown[]) => {
  const normalized = values
    .map((value) => normalizeCoverUrl(value, platform))
    .filter(Boolean)

  const official = normalized.find((value) => !isGatewayCoverUrl(value))
  if (official) return official
  return normalized[0] || ''
}

const mergeSongCover = (song: Song, cover: string): Song => {
  if (!cover) return song
  return {
    ...song,
    cover,
    lx: song.lx
      ? {
          ...song.lx,
          img: cover,
        }
      : song.lx,
  }
}

const normalizeCompareText = (value: string | undefined) => value?.trim().toLowerCase().replace(/\s+/g, '') || ''

const isLikelySameSong = (source: Song, candidate: Song) => {
  if (source.id && candidate.id && source.id === candidate.id && source.platform === candidate.platform) {
    return true
  }

  const sourceName = normalizeCompareText(source.name)
  const candidateName = normalizeCompareText(candidate.name)
  const sourceArtist = normalizeCompareText(source.artist)
  const candidateArtist = normalizeCompareText(candidate.artist)

  if (!sourceName || !candidateName) return false
  if (sourceName !== candidateName) return false
  if (!sourceArtist || !candidateArtist) return true

  return sourceArtist === candidateArtist
    || sourceArtist.includes(candidateArtist)
    || candidateArtist.includes(sourceArtist)
}

const resolveSongBySearch = async(song: Song): Promise<Song | null> => {
  if (song.platform === 'local') return null

  const keyword = [song.name, song.artist].filter(Boolean).join(' ').trim()
  if (!keyword) return null

  try {
    const result = await officialSearchApi.searchSongs(song.platform, keyword, 8, 1)
    const matched = result.songs.find((candidate) => isLikelySameSong(song, candidate)) || result.songs[0]
    if (!matched) return null
    songRegistry.rememberSong(matched)
    return {
      ...song,
      ...matched,
      name: song.name || matched.name,
      artist: song.artist || matched.artist,
      album: song.album || matched.album,
      cover: matched.cover || song.cover,
      albumId: song.albumId || matched.albumId,
      lx: song.lx || matched.lx,
    }
  } catch {
    return null
  }
}

const stripGatewaySongCover = (song: Song): Song => {
  const currentCover = normalizeCoverUrl(song.cover, song.platform)
  const currentMetaCover = normalizeCoverUrl(song.lx?.img, song.platform)
  const shouldClearCover = currentCover && isGatewayCoverUrl(currentCover)
  const shouldClearMetaCover = currentMetaCover && isGatewayCoverUrl(currentMetaCover)

  if (!shouldClearCover && !shouldClearMetaCover) return song

  return {
    ...song,
    cover: shouldClearCover ? '' : currentCover,
    lx: song.lx
      ? {
          ...song.lx,
          img: shouldClearMetaCover ? '' : currentMetaCover,
        }
      : song.lx,
  }
}

const pickKugouHash = (song: Song) => {
  const preferredQuality = song.quality
  const qualityHash = preferredQuality ? song.lx?._types?.[preferredQuality]?.hash : undefined
  if (qualityHash) return qualityHash
  if (song.lx?.hash) return song.lx.hash
  const typedHash = song.lx?.types?.find((item) => item?.hash)?.hash
  if (typedHash) return typedHash
  return /^[a-fA-F0-9]{32}$/.test(song.id) ? song.id : ''
}

const resolveNeteaseCover = async(song: Song) => {
  const songs = await neteaseAuthApi.getSongDetail([song.lx?.songmid || song.id])
  return normalizeCoverUrl(songs[0]?.cover, 'netease')
}

const resolveQqCover = async(song: Song) => {
  const albumMid = song.lx?.albumMid || song.lx?.albumId || song.albumId
  if (albumMid) {
    return normalizeCoverUrl(`https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`, 'qq')
  }

  const info = await getTxMusicInfo(song.lx?.songmid || song.id)
  return normalizeCoverUrl(info?.img, 'qq')
}

const resolveKuwoCover = async(song: Song) => {
  const albumId = song.lx?.albumId || song.albumId
  if (!albumId) return ''

  const detail = await kwAlbum.getAlbumListDetail(String(albumId), 1)
  return normalizeCoverUrl(detail?.info?.img || detail?.list?.[0]?.img, 'kuwo')
}

const resolveKugouCover = async(song: Song) => {
  const directAlbumId = song.lx?.albumId || song.albumId
  if (directAlbumId) {
    const info = await kgAlbum.getAlbumInfo(String(directAlbumId))
    return normalizeCoverUrl(info?.image, 'kugou')
  }

  const hash = pickKugouHash(song)
  if (!hash) return ''

  const info = await getKugouMusicInfo(hash)
  const albumId = info?.albumId != null ? String(info.albumId) : ''
  if (!albumId) return ''

  const album = await kgAlbum.getAlbumInfo(albumId)
  return normalizeCoverUrl(album?.image, 'kugou')
}

const resolveMiguCover = async(song: Song) => {
  const lookupId = song.lx?.copyrightId || song.lx?.songmid || song.id
  if (!lookupId) return ''
  const info = await getMiguMusicInfo(lookupId)
  return normalizeCoverUrl(info?.img, 'migu')
}

const resolveOfficialCoverById = async(platform: Platform, id: string): Promise<string | null> => {
  const cacheKey = `${platform}:${id}`
  const cached = requestCache.get(cacheKey)
  if (cached) return cached

  const task = (async() => {
    try {
      switch (platform) {
        case 'netease': {
          const songs = await neteaseAuthApi.getSongDetail([id])
          return normalizeCoverUrl(songs[0]?.cover, 'netease') || null
        }
        case 'qq': {
          const info = await getTxMusicInfo(id)
          return normalizeCoverUrl(info?.img, 'qq') || null
        }
        case 'kuwo': {
          const requestObj = httpFetch(`https://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${id}`)
          const { statusCode, body } = await requestObj.promise as any
          if (statusCode !== 200) return null
          const url = typeof body === 'string' && /^https?:/i.test(body.trim()) ? body.trim() : ''
          return normalizeCoverUrl(url, 'kuwo') || null
        }
        case 'kugou': {
          const info = await getKugouMusicInfo(id)
          const albumId = info?.albumId != null ? String(info.albumId) : ''
          if (!albumId) return null
          const album = await kgAlbum.getAlbumInfo(albumId)
          return normalizeCoverUrl(album?.image, 'kugou') || null
        }
        case 'migu': {
          const info = await getMiguMusicInfo(id)
          return normalizeCoverUrl(info?.img, 'migu') || null
        }
      }
    } catch {
      return null
    }
  })()

  requestCache.set(cacheKey, task)
  return task
}

export const resolveCoverUrl = async(src?: string): Promise<string> => {
  const normalized = normalizeCoverUrl(src)
  if (!normalized) return ''
  if (!isGatewayCoverUrl(normalized)) return normalized

  const meta = extractGatewayCoverMeta(normalized)
  if (!meta) return ''

  return (await resolveOfficialCoverById(meta.platform, meta.id)) || ''
}

const fetchOfficialSongCover = async(song: Song): Promise<string | null> => {
  if (song.platform === 'local') return null

  const cacheKey = getSongKey(song)
  const cached = requestCache.get(cacheKey)
  if (cached) return cached

  const task = (async() => {
    try {
      switch (song.platform) {
        case 'netease':
          return (await resolveNeteaseCover(song)) || null
        case 'qq':
          return (await resolveQqCover(song)) || null
        case 'kuwo':
          return (await resolveKuwoCover(song)) || null
        case 'kugou':
          return (await resolveKugouCover(song)) || null
        case 'migu':
          return (await resolveMiguCover(song)) || null
        default:
          return null
      }
    } catch {
      return null
    }
  })()

  requestCache.set(cacheKey, task)
  return task
}

export const prepareSongForLibrary = (song: Song): Song => {
  const remembered = songRegistry.getSong(song.platform, String(song.id))
  const cover = pickPreferredCover(
    song.platform,
    song.cover,
    song.lx?.img,
    remembered?.cover,
    remembered?.lx?.img,
  )

  return cover ? mergeSongCover(song, cover) : song
}

export const resolveSongForLibrary = async(song: Song): Promise<Song> => {
  const prepared = prepareSongForLibrary(song)
  if (prepared.platform === 'local') {
    return prepared
  }

  const preparedCover = normalizeCoverUrl(prepared.cover, prepared.platform)
  if (preparedCover && !isGatewayCoverUrl(preparedCover)) {
    return mergeSongCover(prepared, preparedCover)
  }

  const officialCover = await fetchOfficialSongCover(prepared)
  if (officialCover) {
    const updated = mergeSongCover(prepared, officialCover)
    songRegistry.rememberSong(updated)
    return updated
  }

  const searchedSong = await resolveSongBySearch(prepared)
  if (searchedSong?.cover) {
    const updated = mergeSongCover(searchedSong, searchedSong.cover)
    songRegistry.rememberSong(updated)
    return updated
  }

  return stripGatewaySongCover(prepared)
}

const mapWithConcurrency = async<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
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

export const resolveSongsForLibrary = async(songs: Song[]): Promise<Song[]> => {
  return mapWithConcurrency(songs, 4, resolveSongForLibrary)
}

export const preparePlaylistForLibrary = (playlist: Playlist): Playlist => {
  const songs = (playlist.songs || []).map((song) => prepareSongForLibrary(song))
  const cover = pickPreferredCover(playlist.platform, playlist.cover, songs[0]?.cover)

  return {
    ...playlist,
    songs,
    songCount: songs.length,
    cover,
  }
}

export const resolvePlaylistForLibrary = async(playlist: Playlist): Promise<Playlist> => {
  const prepared = preparePlaylistForLibrary(playlist)
  const songs = await resolveSongsForLibrary(prepared.songs || [])
  const cover = pickPreferredCover(prepared.platform, prepared.cover, songs[0]?.cover)

  return {
    ...prepared,
    songs,
    songCount: songs.length,
    cover: cover && !isGatewayCoverUrl(cover) ? cover : songs[0]?.cover || '',
  }
}
