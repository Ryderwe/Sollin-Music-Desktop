// Aggregator for the vendored music SDK, mirrors lx-music-desktop's musicSdk/index.js.
// Exposes per-platform facades plus findMusic (cross-platform name matching used by the
// playback pipeline to locate replacement sources when the active source cannot resolve a URL).

import kw from './kw/index'
import kg from './kg/index'
import tx from './tx/index'
import wy from './wy/index'
import mg from './mg/index'
import { supportQuality } from './api-source'

const sources = {
  sources: [
    { name: '酷我音乐', id: 'kw' },
    { name: '酷狗音乐', id: 'kg' },
    { name: 'QQ音乐', id: 'tx' },
    { name: '网易音乐', id: 'wy' },
    { name: '咪咕音乐', id: 'mg' },
  ],
  kw,
  kg,
  tx,
  wy,
  mg,
}

// --- findMusic: cross-platform name matching --------------------------------
// Replicates lx-music-desktop's musicSdk.findMusic (src/renderer/utils/musicSdk/index.js),
// but tightened so short-name / version-variant / missing-duration cases stop producing
// wildly wrong replacements.

const SINGERS_SPLIT_RX = /、|&|;|；|\/|,|，|\|/
const FILTER_STR_RX = /\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[|!|！/g
// Common version markers we want aligned between origin and candidate.  If one side has the
// marker and the other does not, they are almost certainly different recordings even when the
// visible title string looks identical.
const VERSION_MARKER_PATTERNS = [
  { key: 'live', regex: /(live|演唱会|现场版?)/i },
  { key: 'remix', regex: /(remix|混音|remixed)/i },
  { key: 'cover', regex: /(翻自|翻唱|cover)/i },
  { key: 'acoustic', regex: /(acoustic|原声|unplugged)/i },
  { key: 'instrumental', regex: /(instrumental|伴奏|karaoke|纯音乐)/i },
  { key: 'piano', regex: /(piano\s?version|钢琴版)/i },
  { key: 'dj', regex: /(dj版|dj\s?mix)/i },
  { key: 'demo', regex: /(demo)/i },
  { key: 'remaster', regex: /(remaster(ed)?|重制)/i },
]
// When title+artist is this short, require a strict equality check to avoid "I" matching "I
// believe" et al.  Short titles are where fuzzy includes fail the most.
const SHORT_NAME_THRESHOLD = 3
// We treat the interval comparison as strict when the origin actually declared a duration.
// Without a duration we cannot use time as a filter, so we fall back to the tightest matching
// branch only (exact name + exact singer).
const INTERVAL_TOLERANCE_SECONDS = 5

const trimStr = (str) => (typeof str === 'string' ? str.trim() : (str || ''))

const filterStr = (str) => (
  typeof str === 'string'
    ? str.replace(FILTER_STR_RX, '')
    : String(str || '')
)

const sortSingle = (singer) => (
  SINGERS_SPLIT_RX.test(singer)
    ? singer.split(SINGERS_SPLIT_RX).sort((a, b) => a.localeCompare(b)).join('、')
    : (singer || '')
)

const getIntv = (interval) => {
  if (!interval) return 0
  const parts = String(interval).split(':')
  let value = 0
  let unit = 1
  while (parts.length) {
    value += parseInt(parts.pop(), 10) * unit
    unit *= 60
  }
  return Number.isFinite(value) ? value : 0
}

const getVersionMarkers = (text) => {
  if (!text) return new Set()
  const lower = String(text).toLowerCase()
  const matches = new Set()
  for (const marker of VERSION_MARKER_PATTERNS) {
    if (marker.regex.test(lower)) matches.add(marker.key)
  }
  return matches
}

const areVersionMarkersCompatible = (originMarkers, candidateMarkers) => {
  if (originMarkers.size === candidateMarkers.size) {
    for (const marker of originMarkers) {
      if (!candidateMarkers.has(marker)) return false
    }
    return true
  }
  // Differing marker sets mean "Live" vs studio, "Remix" vs original, etc.  Always reject.
  return false
}

const removeScratchFields = (item) => {
  delete item.fSinger
  delete item.fMusicName
  delete item.fAlbumName
  delete item.fInterval
  delete item.fMarkers
}

const pickMatching = (arr, predicate) => {
  const result = []
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i]
    if (predicate(item)) {
      removeScratchFields(item)
      result.push(item)
      arr.splice(i, 1)
    }
  }
  result.reverse()
  return result
}

const isIntervalWithinTolerance = (target, intv) => (
  Math.abs((target || intv) - (intv || target)) < INTERVAL_TOLERANCE_SECONDS
)

const searchOnePlatform = async (platformSdk, keyword, limit) => {
  if (!platformSdk?.musicSearch?.search) return null
  try {
    const result = await platformSdk.musicSearch.search(keyword, 1, limit)
    if (!result) return null
    if (Array.isArray(result)) return { list: result, source: platformSdk.musicSearch.source }
    if (Array.isArray(result.list)) return result
    return null
  } catch (error) {
    console.warn('[findMusic] search failed:', error)
    return null
  }
}

const searchAllPlatforms = async ({ name, singer, source, limit }) => {
  const keyword = `${name} ${singer || ''}`.trim()
  const tasks = []
  for (const info of sources.sources) {
    if (info.id === source) continue
    const sdk = sources[info.id]
    tasks.push(searchOnePlatform(sdk, keyword, limit))
  }
  const settled = await Promise.all(tasks)
  return settled.filter(Boolean)
}

export const findMusic = async ({ name, singer, albumName, interval, source }) => {
  const lists = await searchAllPlatforms({ name, singer, source, limit: 25 })

  const fMusicName = filterStr(name).toLowerCase()
  const fSinger = filterStr(sortSingle(singer)).toLowerCase()
  const fAlbumName = filterStr(albumName).toLowerCase()
  const fInterval = getIntv(interval)
  const originMarkers = getVersionMarkers(`${name || ''} ${albumName || ''}`)
  // When the origin is missing critical signals, we force strict matching to avoid wild guesses.
  const hasIntervalSignal = fInterval > 0
  const hasSingerSignal = Boolean(fSinger)
  const isShortName = fMusicName.length > 0 && fMusicName.length <= SHORT_NAME_THRESHOLD
  const strictMode = isShortName || !hasIntervalSignal || !hasSingerSignal

  const isIncludesName = (n) => (fMusicName.includes(n) || n.includes(fMusicName))
  const isIncludesSinger = (s) => fSinger ? (fSinger.includes(s) || s.includes(fSinger)) : true

  // A shared predicate chain ensures every candidate still earns its place; the rest of the
  // per-platform loop below just selects which predicate wins first.
  const passesVersionCheck = (item) => areVersionMarkersCompatible(originMarkers, item.fMarkers)
  const passesIntervalCheck = (item) => (
    hasIntervalSignal
      ? isIntervalWithinTolerance(fInterval, item.fInterval)
      : item.fInterval > 0 // the candidate at least has a real duration
  )

  const primary = lists.map((bucket) => {
    const list = bucket.list || []
    for (const item of list) {
      item.name = trimStr(item.name)
      item.singer = trimStr(item.singer)
      item.fSinger = filterStr(sortSingle(item.singer).toLowerCase())
      item.fMusicName = filterStr(String(item.name ?? '').toLowerCase())
      item.fAlbumName = filterStr(String(item.albumName ?? '').toLowerCase())
      item.fInterval = getIntv(item.interval)
      item.fMarkers = getVersionMarkers(`${item.name || ''} ${item.albumName || ''}`)

      if (!passesVersionCheck(item)) {
        item.name = null
        continue
      }
      if (!passesIntervalCheck(item)) {
        item.name = null
        continue
      }

      // Level 1 (strict) - exact name + singer containment.  This branch always qualifies.
      if (item.fMusicName === fMusicName && (strictMode ? item.fSinger === fSinger : isIncludesSinger(item.fSinger))) {
        return item
      }
    }

    if (strictMode) return null

    // Level 2 - exact singer + name containment.  Skipped for short / incomplete origins
    // because `includes` routinely mis-maps.
    for (const item of list) {
      if (item.name == null) continue
      if (item.fSinger === fSinger && isIncludesName(item.fMusicName)) return item
    }

    // Level 3 - album + singer + name containment.  Album must be a real match when present.
    for (const item of list) {
      if (item.name == null) continue
      if (fAlbumName && item.fAlbumName === fAlbumName && isIncludesSinger(item.fSinger) && isIncludesName(item.fMusicName)) {
        return item
      }
    }

    return null
  }).filter(Boolean)

  const ranked = []
  if (primary.length) {
    ranked.push(...pickMatching(primary, (item) => item.fSinger === fSinger && item.fMusicName === fMusicName && item.interval === interval))
    ranked.push(...pickMatching(primary, (item) => item.fMusicName === fMusicName && item.fSinger === fSinger && item.fAlbumName === fAlbumName))
    ranked.push(...pickMatching(primary, (item) => item.fSinger === fSinger && item.fMusicName === fMusicName))
    ranked.push(...pickMatching(primary, (item) => item.fMusicName === fMusicName && item.interval === interval))
    ranked.push(...pickMatching(primary, (item) => item.fSinger === fSinger && item.interval === interval))
    ranked.push(...pickMatching(primary, (item) => item.fMusicName === fMusicName))
    ranked.push(...pickMatching(primary, (item) => item.fSinger === fSinger))
    for (const item of primary) removeScratchFields(item)
    ranked.push(...primary)
  }
  return ranked
}

export default {
  ...sources,
  supportQuality,
  findMusic,
}
