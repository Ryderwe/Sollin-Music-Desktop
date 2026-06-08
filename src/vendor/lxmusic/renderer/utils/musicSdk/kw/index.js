// Kuwo (kw) platform facade, mirrors lx-music-desktop's kw/index.js.

import musicSearch from './musicSearch'
import leaderboard from './leaderboard'
import lyric from './lyric'
import songList from './songList'
import album from './album'
import comment from './comment'
import { httpFetch } from '../../request'
import { formatSinger } from './util'
import { apis } from '../api-source'

const kw = {
  _musicInfoRequestObj: null,

  musicSearch,
  leaderboard,
  songList,
  album,
  comment,

  getLyric(songInfo, isGetLyricx) {
    return lyric.getLyric(songInfo, isGetLyricx)
  },

  handleMusicInfo(songInfo) {
    return this.getMusicInfo(songInfo).then(info => {
      songInfo.name = info.name
      songInfo.singer = formatSinger(info.artist)
      songInfo.img = info.pic
      songInfo.albumName = info.album
      return songInfo
    })
  },

  getMusicUrl(songInfo, type) {
    return apis('kw').getMusicUrl(songInfo, type)
  },

  getMusicInfo(songInfo) {
    if (this._musicInfoRequestObj) this._musicInfoRequestObj.cancelHttp()
    this._musicInfoRequestObj = httpFetch(`http://www.kuwo.cn/api/www/music/musicInfo?mid=${songInfo.songmid}`)
    return this._musicInfoRequestObj.promise.then(({ body }) => {
      return body.code === 200 ? body.data : Promise.reject(new Error(body.msg))
    })
  },

  getMusicDetailPageUrl(songInfo) {
    return `http://www.kuwo.cn/play_detail/${songInfo.songmid}`
  },
}

export default kw
