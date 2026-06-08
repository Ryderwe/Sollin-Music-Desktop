// Kugou (kg) platform facade, mirrors lx-music-desktop's kg/index.js.

import leaderboard from './leaderboard'
import songList from './songList'
import musicSearch from './musicSearch'
import lyric from './lyric'
import album from './album'
import comment from './comment'
import { apis } from '../api-source'

const kg = {
  leaderboard,
  songList,
  musicSearch,
  album,
  comment,

  getMusicUrl(songInfo, type) {
    return apis('kg').getMusicUrl(songInfo, type)
  },

  getLyric(songInfo) {
    return lyric.getLyric(songInfo)
  },

  getMusicDetailPageUrl(songInfo) {
    return `https://www.kugou.com/song/#hash=${songInfo.hash}&album_id=${songInfo.albumId}`
  },
}

export default kg
