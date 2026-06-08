import type { Song, SongComment, SongCommentPage } from '@/types'
import { formatTime } from '@/utils/format'
import wyComment from '@/vendor/lxmusic/renderer/utils/musicSdk/wy/comment.js'
import txComment from '@/vendor/lxmusic/renderer/utils/musicSdk/tx/comment.js'
import kwComment from '@/vendor/lxmusic/renderer/utils/musicSdk/kw/comment.js'
import kgComment from '@/vendor/lxmusic/renderer/utils/musicSdk/kg/comment.js'
import mgComment from '@/vendor/lxmusic/renderer/utils/musicSdk/mg/comment.js'

type VendorCommentPage = {
  source: 'wy' | 'tx' | 'kw' | 'kg' | 'mg'
  comments: any[]
  total: number
  page: number
  limit: number
  maxPage: number
}

type VendorSongInfo = {
  name: string
  singer: string
  albumName: string
  albumId?: string
  songmid: string
  songId?: string
  albumMid?: string
  strMediaMid?: string
  hash: string
  copyrightId?: string
  lrcUrl?: string
  mrcUrl?: string
  trcUrl?: string
  interval: string
  _interval?: number
  img?: string
  audioId?: string
}

const toVendorSongInfo = (song: Song): VendorSongInfo => ({
  name: song.name,
  singer: song.artist,
  albumName: song.album,
  albumId: song.lx?.albumId || song.albumId,
  songmid: song.lx?.songmid || song.id,
  songId: song.lx?.songId,
  albumMid: song.lx?.albumMid,
  strMediaMid: song.lx?.strMediaMid,
  hash: song.lx?.hash || '',
  copyrightId: song.lx?.copyrightId,
  lrcUrl: song.lx?.lrcUrl,
  mrcUrl: song.lx?.mrcUrl,
  trcUrl: song.lx?.trcUrl,
  interval: song.lx?.interval || formatTime(song.duration),
  _interval: song.duration || undefined,
  img: song.cover || song.lx?.img,
  audioId: song.id,
})

const toTimestamp = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const fromDate = new Date(value).getTime()
    if (Number.isFinite(fromDate) && fromDate > 0) return fromDate
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1000000000000 ? numeric : numeric * 1000
    }
  }
  return undefined
}

const normalizeComment = (item: any): SongComment => ({
  id: String(item?.id ?? ''),
  rootId: item?.rootId != null ? String(item.rootId) : undefined,
  text: String(item?.text || ''),
  time: toTimestamp(item?.time),
  timeStr: typeof item?.timeStr === 'string' ? item.timeStr : undefined,
  location: typeof item?.location === 'string' ? item.location : undefined,
  images: Array.isArray(item?.images) ? item.images.filter((image: unknown) => typeof image === 'string') : undefined,
  likedCount: typeof item?.likedCount === 'number' ? item.likedCount : Number.isFinite(Number(item?.likedCount)) ? Number(item.likedCount) : undefined,
  liked: typeof item?.liked === 'boolean' ? item.liked : undefined,
  replyNum: typeof item?.replyNum === 'number' ? item.replyNum : Number.isFinite(Number(item?.replyNum)) ? Number(item.replyNum) : undefined,
  user: {
    id: item?.userId != null ? String(item.userId) : undefined,
    name: String(item?.userName || '匿名用户'),
    avatar: typeof item?.avatar === 'string' ? item.avatar : undefined,
  },
  reply: Array.isArray(item?.reply) ? item.reply.map(normalizeComment) : undefined,
})

const normalizePage = (page: VendorCommentPage | null | undefined): SongCommentPage => {
  if (!page) {
    return {
      source: 'wy',
      comments: [],
      total: 0,
      page: 1,
      limit: 20,
      maxPage: 1,
    }
  }

  return {
    source: page.source,
    comments: Array.isArray(page.comments) ? page.comments.map(normalizeComment) : [],
    total: Number(page.total || 0),
    page: Number(page.page || 1),
    limit: Number(page.limit || 20),
    maxPage: Number(page.maxPage || 1),
  }
}

export class OfficialCommentApiService {
  async getComments(song: Song, page = 1, limit = 20): Promise<SongCommentPage> {
    const info = toVendorSongInfo(song)

    try {
      switch (song.platform) {
        case 'netease':
          return normalizePage(await wyComment.getComment(info, page, limit) as VendorCommentPage)
        case 'qq':
          return normalizePage(await txComment.getComment(info, page, limit) as VendorCommentPage)
        case 'kuwo':
          return normalizePage(await kwComment.getComment(info, page, limit) as VendorCommentPage)
        case 'kugou':
          return normalizePage(await kgComment.getComment(info, page, limit) as VendorCommentPage)
        case 'migu':
          return normalizePage(await mgComment.getComment(info, page, limit) as VendorCommentPage)
        default:
          return normalizePage(null)
      }
    } catch (error) {
      console.error('[officialCommentApi] getComments error:', error)
      return normalizePage(null)
    }
  }

  async getHotComments(song: Song, page = 1, limit = 20): Promise<SongCommentPage> {
    const info = toVendorSongInfo(song)

    try {
      switch (song.platform) {
        case 'netease':
          return normalizePage(await wyComment.getHotComment(info, page, limit) as VendorCommentPage)
        case 'qq':
          return normalizePage(await txComment.getHotComment(info, page, limit) as VendorCommentPage)
        case 'kuwo':
          return normalizePage(await kwComment.getHotComment(info, page, limit) as VendorCommentPage)
        case 'kugou':
          return normalizePage(await kgComment.getHotComment(info, page, limit) as VendorCommentPage)
        case 'migu':
          return normalizePage(await mgComment.getHotComment(info, page, limit) as VendorCommentPage)
        default:
          return normalizePage(null)
      }
    } catch (error) {
      console.error('[officialCommentApi] getHotComments error:', error)
      return normalizePage(null)
    }
  }
}

export const officialCommentApi = new OfficialCommentApiService()
export default officialCommentApi
