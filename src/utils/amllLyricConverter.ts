import type { LyricData } from '@/types'
import { parseLrc, parseYrc } from '@applemusic-like-lyrics/lyric'
import type { LyricLine as AmllLyricLine, LyricWord as AmllLyricWord } from '@applemusic-like-lyrics/lyric'

// LX format: [mm:ss.ms]<offset_ms,duration_ms>text
const LX_LINE_REGEX = /^\s*(\[\d{1,3}(?::\d{1,3}){0,2}(?:\.\d{1,3})?\])\s*((?:<-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?)?>[^<]*)+)\s*$/
const LX_WORD_REGEX = /<(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,-?\d+(?:\.\d+)?)?>([^<]*)/g
const TIME_TAG_REGEX = /\[(\d{1,3}(?::\d{1,3}){0,2}(?:\.\d{1,3})?)\]/g
const META_TAG_REGEX = /^\[(?:ti|ar|al|by|offset):[^\]]*\]$/i
const YRC_LINE_REGEX = /^\[\d+,\d+\]/

const parseTimeToMs = (timeStr: string): number => {
  const parts = timeStr.split(':').map(Number)
  if (parts.some(isNaN)) return 0
  return Math.round(parts.reduce((acc, cur) => acc * 60 + cur, 0) * 1000)
}

const parseLxLine = (line: string): AmllLyricLine | null => {
  const match = line.match(LX_LINE_REGEX)
  if (!match) return null

  const lineTimeStr = match[1].slice(1, -1) // strip [ and ]
  const lineStartMs = parseTimeToMs(lineTimeStr)
  const wordPart = match[2]

  const words: AmllLyricWord[] = []
  let wordMatch: RegExpExecArray | null
  const regex = new RegExp(LX_WORD_REGEX)

  while ((wordMatch = regex.exec(wordPart)) !== null) {
    const offset = Math.round(Number(wordMatch[1]))
    const duration = Math.round(Number(wordMatch[2]))
    const text = wordMatch[3]
    if (!text) continue

    const wordStart = lineStartMs + offset
    const wordEnd = wordStart + duration
    words.push({ word: text, startTime: wordStart, endTime: wordEnd })
  }

  if (words.length === 0) return null

  const lineEndMs = words[words.length - 1].endTime
  return {
    words,
    translatedLyric: '',
    romanLyric: '',
    startTime: lineStartMs,
    endTime: lineEndMs,
    isBG: false,
    isDuet: false,
  }
}

const parseLxLyric = (lxlyric: string): AmllLyricLine[] => {
  const lines = lxlyric.split(/\r?\n/).filter((l) => l.trim())
  const result: AmllLyricLine[] = []

  for (const line of lines) {
    if (META_TAG_REGEX.test(line)) continue
    const parsed = parseLxLine(line)
    if (parsed) result.push(parsed)
  }

  // Sort and fix overlapping end times
  result.sort((a, b) => a.startTime - b.startTime)
  for (let i = 0; i < result.length - 1; i++) {
    if (result[i].endTime > result[i + 1].startTime) {
      result[i].endTime = result[i + 1].startTime
      const lastWord = result[i].words[result[i].words.length - 1]
      if (lastWord.endTime > result[i + 1].startTime) {
        lastWord.endTime = result[i + 1].startTime
      }
    }
  }

  return result
}

const isLxFormat = (lyric: string): boolean => {
  return lyric.split(/\r?\n/).some((line) => LX_LINE_REGEX.test(line.trim()))
}

const isYrcFormat = (lyric: string): boolean => {
  return lyric.split(/\r?\n/).some((line) => YRC_LINE_REGEX.test(line.trim()))
}

/**
 * Build a time→text map from LRC for merging translations/romanizations.
 * Returns a sorted array of [timeMs, text] entries.
 */
const buildLrcTimeMap = (lrc: string): Map<number, string> => {
  const map = new Map<number, string>()
  const lines = lrc.split(/\r?\n/).filter((l) => l.trim())

  for (const line of lines) {
    if (META_TAG_REGEX.test(line)) continue
    const timeTags: number[] = []
    let match: RegExpExecArray | null
    const regex = new RegExp(TIME_TAG_REGEX)
    while ((match = regex.exec(line)) !== null) {
      timeTags.push(parseTimeToMs(match[1]))
    }
    const text = line.replace(TIME_TAG_REGEX, '').trim()
    if (text && timeTags.length > 0) {
      for (const t of timeTags) {
        map.set(t, text)
      }
    }
  }

  return map
}

/**
 * Merge translation LRC into AmllLyricLine[] by matching timestamps.
 */
const mergeTranslation = (lines: AmllLyricLine[], tlyric: string): void => {
  if (!tlyric) return
  const transMap = buildLrcTimeMap(tlyric)
  if (transMap.size === 0) return

  for (const line of lines) {
    // Find the closest translation within 500ms
    let bestTime = -1
    let bestDist = 500
    for (const [t] of transMap) {
      const dist = Math.abs(t - line.startTime)
      if (dist < bestDist) {
        bestDist = dist
        bestTime = t
      }
    }
    if (bestTime >= 0) {
      line.translatedLyric = transMap.get(bestTime) || ''
    }
  }
}

/**
 * Merge romanization LRC into AmllLyricLine[] by matching timestamps.
 */
const mergeRomanization = (lines: AmllLyricLine[], rlyric: string): void => {
  if (!rlyric) return
  const romanMap = buildLrcTimeMap(rlyric)
  if (romanMap.size === 0) return

  for (const line of lines) {
    let bestTime = -1
    let bestDist = 500
    for (const [t] of romanMap) {
      const dist = Math.abs(t - line.startTime)
      if (dist < bestDist) {
        bestDist = dist
        bestTime = t
      }
    }
    if (bestTime >= 0) {
      line.romanLyric = romanMap.get(bestTime) || ''
    }
  }
}

/**
 * Convert Sollin's LyricData to AMLL's LyricLine[] format.
 * Priority: lxlyric (word-by-word) > lyric (LRC) > lyrics fallback.
 * Merges tlyric (translation) and rlyric (romanization).
 */
export const convertSollinLyricsToAmll = (
  lyricData: LyricData | null,
  lyrics: string | null
): AmllLyricLine[] => {
  let result: AmllLyricLine[] = []

  // Try lxlyric first (word-by-word LX format)
  if (lyricData?.lxlyric && isLxFormat(lyricData.lxlyric)) {
    result = parseLxLyric(lyricData.lxlyric)
  }

  // Try lyric field (may be LRC or YRC)
  if (result.length === 0 && lyricData?.lyric) {
    const lyric = lyricData.lyric.trim()
    if (lyric) {
      try {
        if (isYrcFormat(lyric)) {
          result = parseYrc(lyric)
        } else {
          result = parseLrc(lyric)
        }
      } catch {
        // parse failed, try next
      }
    }
  }

  // Fallback to raw lyrics string
  if (result.length === 0 && lyrics) {
    const lrc = lyrics.trim()
    if (lrc) {
      try {
        if (isYrcFormat(lrc)) {
          result = parseYrc(lrc)
        } else {
          result = parseLrc(lrc)
        }
      } catch {
        // parse failed
      }
    }
  }

  // Merge translations and romanizations
  if (result.length > 0) {
    if (lyricData?.tlyric) mergeTranslation(result, lyricData.tlyric)
    if (lyricData?.rlyric) mergeRomanization(result, lyricData.rlyric)
  }

  return result
}
