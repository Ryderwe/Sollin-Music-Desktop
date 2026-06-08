// NetEase (wy) platform facade, mirrors lx-music-desktop's wy/index.js.
// Only surfaces modules that exist in the vendored tree.

import leaderboard from './leaderboard'
import lyric from './lyric'
import musicSearch from './musicSearch'
import songList from './songList'
import comment from './comment'
import { apis } from '../api-source'

const wy = {
  leaderboard,
  musicSearch,
  songList,
  comment,

  getMusicUrl(songInfo, type) {
    return apis('wy').getMusicUrl(songInfo, type)
  },

  getLyric(songInfo) {
    return lyric.getLyric(songInfo)
  },

  getMusicDetailPageUrl(songInfo) {
    return `https://music.163.com/#/song?id=${songInfo.songmid}`
  },
}

export default wy
