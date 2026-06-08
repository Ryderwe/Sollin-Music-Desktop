// QQ Music (tx) platform facade, mirrors lx-music-desktop's tx/index.js.

import leaderboard from './leaderboard'
import lyric from './lyric'
import songList from './songList'
import musicSearch from './musicSearch'
import comment from './comment'
import { apis } from '../api-source'

const tx = {
  leaderboard,
  songList,
  musicSearch,
  comment,

  getMusicUrl(songInfo, type) {
    return apis('tx').getMusicUrl(songInfo, type)
  },

  getLyric(songInfo) {
    return lyric.getLyric(songInfo)
  },

  getPic(songInfo) {
    return Promise.resolve(`https://y.gtimg.cn/music/photo_new/T002R500x500M000${songInfo.albumId}.jpg`)
  },

  getMusicDetailPageUrl(songInfo) {
    return `https://y.qq.com/n/yqq/song/${songInfo.songmid}.html`
  },
}

export default tx
