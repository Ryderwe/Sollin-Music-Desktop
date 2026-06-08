import type { Album, Platform, PlaylistSummary, SearchResult, Song } from '@/types'
import { songRegistry } from './songRegistry'
import { neteaseAuthApi } from './neteaseAuth'
import { formatTime } from '@/utils/format'
import { httpFetch } from '@/vendor/lxmusic/renderer/utils/request.js'
import { decodeName, sizeFormate } from '@/vendor/lxmusic/renderer/utils/index.js'
import { eapiRequest } from '@/vendor/lxmusic/renderer/utils/musicSdk/wy/utils/index.js'
import wyMusicSearch from '@/vendor/lxmusic/renderer/utils/musicSdk/wy/musicSearch.js'
import wySongList from '@/vendor/lxmusic/renderer/utils/musicSdk/wy/songList.js'
import txMusicSearch from '@/vendor/lxmusic/renderer/utils/musicSdk/tx/musicSearch.js'
import txSongList from '@/vendor/lxmusic/renderer/utils/musicSdk/tx/songList.js'
import kwMusicSearch from '@/vendor/lxmusic/renderer/utils/musicSdk/kw/musicSearch.js'
import kwSongList from '@/vendor/lxmusic/renderer/utils/musicSdk/kw/songList.js'
import kwAlbum from '@/vendor/lxmusic/renderer/utils/musicSdk/kw/album.js'
import { objStr2JSON } from '@/vendor/lxmusic/renderer/utils/musicSdk/kw/util.js'
import kgMusicSearch from '@/vendor/lxmusic/renderer/utils/musicSdk/kg/musicSearch.js'
import kgSongList from '@/vendor/lxmusic/renderer/utils/musicSdk/kg/songList.js'
import kgAlbum from '@/vendor/lxmusic/renderer/utils/musicSdk/kg/album.js'
import { createHttpFetch as createKugouHttpFetch } from '@/vendor/lxmusic/renderer/utils/musicSdk/kg/util.js'
import mgMusicSearch, { createSignature as createMiguSignature } from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/musicSearch.js'
import mgSongList from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/songList.js'
import mgAlbum from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/album.js'
import { createHttpFetch as createMiguHttpFetch } from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/utils/index.js'

export interface AlbumDetailResult extends Album {
  description?: string
  songs: Song[]
}

interface VendorSearchResult {
  list: any[]
  allPage?: number
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

interface AlbumSearchResult {
  albums: Album[]
  hasMore: boolean
  total: number
}

interface PlaylistSearchResult {
  playlists: PlaylistSummary[]
  hasMore: boolean
  total: number
}

const SONG_PROVIDERS = {
  netease: wyMusicSearch,
  qq: txMusicSearch,
  kuwo: kwMusicSearch,
  kugou: kgMusicSearch,
  migu: mgMusicSearch,
} as const

const PLAYLIST_PROVIDERS = {
  netease: wySongList,
  qq: txSongList,
  kuwo: kwSongList,
  kugou: kgSongList,
  migu: mgSongList,
} as const

const KUGOU_ALBUM_INFO_URL = 'http://kmrserviceretry.kugou.com/container/v1/album?dfid=1tT5He3kxrNC4D29ad1MMb6F&mid=22945702112173152889429073101964063697&userid=0&appid=1005&clientver=11589'
const KUGOU_ALBUM_INFO_FIELDS = 'language,grade_count,intro,mix_intro,heat,category,sizable_cover,cover,album_name,type,quality,publish_company,grade,special_tag,author_name,publish_date,language_id,album_id,exclusive,is_publish,trans_param,authors,album_tag'
const kugouAlbumCoverCache = new Map<string, string | null>()

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

const normalizeReleaseDate = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  const timestamp = Date.parse(normalized)
  return Number.isNaN(timestamp) ? normalized : new Date(timestamp).toISOString()
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

      const items = (Array.isArray(response) ? response : [response]) as Array<{ album_id?: string | number; sizable_cover?: string; cover?: string }>
      for (const item of items) {
        const albumId = item?.album_id != null ? String(item.album_id) : ''
        if (!albumId) continue
        kugouAlbumCoverCache.set(albumId, pickCover(item.sizable_cover, item.cover) ?? null)
      }
    } catch {
      // ignore
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

const normalizePlaylistSummary = (platform: Platform, item: any): PlaylistSummary => ({
  id: String(item.id ?? item.playlistid ?? item.specialid ?? item.resourceId ?? ''),
  name: decodeName(item.name || ''),
  creator: decodeName(item.author || item.creator || item.creatorName || ''),
  cover: pickCover(item.img, item.cover, item.coverImgUrl, item.pic, item.image),
  trackCount: typeof item.total === 'number' ? item.total : Number(item.total || item.songnum || item.musicNum || 0) || undefined,
  playCount: parsePlayCount(item.play_count ?? item.playCount ?? item.playcnt ?? item.playcount),
  platform,
})

const normalizeSearchAlbum = (platform: Platform, item: any): Album => {
  switch (platform) {
    case 'netease':
      return {
        id: String(item.id ?? ''),
        name: item.name || '',
        artist: item.artist?.name || item.artists?.map((artist: any) => artist.name).join('、') || '',
        artistId: item.artist?.id != null ? String(item.artist.id) : undefined,
        cover: pickCover(item.picUrl, item.blurPicUrl),
        releaseDate: normalizeReleaseDate(item.publishTime),
        platform,
      }
    case 'qq':
      return {
        id: String(item.albummid ?? item.id ?? ''),
        name: item.name || '',
        artist: item.singer || item.singer_list?.map((artist: any) => artist.name).join('、') || '',
        artistId: item.singer_id != null ? String(item.singer_id) : undefined,
        cover: pickCover(item.pic),
        releaseDate: normalizeReleaseDate(item.publish_date || item.description),
        platform,
      }
    case 'kuwo':
      return {
        id: String(item.albumid ?? item.id ?? ''),
        name: decodeName(item.name || ''),
        artist: decodeName(item.artist || ''),
        artistId: item.artistid != null ? String(item.artistid) : undefined,
        cover: pickCover(item.hts_img, item.img),
        releaseDate: normalizeReleaseDate(item.pub || item.showtime),
        platform,
      }
    case 'kugou':
      return {
        id: String(item.albumid ?? item.id ?? ''),
        name: decodeName(item.albumname || item.name || ''),
        artist: decodeName(item.singername || item.singer || ''),
        artistId: item.singerid != null ? String(item.singerid) : undefined,
        cover: pickCover(item.imgurl),
        releaseDate: normalizeReleaseDate(item.publishtime),
        platform,
      }
    case 'migu':
      return {
        id: String(item.id ?? item.albumId ?? ''),
        name: item.name || '',
        artist: item.singer || item.artist || '',
        cover: pickCover(...(Array.isArray(item.imgItems) ? item.imgItems.map((image: any) => image?.img) : [])),
        releaseDate: normalizeReleaseDate(item.publishDate || item.desc),
        platform,
      }
  }
}

const getHasMore = (page: number, limit: number, total: number, count: number, allPage?: number) => {
  if (typeof allPage === 'number' && allPage > 0) {
    return page < allPage
  }
  if (total > 0) {
    return page * limit < total
  }
  return count >= limit
}

const searchNeteaseAlbums = async(keyword: string, page: number, limit: number): Promise<VendorSearchResult> => {
  const { body } = await eapiRequest('/api/cloudsearch/pc', {
    s: keyword,
    type: 10,
    limit,
    total: page === 1,
    offset: limit * (page - 1),
  }).promise

  if (body?.code !== 200) throw new Error('netease album search failed')

  const result = body.result || {}
  const total = Number(result.albumCount || result.total || 0)
  return {
    list: result.albums || [],
    total,
    limit,
    allPage: limit > 0 ? Math.ceil(total / limit) : 1,
  }
}

const createQqSearchPayload = (searchType: number, keyword: string, page: number, limit: number) => ({
  comm: {
    ct: '11',
    cv: '14090508',
    v: '14090508',
    tmeAppID: 'qqmusic',
    phonetype: 'EBG-AN10',
    deviceScore: '553.47',
    devicelevel: '50',
    newdevicelevel: '20',
    rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
    os_ver: '12',
    OpenUDID: '0',
    OpenUDID2: '0',
    QIMEI36: '0',
    udid: '0',
    chid: '0',
    aid: '0',
    oaid: '0',
    taid: '0',
    tid: '0',
    wid: '0',
    uid: '0',
    sid: '0',
    modeSwitch: '6',
    teenMode: '0',
    ui_mode: '2',
    nettype: '1020',
    v4ip: '',
  },
  req: {
    module: 'music.search.SearchCgiService',
    method: 'DoSearchForQQMusicMobile',
    param: {
      search_type: searchType,
      query: keyword,
      page_num: page,
      num_per_page: limit,
      highlight: 0,
      nqc_flag: 0,
      multi_zhida: 0,
      cat: 2,
      grp: 1,
      sin: 0,
      sem: 0,
    },
  },
})

const searchQqAlbums = async(keyword: string, page: number, limit: number): Promise<VendorSearchResult> => {
  const { body } = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'post',
    headers: {
      'User-Agent': 'QQMusic 14090508(android 12)',
    },
    body: createQqSearchPayload(2, keyword, page, limit),
  } as any).promise

  if (body?.code !== 0 || body?.req?.code !== 0) throw new Error('qq album search failed')

  const result = body.req?.data || {}
  const list = result.body?.item_album || []
  const total = Number(result.meta?.estimate_sum || list.length)
  return {
    list,
    total,
    limit,
    allPage: limit > 0 ? Math.ceil(total / limit) : 1,
  }
}

const searchKuwoAlbums = async(keyword: string, page: number, limit: number): Promise<VendorSearchResult> => {
  const { body } = await httpFetch(`http://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${limit}&rformat=json&encoding=utf8&ver=mbox&vipver=MUSIC_8.7.7.0_BCS37&plat=pc&devid=28156413&ft=album&pay=0&needliveshow=0`).promise
  const result = objStr2JSON(body)
  const total = Number(result.total || result.TOTAL || 0)
  return {
    list: result.albumlist || [],
    total,
    limit,
    allPage: limit > 0 ? Math.ceil(total / limit) : 1,
  }
}

const searchKugouAlbums = async(keyword: string, page: number, limit: number): Promise<VendorSearchResult> => {
  const { body } = await httpFetch(`http://mobilecdnbj.kugou.com/api/v3/search/album?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&showtype=10&plat=2&version=7910&sver=5`).promise
  if (body?.errcode !== 0) throw new Error('kugou album search failed')

  const result = body.data || {}
  const total = Number(result.total || 0)
  return {
    list: result.info || [],
    total,
    limit,
    allPage: limit > 0 ? Math.ceil(total / limit) : 1,
  }
}

const createMiguAlbumSearchUrl = (keyword: string, page: number, limit: number) => {
  const switchValue = encodeURIComponent(JSON.stringify({
    song: 0,
    album: 1,
    singer: 0,
    tagSong: 0,
    mvSong: 0,
    bestShow: 0,
    songlist: 0,
    lyricSong: 0,
  }))
  return `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=1&isCopyright=1&searchSwitch=${switchValue}&pageSize=${limit}&text=${encodeURIComponent(keyword)}&pageNo=${page}&sort=0&sid=USS`
}

const buildQqAlbumSongTypes = (item: any) => {
  const types: Array<{ type: '128k' | '320k' | 'flac' | 'flac24bit'; size?: string }> = []
  const _types: Record<string, { size?: string }> = {}

  const append = (type: '128k' | '320k' | 'flac' | 'flac24bit', size: number | string | undefined) => {
    const numericSize = Number(size || 0)
    if (!numericSize) return
    const formattedSize = sizeFormate(numericSize) || undefined
    types.push({ type, size: formattedSize })
    _types[type] = { size: formattedSize }
  }

  append('128k', item.size128)
  append('320k', item.size320)
  append('flac', item.sizeflac)
  append('flac24bit', item.sizehires)

  return { types, _types }
}

const getQqAlbumDetail = async(id: string): Promise<AlbumDetailResult | null> => {
  const key = /^\d+$/.test(id) ? 'albumid' : 'albummid'
  const { body } = await httpFetch(`https://i.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?${key}=${encodeURIComponent(id)}`).promise
  if (body?.code !== 0 || !body?.data) return null

  const album = body.data
  const cover = pickCover(`https://y.gtimg.cn/music/photo_new/T002R500x500M000${album.mid}.jpg`) || ''
  const songs = rememberSongs((album.list || []).map((item: any) => {
    const { types, _types } = buildQqAlbumSongTypes(item)
    const artist = Array.isArray(item.singer) ? item.singer.map((singer: any) => singer.name).join('、') : album.singername || ''
    const duration = Number(item.interval || 0)

    return {
      id: String(item.songmid),
      name: item.songname || '',
      artist,
      album: album.name || '',
      albumId: String(item.albummid || album.mid || id),
      duration,
      cover,
      platform: 'qq' as const,
      lx: {
        source: 'tx' as const,
        songmid: String(item.songmid),
        songId: item.songid != null ? String(item.songid) : undefined,
        albumId: String(item.albummid || album.mid || id),
        albumMid: String(item.albummid || album.mid || id),
        strMediaMid: item.strMediaMid,
        interval: formatTime(duration),
        albumName: album.name || '',
        img: cover,
        types,
        _types,
      },
    }
  }))

  return {
    id: String(album.mid || id),
    name: album.name || '未知专辑',
    artist: album.singername || songs[0]?.artist || '',
    artistId: album.singermid != null ? String(album.singermid) : undefined,
    cover,
    description: album.desc || '',
    releaseDate: normalizeReleaseDate(album.aDate),
    songs,
    platform: 'qq',
  }
}

const searchMiguAlbums = async(keyword: string, page: number, limit: number): Promise<VendorSearchResult> => {
  const timestamp = Date.now().toString()
  const signature = createMiguSignature(timestamp, keyword)
  const body = await createMiguHttpFetch(createMiguAlbumSearchUrl(keyword, page, limit), {
    headers: {
      uiVersion: 'A_music_3.6.1',
      deviceId: signature.deviceId,
      timestamp,
      sign: signature.sign,
      channel: '0146921',
      'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
    },
  })

  const result = body.albumResultData || { result: [], totalCount: 0 }
  const total = Number(result.totalCount || 0)
  return {
    list: result.result || [],
    total,
    limit,
    allPage: limit > 0 ? Math.ceil(total / limit) : 1,
  }
}

class OfficialSearchApi {
  async searchSongs(platform: Platform, keyword: string, limit: number = 20, page: number = 1): Promise<SearchResult> {
    const provider = SONG_PROVIDERS[platform]
    const result = await provider.search(keyword, page, limit)
    const songs = rememberSongs(
      await enrichSongCovers(
        platform,
        dedupeSongs((result.list || []).map((item: any) => normalizeVendorSong(platform, item)))
      )
    )

    return {
      songs,
      hasMore: getHasMore(page, limit, Number(result.total || 0), songs.length, result.allPage),
      total: Number(result.total || songs.length),
    }
  }

  async searchPlaylists(platform: Platform, keyword: string, limit: number = 20, page: number = 1): Promise<PlaylistSearchResult> {
    const provider = PLAYLIST_PROVIDERS[platform]
    const result = await provider.search(keyword, page, limit)
    const playlists = (result.list || []).map((item: any) => normalizePlaylistSummary(platform, item))

    return {
      playlists,
      hasMore: getHasMore(page, limit, Number(result.total || 0), playlists.length, result.allPage),
      total: Number(result.total || playlists.length),
    }
  }

  async searchAlbums(platform: Platform, keyword: string, limit: number = 20, page: number = 1): Promise<AlbumSearchResult> {
    let result: VendorSearchResult

    switch (platform) {
      case 'netease':
        result = await searchNeteaseAlbums(keyword, page, limit)
        break
      case 'qq':
        result = await searchQqAlbums(keyword, page, limit)
        break
      case 'kuwo':
        result = await searchKuwoAlbums(keyword, page, limit)
        break
      case 'kugou':
        result = await searchKugouAlbums(keyword, page, limit)
        break
      case 'migu':
        result = await searchMiguAlbums(keyword, page, limit)
        break
    }

    const albums = (result.list || []).map((item) => normalizeSearchAlbum(platform, item))

    return {
      albums,
      hasMore: getHasMore(page, limit, Number(result.total || 0), albums.length, result.allPage),
      total: Number(result.total || albums.length),
    }
  }

  private async normalizeVendorAlbumDetail(platform: Exclude<Platform, 'netease' | 'qq'>, id: string, result: VendorSearchResult): Promise<AlbumDetailResult> {
    const songs = rememberSongs(
      await enrichSongCovers(
        platform,
        dedupeSongs((result.list || []).map((item: any) => normalizeVendorSong(platform, item)))
      )
    )

    return {
      id,
      name: result.info?.name || '未知专辑',
      artist: result.info?.author || songs[0]?.artist || '',
      cover: pickCover(result.info?.img, result.info?.cover) || songs[0]?.cover,
      description: result.info?.desc || '',
      releaseDate: undefined,
      songs,
      platform,
    }
  }

  private normalizeNeteaseAlbumDetail(id: string, data: { album: any; songs: Song[] }): AlbumDetailResult {
    const cover = pickCover(data.album?.cover) || ''
    const songs = rememberSongs(data.songs.map((song) => ({
      ...song,
      albumId: song.albumId || id,
      cover: song.cover || cover,
      lx: song.lx || {
        source: 'wy',
        songmid: song.id,
        interval: formatTime(song.duration),
        albumId: song.albumId || id,
        albumName: song.album,
        img: song.cover || cover,
        types: [],
        _types: {},
      },
    })))

    return {
      id,
      name: data.album?.name || '未知专辑',
      artist: data.album?.artist || songs[0]?.artist || '',
      artistId: data.album?.artistId != null ? String(data.album.artistId) : undefined,
      cover,
      description: data.album?.description || '',
      releaseDate: normalizeReleaseDate(data.album?.publishTime),
      songs,
      platform: 'netease',
    }
  }

  async getAlbumDetail(platform: Platform, id: string): Promise<AlbumDetailResult | null> {
    switch (platform) {
      case 'netease': {
        const result = await neteaseAuthApi.getAlbumDetail(id)
        return result ? this.normalizeNeteaseAlbumDetail(id, result) : null
      }
      case 'qq':
        return getQqAlbumDetail(id)
      case 'kuwo': {
        const result = await kwAlbum.getAlbumListDetail(id, 1)
        return this.normalizeVendorAlbumDetail(platform, id, result)
      }
      case 'kugou': {
        const result = await kgAlbum.getAlbumDetail(id, 1)
        return this.normalizeVendorAlbumDetail(platform, id, result)
      }
      case 'migu': {
        const result = await mgAlbum.getAlbumDetail(id, 1)
        return this.normalizeVendorAlbumDetail(platform, id, result)
      }
    }
  }
}

export const officialSearchApi = new OfficialSearchApi()
export default officialSearchApi
