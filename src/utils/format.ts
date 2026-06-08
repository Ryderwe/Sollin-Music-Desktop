import type { LyricData, LyricWord } from '@/types'

// Format time in seconds to mm:ss
export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'

  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Format duration to human readable
export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0分钟'

  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}小时${mins}分钟`
  }
  return `${mins}分钟`
}

// Format number with commas
export function formatNumber(num: number): string {
  if (num >= 100000000) {
    return (num / 100000000).toFixed(1) + '亿'
  }
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + '万'
  }
  return num.toLocaleString()
}

// Format date
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days}天前`
  if (days < 30) return `${Math.floor(days / 7)}周前`
  if (days < 365) return `${Math.floor(days / 30)}个月前`

  return date.toLocaleDateString('zh-CN')
}

// Get platform display name
export function getPlatformName(platform: string): string {
  const names: Record<string, string> = {
    netease: '小芸音乐',
    qq: '小秋音乐',
    kuwo: '小蜗音乐',
    kugou: '小枸音乐',
    migu: '小蜜音乐',
    local: '本地',
  }
  return names[platform] || platform
}

// Get platform color
export function getPlatformColor(platform: string): string {
  const colors: Record<string, string> = {
    netease: '#e60026',
    qq: '#31c27c',
    kuwo: '#ff6600',
    kugou: '#2ca2f9',
    migu: '#ff5d5d',
    local: '#8b5cf6',
  }
  return colors[platform] || '#666666'
}

export interface LyricLine {
  time: number
  text: string
  translation?: string
  roman?: string
  duration?: number
  words?: LyricWord[]
}

const standardTimeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g
const karaokeLineRegex = /^\[(\d+),(\d+)\]/
const karaokeCharRegex = /\((\d+),(\d+),\d+\)([^()]*)/g
const lxWordRegex = /<(-?\d+),(-?\d+)>([^<]*)/g
const chineseRegex = /[\u4e00-\u9fff]/
const MERGE_TOLERANCE = 0.12
const DEFAULT_INLINE_WORD_DURATION = 0.4
const MAX_INLINE_WORD_EXTENSION = 8
const ttmlTagRegex = /<tt[\s>]/i

const isSecondaryLyricPlaceholder = (text: string | undefined): boolean => {
  if (!text) return false
  const normalized = text.replace(/\s/g, '')
  return normalized === '//' || normalized === '／／'
}

const parseTimestamp = (match: RegExpExecArray): number => {
  const mins = parseInt(match[1], 10)
  const secs = parseInt(match[2], 10)
  const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0
  return mins * 60 + secs + ms / 1000
}

const formatPreciseLrcTimestamp = (time: number): string => {
  const timestampMs = Math.max(0, Math.round((Number.isFinite(time) ? time : 0) * 1000))
  const mins = Math.floor(timestampMs / 60000)
  const secs = Math.floor((timestampMs % 60000) / 1000)
  const ms = timestampMs % 1000
  return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}]`
}

type InlineTimestampSegment = {
  time: number
  text: string
  nextTime?: number
}

const parseInlineTimestampSegments = (line: string): InlineTimestampSegment[] => {
  const matches = [...line.matchAll(standardTimeRegex)]
  if (matches.length < 2) return []

  return matches.map((match, index) => {
    const startIndex = (match.index ?? 0) + match[0].length
    const endIndex = index + 1 < matches.length
      ? (matches[index + 1].index ?? line.length)
      : line.length
    const nextMatch = matches[index + 1]

    return {
      time: parseTimestamp(match as RegExpExecArray),
      text: line.slice(startIndex, endIndex),
      nextTime: nextMatch ? parseTimestamp(nextMatch as RegExpExecArray) : undefined,
    }
  })
}

const hasInlineWordSegments = (segments: InlineTimestampSegment[]): boolean => {
  const firstMeaningfulIndex = segments.findIndex((segment) => segment.text.trim().length > 0)
  return firstMeaningfulIndex === 0 && segments[0]?.nextTime != null
}

const renderPlainInlineWordLine = (segments: InlineTimestampSegment[]): string | null => {
  if (!hasInlineWordSegments(segments)) return null

  const firstMeaningfulSegment = segments.find((segment) => segment.text.trim())
  if (!firstMeaningfulSegment) return null

  const text = segments
    .filter((segment) => segment.text.length > 0)
    .map((segment) => segment.text)
    .join('')
    .trim()

  return text ? `${formatPreciseLrcTimestamp(firstMeaningfulSegment.time)}${text}` : null
}

const renderLxInlineWordLine = (segments: InlineTimestampSegment[]): string | null => {
  if (!hasInlineWordSegments(segments)) return null

  const textSegments = segments.filter((segment) => segment.text.length > 0)
  const firstMeaningfulSegment = textSegments.find((segment) => segment.text.trim())
  if (!firstMeaningfulSegment) return null

  const baseTime = firstMeaningfulSegment.time
  const words = textSegments
    .map((segment) => {
      const duration = segment.nextTime != null && segment.nextTime > segment.time
        ? segment.nextTime - segment.time
        : DEFAULT_INLINE_WORD_DURATION

      if (!segment.text.trim() && duration <= 0) return ''

      const offsetMs = Math.max(0, Math.round((segment.time - baseTime) * 1000))
      const durationMs = Math.max(0, Math.round(duration * 1000))
      return `<${offsetMs},${durationMs}>${segment.text}`
    })
    .join('')

  return words ? `${formatPreciseLrcTimestamp(baseTime)}${words}` : null
}

export const convertInlineWordLrcToPlainLrc = (lrc: string | null | undefined): string => {
  if (!lrc) return ''

  return lrc
    .split(/\r\n|\r|\n/)
    .map((rawLine) => {
      const line = rawLine.trim()
      if (!line) return ''

      const plainLine = renderPlainInlineWordLine(parseInlineTimestampSegments(line))
      return plainLine || line
    })
    .filter(Boolean)
    .join('\n')
}

export const convertInlineWordLrcToLxLyric = (lrc: string | null | undefined): string => {
  if (!lrc) return ''

  return lrc
    .split(/\r\n|\r|\n/)
    .map((rawLine) => renderLxInlineWordLine(parseInlineTimestampSegments(rawLine.trim())))
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

export const buildPlaybackLyricData = (lrc: string | null | undefined): LyricData | null => {
  const rawLyric = lrc?.trim()
  if (!rawLyric) return null

  const lxlyric = convertInlineWordLrcToLxLyric(rawLyric)
  if (!lxlyric) return { lyric: rawLyric }

  return {
    lyric: convertInlineWordLrcToPlainLrc(rawLyric) || rawLyric,
    lxlyric,
  }
}

const parseLxWords = (content: string, baseTime: number): LyricWord[] => {
  const words: LyricWord[] = []
  let wordMatch: RegExpExecArray | null
  const regex = new RegExp(lxWordRegex)
  while ((wordMatch = regex.exec(content)) !== null) {
    const offset = Number(wordMatch[1] || 0)
    const duration = Number(wordMatch[2] || 0)
    const text = wordMatch[3] || ''
    if (!text) continue
    const startTime = Math.max(baseTime + offset / 1000, baseTime)
    const endTime = Math.max(startTime + duration / 1000, startTime)
    words.push({ startTime, endTime, text })
  }
  return words
}

const isTtmlLyric = (value: string): boolean => {
  if (!value) return false
  return ttmlTagRegex.test(value)
}

const parseTtmlTime = (value: string | null | undefined): number | null => {
  if (!value) return null

  const normalized = value.trim()
  if (!normalized) return null

  if (/^\d+(?:\.\d+)?ms$/i.test(normalized)) {
    return Number.parseFloat(normalized) / 1000
  }

  if (/^\d+(?:\.\d+)?s$/i.test(normalized)) {
    return Number.parseFloat(normalized)
  }

  if (/^\d+(?:\.\d+)?m$/i.test(normalized)) {
    return Number.parseFloat(normalized) * 60
  }

  if (/^\d+(?:\.\d+)?h$/i.test(normalized)) {
    return Number.parseFloat(normalized) * 3600
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return Number.parseFloat(normalized)
  }

  if (normalized.includes(':')) {
    const parts = normalized.split(':').map((item) => Number.parseFloat(item))
    if (!parts.length || parts.some((item) => Number.isNaN(item))) return null
    return parts.reduce((acc, current) => acc * 60 + current, 0)
  }

  return null
}

const parseTtmlTrack = (ttml: string, allowWords: boolean): LyricLine[] => {
  if (!ttml || typeof DOMParser === 'undefined') return []

  try {
    const doc = new DOMParser().parseFromString(ttml, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return []

    const paragraphs = Array.from(doc.getElementsByTagNameNS('*', 'p'))

    const rawLines: Array<LyricLine | null> = paragraphs.map((paragraph): LyricLine | null => {
      const lineBegin = parseTtmlTime(paragraph.getAttribute('begin'))
      const lineEnd = parseTtmlTime(paragraph.getAttribute('end'))
      const spans = Array.from(paragraph.getElementsByTagNameNS('*', 'span'))

      const words = spans
        .map((span) => {
          const text = (span.textContent || '').replace(/[\r\n\t]/g, '')
          if (!text.length) return null

          const startTime = parseTtmlTime(span.getAttribute('begin')) ?? lineBegin
          const endTime = parseTtmlTime(span.getAttribute('end')) ?? lineEnd ?? startTime
          if (startTime == null) return null

          return {
            startTime,
            endTime: endTime != null ? Math.max(endTime, startTime) : startTime,
            text,
          }
        })
        .filter((word): word is LyricWord => Boolean(word))

      const text = words.length
        ? words.map((word) => word.text).join('')
        : (paragraph.textContent || '').replace(/[\r\n\t]/g, '')

      const normalizedText = text.trim()
      if (!normalizedText) return null

      const time = lineBegin ?? words.find((word) => word.text.trim())?.startTime ?? words[0]?.startTime
      if (time == null) return null

      const finalEndTime = lineEnd
        ?? words[words.length - 1]?.endTime
        ?? time

      return {
        time,
        text: normalizedText,
        duration: Math.max(finalEndTime - time, 0),
        words: allowWords && words.length ? words : undefined,
      }
    })

    const lines = rawLines.filter((line): line is LyricLine => line !== null)

    lines.sort((left, right) => left.time - right.time)
    return finalizeTimedWordLines(lines)
  } catch {
    return []
  }
}

const parseInlineTimestampLine = (line: string, allowWords: boolean): LyricLine | null => {
  const matches = [...line.matchAll(standardTimeRegex)]
  if (matches.length < 2) return null

  const segments = matches.map((match, index) => {
    const startIndex = (match.index ?? 0) + match[0].length
    const endIndex = index + 1 < matches.length
      ? (matches[index + 1].index ?? line.length)
      : line.length

    return {
      time: parseTimestamp(match as RegExpExecArray),
      text: line.slice(startIndex, endIndex),
    }
  })

  const timedTextSegments = segments.filter((segment) => segment.text.length > 0)
  const firstMeaningfulIndex = segments.findIndex((segment) => segment.text.trim().length > 0)
  if (firstMeaningfulIndex !== 0 || segments[0]?.time == null || segments[1]?.time == null) return null

  const text = timedTextSegments.map((segment) => segment.text).join('').trim()
  if (!text) return null

  const words = timedTextSegments.map((segment, index) => {
    const nextTime = timedTextSegments[index + 1]?.time
    const endTime = nextTime && nextTime > segment.time ? nextTime : segment.time

    return {
      startTime: segment.time,
      endTime,
      text: segment.text,
    }
  })

  return {
    time: timedTextSegments[0].time,
    text,
    duration: words.length > 1
      ? Math.max(words[words.length - 1].startTime - timedTextSegments[0].time, 0)
      : undefined,
    words: allowWords ? words : undefined,
  }
}

const finalizeTimedWordLines = (lines: LyricLine[]): LyricLine[] => {
  return lines.map((line, index) => {
    if (!line.words?.length) return line

    const words = line.words.map((word) => ({ ...word }))
    let fallbackDuration = DEFAULT_INLINE_WORD_DURATION

    if (words.length > 1) {
      const durations: number[] = []

      for (let wordIndex = 0; wordIndex < words.length - 1; wordIndex += 1) {
        const nextWord = words[wordIndex + 1]
        const duration = nextWord.startTime - words[wordIndex].startTime
        if (duration > 0) {
          durations.push(duration)
          words[wordIndex].endTime = Math.max(words[wordIndex].endTime, nextWord.startTime)
        }
      }

      if (durations.length > 0) {
        fallbackDuration = durations.reduce((sum, value) => sum + value, 0) / durations.length
      }
    }

    const lastWord = words[words.length - 1]
    const nextLine = lines.slice(index + 1).find((candidate) => candidate.time > line.time)
    const canExtendToNextLine = nextLine
      && nextLine.time > lastWord.startTime
      && nextLine.time - lastWord.startTime <= MAX_INLINE_WORD_EXTENSION

    lastWord.endTime = canExtendToNextLine
      ? Math.max(lastWord.endTime, nextLine.time)
      : Math.max(lastWord.endTime, lastWord.startTime + fallbackDuration)

    return {
      ...line,
      text: line.text || words.map((word) => word.text).join('').trim(),
      duration: Math.max(lastWord.endTime - line.time, 0),
      words,
    }
  })
}

const mergeDuplicateTranslations = (lines: LyricLine[]): LyricLine[] => {
  const merged: LyricLine[] = []

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]
    const next = lines[i + 1]

    if (next && Math.abs(current.time - next.time) < MERGE_TOLERANCE) {
      const currentIsPlaceholder = isSecondaryLyricPlaceholder(current.text)
      const nextIsPlaceholder = isSecondaryLyricPlaceholder(next.text)

      if (currentIsPlaceholder || nextIsPlaceholder) {
        if (currentIsPlaceholder && !nextIsPlaceholder) {
          merged.push(next)
          i++
          continue
        }

        if (!currentIsPlaceholder && nextIsPlaceholder) {
          merged.push(current)
          i++
          continue
        }
      }

      const currentIsChinese = chineseRegex.test(current.text)
      const nextIsChinese = chineseRegex.test(next.text)

      if (currentIsChinese !== nextIsChinese) {
        const originalText = currentIsChinese ? next.text : current.text
        const translationText = currentIsChinese ? current.text : next.text

        merged.push({
          ...current,
          text: originalText,
          translation: translationText,
          duration: current.duration || next.duration,
          words: currentIsChinese ? next.words : current.words,
        })
        i++
        continue
      }
    }

    merged.push(current)
  }

  return merged
}

const parseLyricTrack = (lrc: string, allowWords: boolean = false): LyricLine[] => {
  if (!lrc) return []

  const lines = lrc.split('\n')
  const result: LyricLine[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const karaokeMatch = line.match(karaokeLineRegex)
    if (karaokeMatch) {
      const startMs = parseInt(karaokeMatch[1], 10)
      const durationMs = parseInt(karaokeMatch[2], 10)
      const restOfLine = line.slice(karaokeMatch[0].length)
      let text = ''
      const words: LyricWord[] = []
      let charMatch: RegExpExecArray | null
      const regex = new RegExp(karaokeCharRegex)
      while ((charMatch = regex.exec(restOfLine)) !== null) {
        const offset = Number(charMatch[1] || 0)
        const charDuration = Number(charMatch[2] || 0)
        const charText = charMatch[3] || ''
        text += charText
        if (charText) {
          const startTime = startMs / 1000 + offset / 1000
          const endTime = startTime + charDuration / 1000
          words.push({ startTime, endTime, text: charText })
        }
      }

      if (text.trim()) {
        result.push({
          time: startMs / 1000,
          text: text.trim(),
          duration: durationMs / 1000,
          words: allowWords && words.length ? words : undefined,
        })
      }
      continue
    }

    const inlineTimestampLine = parseInlineTimestampLine(line, allowWords)
    if (inlineTimestampLine) {
      result.push(inlineTimestampLine)
      continue
    }

    const matches = [...line.matchAll(standardTimeRegex)]
    if (!matches.length) continue

    const content = line.replace(standardTimeRegex, '').trim()
    if (!content) continue

    for (const match of matches) {
      const time = parseTimestamp(match as RegExpExecArray)
      const words = allowWords ? parseLxWords(content, time) : []
      const plainText = words.length ? words.map((word) => word.text).join('').trim() : content.replace(lxWordRegex, '$3').trim()
      if (!plainText) continue
      result.push({
        time,
        text: plainText,
        duration: words.length ? Math.max(words[words.length - 1].endTime - time, 0) : undefined,
        words: words.length ? words : undefined,
      })
    }
  }

  result.sort((a, b) => a.time - b.time)
  return finalizeTimedWordLines(result)
}

const parseAnyLyricTrack = (content: string, allowWords: boolean): LyricLine[] => {
  if (isTtmlLyric(content)) {
    return parseTtmlTrack(content, allowWords)
  }

  return parseLyricTrack(content, allowWords)
}

const attachSecondaryTrack = (
  baseLines: LyricLine[],
  secondary: LyricLine[],
  targetKey: 'translation' | 'roman',
): LyricLine[] => {
  if (!secondary.length) return baseLines

  return baseLines.map((line) => {
    const match = secondary.find((item) => Math.abs(item.time - line.time) < MERGE_TOLERANCE)
    if (!match?.text || isSecondaryLyricPlaceholder(match.text)) return line
    return {
      ...line,
      [targetKey]: match.text,
    }
  })
}

export function parseLyrics(lrc: string): LyricLine[] {
  return mergeDuplicateTranslations(parseAnyLyricTrack(lrc, true))
}

export function parseRichLyrics(
  lyricData: LyricData | null | undefined,
  options?: {
    showTranslation?: boolean
    showRoman?: boolean
    preferWordByWord?: boolean
  },
): LyricLine[] {
  if (!lyricData) return []

  const preferWordByWord = options?.preferWordByWord !== false
  const baseTrack = preferWordByWord
    ? parseAnyLyricTrack(lyricData.lxlyric || lyricData.lyric || '', true)
    : parseAnyLyricTrack(lyricData.lyric || '', false)

  let lines = baseTrack.length
    ? [...baseTrack]
    : parseAnyLyricTrack(lyricData.lyric || '', false)

  if (!lines.length) return []

  if (!lyricData.tlyric) {
    lines = mergeDuplicateTranslations(lines)
  }

  if (options?.showTranslation !== false && lyricData.tlyric) {
    lines = attachSecondaryTrack(lines, parseAnyLyricTrack(lyricData.tlyric, false), 'translation')
  }

  if (options?.showRoman !== false && lyricData.rlyric) {
    lines = attachSecondaryTrack(lines, parseAnyLyricTrack(lyricData.rlyric, false), 'roman')
  }

  return lines
}

// Find current lyric index based on time
export function findCurrentLyricIndex(lyrics: LyricLine[], currentTime: number): number {
  if (!lyrics.length) return -1

  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (currentTime >= lyrics[i].time) {
      return i
    }
  }

  return -1
}

// Debounce function
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Throttle function
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number,
): (...args: Parameters<T>) => void {
  let inThrottle = false

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}
