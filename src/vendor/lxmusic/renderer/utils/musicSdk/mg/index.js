// Migu (mg) platform facade, mirrors lx-music-desktop's mg/index.js.

import leaderboard from './leaderboard'
import songList from './songList'
import musicSearch from './musicSearch'
import lyric from './lyric'
import album from './album'
import comment from './comment'
import { apis } from '../api-source'

const mg = {
  songList,
  musicSearch,
  leaderboard,
  album,
  comment,

  getMusicUrl(songInfo, type) {
    return apis('mg').getMusicUrl(songInfo, type)
  },

  getLyric(songInfo) {
    return lyric.getLyric(songInfo)
  },

  getMusicDetailPageUrl(songInfo) {
    return `http://music.migu.cn/v3/music/song/${songInfo.copyrightId}`
  },
}

export default mg
