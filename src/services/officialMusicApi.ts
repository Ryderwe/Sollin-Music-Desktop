import type {
  OnlinePlaylist,
  OnlinePlaylistSong,
  PaginatedSongsResult,
  Platform,
  PlaylistDetail,
  PlaylistSortOption,
  PlaylistTagGroup,
  PlaylistTagInfo,
  PlaylistTagItem,
  RecommendPlaylist,
  RecommendPlaylistPage,
  Song,
  Toplist,
} from '@/types'
import { songRegistry } from './songRegistry'
import wyLeaderboard from '@/vendor/lxmusic/renderer/utils/musicSdk/wy/leaderboard.js'
import wySongList from '@/vendor/lxmusic/renderer/utils/musicSdk/wy/songList.js'
import txLeaderboard from '@/vendor/lxmusic/renderer/utils/musicSdk/tx/leaderboard.js'
import txSongList from '@/vendor/lxmusic/renderer/utils/musicSdk/tx/songList.js'
import kwLeaderboard from '@/vendor/lxmusic/renderer/utils/musicSdk/kw/leaderboard.js'
import kwSongList from '@/vendor/lxmusic/renderer/utils/musicSdk/kw/songList.js'
import kgLeaderboard from '@/vendor/lxmusic/renderer/utils/musicSdk/kg/leaderboard.js'
import kgSongList from '@/vendor/lxmusic/renderer/utils/musicSdk/kg/songList.js'
import { createHttpFetch as createKugouHttpFetch } from '@/vendor/lxmusic/renderer/utils/musicSdk/kg/util.js'
import mgLeaderboard from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/leaderboard.js'
import mgSongList from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/songList.js'

interface VendorToplistResult {
  list: any[]
  source?: string
}

interface VendorPlaylistResult {
  list: any[]
  page?: number
  limit?: number
  total?: number
  source?: string
  info?: {
    name?: string
    img?: string
    cover?: string
    desc?: string
    author?: string
    play_count?: number | string
  }
}

interface VendorPlaylistTagItem {
  parent_id?: string | number
  parent_name?: string
  id: string | number
  name: string
  source?: string
}

interface VendorPlaylistTagGroup {
  name: string
  list: VendorPlaylistTagItem[]
}

interface VendorPlaylistTagResult {
  tags: VendorPlaylistTagGroup[]
  hotTag: VendorPlaylistTagItem[]
  source?: string
}

interface Provider {
  leaderboard: {
    getBoards: () => Promise<VendorToplistResult>
    getList: (id: string, page?: number) => Promise<VendorPlaylistResult>
  }
  songList: {
    sortList?: Array<{ id: string | number; name: string }>
    getList: (sortId: string | number, tagId: string, page: number) => Promise<VendorPlaylistResult>
    getListDetail: (id: string, page: number) => Promise<VendorPlaylistResult>
    getTags?: () => Promise<VendorPlaylistTagResult>
  }
  defaultSortId: string | number
}

interface KugouAlbumInfo {
  album_id?: string | number
  sizable_cover?: string
  cover?: string
}

const PROVIDERS: Record<Platform, Provider> = {
  netease: {
    leaderboard: wyLeaderboard,
    songList: wySongList,
    defaultSortId: wySongList.sortList?.[0]?.id ?? 'hot',
  },
  qq: {
    leaderboard: txLeaderboard,
    songList: txSongList,
    defaultSortId: txSongList.sortList?.[0]?.id ?? 5,
  },
  kuwo: {
    leaderboard: kwLeaderboard,
    songList: kwSongList,
    defaultSortId: kwSongList.sortList?.find((item: any) => item.id === 'hot')?.id ?? kwSongList.sortList?.[0]?.id ?? 'hot',
  },
  kugou: {
    leaderboard: kgLeaderboard,
    songList: kgSongList,
    defaultSortId: kgSongList.sortList?.[0]?.id ?? '5',
  },
  migu: {
    leaderboard: mgLeaderboard,
    songList: mgSongList,
    defaultSortId: mgSongList.sortList?.[0]?.id ?? '15127315',
  },
}

const KUGOU_ALBUM_INFO_URL = 'http://kmrserviceretry.kugou.com/container/v1/album?dfid=1tT5He3kxrNC4D29ad1MMb6F&mid=22945702112173152889429073101964063697&userid=0&appid=1005&clientver=11589'
const KUGOU_ALBUM_INFO_FIELDS = 'language,grade_count,intro,mix_intro,heat,category,sizable_cover,cover,album_name,type,quality,publish_company,grade,special_tag,author_name,publish_date,language_id,album_id,exclusive,is_publish,trans_param,authors,album_tag'
const kugouAlbumCoverCache = new Map<string, string | null>()
const toplistCoverMapCache = new Map<Platform, Promise<Map<string, string>>>()

const mapPlatformToLxSource = (platform: Platform): 'wy' | 'tx' | 'kw' | 'kg' | 'mg' => {
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
  }
}

const parseDuration = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0
  const parts = value.split(':').map((item) => Number(item))
  if (!parts.length || parts.some((item) => Number.isNaN(item))) return 0
  return parts.reduce((acc, current) => acc * 60 + current, 0)
}

const parsePlayCount = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0
  const normalized = value.trim()
  if (!normalized) return 0
  const numeric = parseFloat(normalized)
  if (Number.isNaN(numeric)) return 0
  if (normalized.includes('亿')) return numeric * 100000000
  if (normalized.includes('万')) return numeric * 10000
  return numeric
}

const normalizeCover = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  const sized = normalized.includes('{size}') ? normalized.replace(/{size}/g, '240') : normalized
  if (sized.startsWith('//')) return `https:${sized}`
  return sized
}

const pickCover = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const cover = normalizeCover(value)
    if (cover) return cover
  }
  return undefined
}

const rememberSongs = (songs: Song[]) => {
  songRegistry.rememberSongs(songs)
  return songs
}

const dedupeSongs = (songs: Song[]) => {
  const seen = new Set<string>()
  return songs.filter((song) => {
    const key = `${song.platform}:${song.id}:${song.lx?.hash || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const chunkArray = <T>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const runWithConcurrency = async<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (!items.length) return []

  const results = new Array<R>(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async() => {
    while (cursor < items.length) {
      const currentIndex = cursor
      cursor += 1
      results[currentIndex] = await worker(items[currentIndex])
    }
  })

  await Promise.all(runners)
  return results
}

const normalizeVendorSong = (platform: Platform, item: any): Song => {
  const songId = String(item.songmid ?? item.id ?? item.songId ?? item.hash ?? item.copyrightId ?? '')
  const interval = typeof item.interval === 'string' ? item.interval : undefined
  const cover = pickCover(
    item.img,
    item.cover,
    item.coverImgUrl,
    item.pic,
    item.image,
    item.imgUrl,
    item.albumImg,
    item.album_img,
  )
  const albumId = item.albumId != null ? String(item.albumId) : undefined
  const songRealId = item.songId != null ? String(item.songId) : undefined

  return {
    id: songId,
    name: item.name || '',
    artist: item.singer || '',
    album: item.albumName || '',
    albumId,
    duration: parseDuration(item.interval),
    cover,
    platform,
    lx: {
      source: mapPlatformToLxSource(platform),
      songmid: songId || undefined,
      interval,
      img: cover,
      albumId,
      albumMid: item.albumMid != null ? String(item.albumMid) : undefined,
      songId: songRealId,
      strMediaMid: item.strMediaMid,
      hash: item.hash,
      copyrightId: item.copyrightId != null ? String(item.copyrightId) : undefined,
      lrcUrl: item.lrcUrl,
      mrcUrl: item.mrcUrl,
      trcUrl: item.trcUrl,
      albumName: item.albumName || '',
      types: Array.isArray(item.types) ? item.types : [],
      _types: item._types || {},
    },
  }
}

const normalizeToplist = (platform: Platform, item: any): Toplist => ({
  id: String(item.bangid ?? item.id ?? ''),
  name: item.name || '',
  description: item.description || item.desc,
  cover: pickCover(item.img, item.cover, item.coverImgUrl, item.pic, item.icon),
  updateTime: item.updateTime,
  platform,
})

const normalizeRecommendPlaylist = (platform: Platform, item: any): RecommendPlaylist => ({
  id: String(item.id ?? ''),
  name: item.name || '',
  cover: pickCover(item.img, item.cover, item.coverImgUrl, item.pic, item.image) || '',
  playCount: parsePlayCount(item.play_count || item.playCount),
  description: item.desc || item.description || '',
  platform,
})

const normalizePlaylistSortOption = (item: { id: string | number; name: string }): PlaylistSortOption => ({
  id: String(item.id),
  name: item.name,
})

const normalizePlaylistTagItem = (platform: Platform, item: VendorPlaylistTagItem): PlaylistTagItem => ({
  id: String(item.id ?? ''),
  name: item.name || '',
  parentId: item.parent_id == null ? undefined : String(item.parent_id),
  parentName: item.parent_name,
  platform,
})

const normalizePlaylistTagGroup = (platform: Platform, group: VendorPlaylistTagGroup): PlaylistTagGroup => ({
  name: group.name || '',
  list: (group.list || [])
    .map((item) => normalizePlaylistTagItem(platform, item))
    .filter((item) => item.id && item.name),
})

const normalizePlaylistTags = (platform: Platform, result: VendorPlaylistTagResult): PlaylistTagInfo => ({
  hotTag: (result.hotTag || [])
    .map((item) => normalizePlaylistTagItem(platform, item))
    .filter((item) => item.id && item.name),
  tags: (result.tags || [])
    .map((group) => normalizePlaylistTagGroup(platform, group))
    .filter((group) => group.name && group.list.length > 0),
  platform,
})

const normalizeOnlineSongs = (songs: Song[]): OnlinePlaylistSong[] => songs.map((song) => ({
  id: song.id,
  name: song.name,
  artist: song.artist,
  album: song.album,
  duration: song.duration,
  cover: song.cover,
  url: song.url,
  platform: song.platform as Platform,
  types: song.lx?.types?.map((item) => item.type) || [],
}))

const loadAllPages = async(
  loader: (id: string, page: number) => Promise<VendorPlaylistResult>,
  id: string,
): Promise<VendorPlaylistResult> => {
  const firstPage = await loader(id, 1)
  const total = Number(firstPage.total || firstPage.list?.length || 0)
  const limit = Number(firstPage.limit || firstPage.list?.length || 0)

  if (!total || !limit || total <= (firstPage.list?.length || 0) || limit >= total) {
    return firstPage
  }

  const totalPages = Math.min(20, Math.ceil(total / limit))
  if (totalPages <= 1) return firstPage

  const restPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      loader(id, index + 2).catch(() => null)
    )
  )

  return {
    ...firstPage,
    list: [
      ...(firstPage.list || []),
      ...restPages.flatMap((page) => page?.list || []),
    ],
  }
}

const loadKugouAlbumCoverBatch = async(albumIds: string[]): Promise<void> => {
  const targetIds = [...new Set(albumIds.filter(Boolean))].filter((albumId) => !kugouAlbumCoverCache.has(albumId))
  if (!targetIds.length) return

  const chunks = chunkArray(targetIds, 20)
  await runWithConcurrency(chunks, 3, async(chunk) => {
    try {
      const response = await createKugouHttpFetch(KUGOU_ALBUM_INFO_URL, {
        method: 'POST',
        body: {
          appid: 1005,
          clienttime: 1681833686,
          clientver: 11589,
          data: chunk.map((albumId) => ({ album_id: albumId })),
          fields: KUGOU_ALBUM_INFO_FIELDS,
          isBuy: 0,
          key: 'e6f3306ff7e2afb494e89fbbda0becbf',
          mid: '22945702112173152889429073101964063697',
          show_album_tag: 0,
        },
      })

      const items = (Array.isArray(response) ? response : [response]) as KugouAlbumInfo[]
      for (const item of items) {
        const albumId = item?.album_id != null ? String(item.album_id) : ''
        if (!albumId) continue
        kugouAlbumCoverCache.set(albumId, pickCover(item.sizable_cover, item.cover) ?? null)
      }
    } catch {
      // ignore, keep empty cache fallback below
    }

    for (const albumId of chunk) {
      if (!kugouAlbumCoverCache.has(albumId)) {
        kugouAlbumCoverCache.set(albumId, null)
      }
    }
  })
}

const enrichSongCovers = async(platform: Platform, songs: Song[]): Promise<Song[]> => {
  if (platform !== 'kugou') return songs

  const missingAlbumIds = [...new Set(
    songs
      .filter((song) => !song.cover && song.albumId)
      .map((song) => song.albumId as string)
  )]

  if (!missingAlbumIds.length) return songs

  await loadKugouAlbumCoverBatch(missingAlbumIds)

  return songs.map((song) => {
    if (song.cover || !song.albumId) return song

    const cover = kugouAlbumCoverCache.get(song.albumId) ?? undefined
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
  })
}

const flattenMiguRankItems = (items: any[] = []): any[] => items.flatMap((item) => {
  if (!item) return []
  if (item.rankId) return [item]
  if (Array.isArray(item.contents)) return flattenMiguRankItems(item.contents)
  if (Array.isArray(item.itemList)) return flattenMiguRankItems(item.itemList)
  return []
})

const loadOfficialToplistCoverMap = async(platform: Platform, provider: Provider): Promise<Map<string, string>> => {
  const cached = toplistCoverMapCache.get(platform)
  if (cached) return cached

  const task = (async() => {
    const coverMap = new Map<string, string>()

    try {
      switch (platform) {
        case 'netease': {
          const response = await (provider.leaderboard as any).getBoardsData?.()
          const list = response?.body?.list || []
          for (const item of list) {
            const id = String(item?.id ?? '')
            const cover = pickCover(item?.coverImgUrl, item?.coverUrl, item?.img)
            if (id && cover) coverMap.set(id, cover)
          }
          break
        }
        case 'qq': {
          const response = await (provider.leaderboard as any).getBoardsData?.()
          const rawList = response?.body?.data?.topList || response?.body?.topList?.data?.group || []
          const list = Array.isArray(rawList)
            ? rawList.some((item: any) => Array.isArray(item?.toplist))
              ? rawList.flatMap((group: any) => group?.toplist || [])
              : rawList
            : []
          for (const item of list) {
            const id = String(item?.id ?? item?.topId ?? '')
            const cover = pickCover(item?.picUrl, item?.headPicUrl, item?.frontPicUrl, item?.mbHeadPicUrl, item?.mbFrontPicUrl, item?.logoImgURL)
            if (id && cover) coverMap.set(id, cover)
          }
          break
        }
        case 'kuwo': {
          const response = await (provider.leaderboard as any).getBoardsData?.()
          const list = response?.body?.child || []
          for (const item of list) {
            if (String(item?.source) != '1') continue
            const id = String(item?.sourceid ?? '')
            const cover = pickCover(item?.pic)
            if (id && cover) coverMap.set(id, cover)
          }
          break
        }
        case 'kugou': {
          const response = await (provider.leaderboard as any).getBoardsData?.()
          const list = response?.body?.data?.info || []
          for (const item of list) {
            if (item?.isvol != 1) continue
            const id = String(item?.rankid ?? '')
            const cover = pickCover(item?.img_9, item?.img_cover, item?.imgurl, item?.banner_9, item?.banner7url, item?.bannerurl, item?.base_img)
            if (id && cover) coverMap.set(id, cover)
          }
          break
        }
        case 'migu': {
          const response = await (provider.leaderboard as any).getBoardsData?.()
          const list = flattenMiguRankItems(response?.body?.data?.contents || [])
          for (const item of list) {
            const id = String(item?.rankId ?? '')
            const cover = pickCover(item?.imageUrl, item?.img, item?.cover)
            if (id && cover) coverMap.set(id, cover)
          }
          break
        }
      }
    } catch {
      return coverMap
    }

    return coverMap
  })()

  toplistCoverMapCache.set(platform, task)
  return task
}

class OfficialMusicApi {
  getPlaylistSorts(platform: Platform): PlaylistSortOption[] {
    const provider = PROVIDERS[platform]
    return (provider.songList.sortList || []).map((item) => normalizePlaylistSortOption(item))
  }

  async getPlaylistTags(platform: Platform): Promise<PlaylistTagInfo> {
    const provider = PROVIDERS[platform]
    if (!provider.songList.getTags) {
      return {
        hotTag: [],
        tags: [],
        platform,
      }
    }

    return normalizePlaylistTags(platform, await provider.songList.getTags())
  }

  async getToplists(platform: Platform): Promise<Toplist[]> {
    const provider = PROVIDERS[platform]
    const result = await provider.leaderboard.getBoards()
    const toplists = (result.list || []).map((item) => normalizeToplist(platform, item))
    const officialCoverMap = await loadOfficialToplistCoverMap(platform, provider)

    return toplists.map((toplist) => {
      const officialCover = officialCoverMap.get(toplist.id)
      return officialCover ? { ...toplist, cover: officialCover } : toplist
    })
  }

  async getToplistSongs(platform: Platform, id: string): Promise<Song[]> {
    const provider = PROVIDERS[platform]
    const result = await loadAllPages((targetId, page) => provider.leaderboard.getList(targetId, page), id)
    const songs = await enrichSongCovers(
      platform,
      dedupeSongs((result.list || []).map((item) => normalizeVendorSong(platform, item)))
    )
    return rememberSongs(songs)
  }

  async getRecommendPlaylistPage(
    platform: Platform,
    page: number,
    options?: { sortId?: string; tagId?: string },
  ): Promise<RecommendPlaylistPage> {
    const provider = PROVIDERS[platform]
    const sortId = options?.sortId || provider.defaultSortId
    const tagId = options?.tagId || ''
    const result = await provider.songList.getList(sortId, tagId, page)
    const playlists = (result.list || []).map((item) => normalizeRecommendPlaylist(platform, item))
    const currentPage = Number(result.page || page)
    const limit = Number(result.limit || playlists.length || 0)
    const hasTotal = Number.isFinite(Number(result.total)) && Number(result.total) > 0
    const total = hasTotal ? Number(result.total) : (limit ? currentPage * limit : playlists.length)

    return {
      playlists,
      total,
      page: currentPage,
      limit,
      hasMore: hasTotal && limit > 0
        ? currentPage * limit < total
        : limit > 0 && playlists.length >= limit,
    }
  }

  async getRecommendPlaylists(
    platform: Platform,
    page: number,
    options?: { sortId?: string; tagId?: string },
  ): Promise<RecommendPlaylist[]> {
    return (await this.getRecommendPlaylistPage(platform, page, options)).playlists
  }

  async getPlaylistDetail(platform: Platform, id: string): Promise<PlaylistDetail | null> {
    const provider = PROVIDERS[platform]
    const result = await loadAllPages(provider.songList.getListDetail.bind(provider.songList), id)
    const songs = rememberSongs(
      await enrichSongCovers(
        platform,
        dedupeSongs((result.list || []).map((item) => normalizeVendorSong(platform, item)))
      )
    )

    return {
      id,
      name: result.info?.name || '未知歌单',
      description: result.info?.desc || '',
      cover: pickCover(result.info?.img, result.info?.cover) || songs[0]?.cover || '',
      author: result.info?.author || '',
      playCount: parsePlayCount(result.info?.play_count),
      songs,
      platform,
    }
  }

  async getToplistSongsPage(platform: Platform, id: string, page: number): Promise<PaginatedSongsResult> {
    const provider = PROVIDERS[platform]
    const result = await provider.leaderboard.getList(id, page)
    const songs = await enrichSongCovers(
      platform,
      dedupeSongs((result.list || []).map((item) => normalizeVendorSong(platform, item)))
    )
    const remembered = rememberSongs(songs)
    const total = Number(result.total || 0)
    const limit = Number(result.limit || result.list?.length || 0)
    const currentPage = Number(result.page || page)
    const hasMore = total > 0 && limit > 0 ? currentPage * limit < total : songs.length > 0

    return {
      songs: remembered,
      total,
      page: currentPage,
      limit,
      hasMore,
    }
  }

  async getPlaylistDetailPage(platform: Platform, id: string, page: number): Promise<PaginatedSongsResult> {
    const provider = PROVIDERS[platform]
    const result = await provider.songList.getListDetail(id, page)
    const songs = rememberSongs(
      await enrichSongCovers(
        platform,
        dedupeSongs((result.list || []).map((item) => normalizeVendorSong(platform, item)))
      )
    )
    const total = Number(result.total || 0)
    const limit = Number(result.limit || result.list?.length || 0)
    const currentPage = Number(result.page || page)
    const hasMore = total > 0 && limit > 0 ? currentPage * limit < total : songs.length > 0

    const info: PlaylistDetail = {
      id,
      name: result.info?.name || '未知歌单',
      description: result.info?.desc || '',
      cover: pickCover(result.info?.img, result.info?.cover) || songs[0]?.cover || '',
      author: result.info?.author || '',
      playCount: parsePlayCount(result.info?.play_count),
      songs: [],
      platform,
    }

    return {
      songs,
      total,
      page: currentPage,
      limit,
      hasMore,
      info,
    }
  }

  async getOnlinePlaylist(platform: Platform, id: string): Promise<OnlinePlaylist | null> {
    const detail = await this.getPlaylistDetail(platform, id)
    if (!detail) return null

    return {
      id: `online_${platform}_${id}`,
      sourceId: id,
      source: platform,
      name: detail.name,
      description: detail.description,
      author: detail.author,
      cover: detail.cover,
      songs: normalizeOnlineSongs(detail.songs),
      songCount: detail.songs.length,
      importedAt: new Date().toISOString(),
      externalType: 'playlist',
    }
  }
}

export const officialMusicApi = new OfficialMusicApi()
export default officialMusicApi
