import { httpFetch } from '../../request'
import { formatPlayTime, sizeFormate } from '../../index'
import { formatSingerName } from '../utils'

const createMobileSearchBody = (str, page, limit) => ({
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
      search_type: 0,
      query: str,
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

const createDesktopSearchBody = (str, page, limit) => ({
  comm: {
    ct: '19',
    cv: '1859',
    uin: '0',
  },
  req: {
    module: 'music.search.SearchCgiService',
    method: 'DoSearchForQQMusicDesktop',
    param: {
      query: str,
      page_num: page,
      num_per_page: limit,
      search_type: 0,
      grp: 1,
      sin: 0,
      sem: 0,
    },
  },
})

const requestSearch = (body, headers) => {
  const searchRequest = httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'post',
    headers,
    body,
  })
  return searchRequest.promise.then(({ body }) => body)
}

const parseSearchData = (body) => {
  if (body?.code != 0 || body?.req?.code != 0) return null
  return body.req.data || null
}

const getSongList = (body) => {
  if (Array.isArray(body?.item_song)) return body.item_song
  if (Array.isArray(body?.song?.list)) return body.song.list
  return []
}

export default {
  limit: 50,
  total: 0,
  page: 0,
  allPage: 1,
  successCode: 0,
  async musicSearch(str, page, limit, retryNum = 0) {
    if (retryNum > 2) throw new Error('搜索失败')

    const mobileBody = await requestSearch(createMobileSearchBody(str, page, limit), {
      'User-Agent': 'QQMusic 14090508(android 12)',
    }).catch(() => null)
    const mobileData = parseSearchData(mobileBody)
    if (mobileData) return mobileData

    const desktopBody = await requestSearch(createDesktopSearchBody(str, page, limit), {
      referer: 'https://y.qq.com',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    }).catch(() => null)
    const desktopData = parseSearchData(desktopBody)
    if (desktopData) return desktopData

    return this.musicSearch(str, page, limit, retryNum + 1)
  },
  handleResult(rawList) {
    const list = []
    rawList.forEach(item => {
      if (!item.file?.media_mid) return

      let types = []
      let _types = {}
      const file = item.file
      if (file.size_128mp3 != 0) {
        let size = sizeFormate(file.size_128mp3)
        types.push({ type: '128k', size })
        _types['128k'] = {
          size,
        }
      }
      if (file.size_320mp3 !== 0) {
        let size = sizeFormate(file.size_320mp3)
        types.push({ type: '320k', size })
        _types['320k'] = {
          size,
        }
      }
      if (file.size_flac !== 0) {
        let size = sizeFormate(file.size_flac)
        types.push({ type: 'flac', size })
        _types.flac = {
          size,
        }
      }
      if (file.size_hires !== 0) {
        let size = sizeFormate(file.size_hires)
        types.push({ type: 'flac24bit', size })
        _types.flac24bit = {
          size,
        }
      }
      let albumId = ''
      let albumName = ''
      if (item.album) {
        albumName = item.album.name
        albumId = item.album.mid
      }
      list.push({
        singer: formatSingerName(item.singer, 'name'),
        name: item.name + (item.title_extra ?? ''),
        albumName,
        albumId,
        source: 'tx',
        interval: formatPlayTime(item.interval),
        songId: item.id,
        albumMid: item.album?.mid ?? '',
        strMediaMid: item.file.media_mid,
        songmid: item.mid,
        img: (albumId === '' || albumId === '空')
          ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : ''
          : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
        types,
        _types,
        typeUrl: {},
      })
    })
    return list
  },
  search(str, page = 1, limit) {
    if (limit == null) limit = this.limit
    return this.musicSearch(str, page, limit).then(({ body, meta }) => {
      const items = getSongList(body)
      const list = this.handleResult(items)
      const total = Number(meta?.estimate_sum || meta?.sum || body?.song?.totalnum || items.length || 0)

      this.total = total
      this.page = page
      this.allPage = total > 0 ? Math.ceil(total / limit) : 1

      return {
        list,
        allPage: this.allPage,
        limit,
        total: this.total,
        source: 'tx',
      }
    })
  },
}
