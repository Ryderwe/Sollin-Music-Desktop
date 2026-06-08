import type { LyricData } from '@/types'
import type { LyricsLine, LyricsResult } from './types'

const formatTimestamp = (ms: number) => {
  const safeMs = Math.max(0, Math.round(ms))
  const minutes = Math.floor(safeMs / 60000)
  const seconds = Math.floor((safeMs % 60000) / 1000)
  const millis = safeMs % 1000
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}]`
}

const buildHeaderLines = (tags: Record<string, string>) => {
  const result: string[] = []
  const allowed = ['ti', 'ar', 'al', 'by', 'offset', 'length']
  for (const key of allowed) {
    const value = tags[key]
    if (value) result.push(`[${key}:${value}]`)
  }
  return result
}

const renderPlainLine = (line: LyricsLine) => {
  const text = line.words.map((word) => word.text).join('')
  return `${formatTimestamp(line.start)}${text}`
}

const renderLxLine = (line: LyricsLine) => {
  if (!line.words.length) return `${formatTimestamp(line.start)}`
  if (line.words.length === 1) {
    const word = line.words[0]
    const duration = Math.max(0, word.end - word.start)
    return `${formatTimestamp(line.start)}<0,${duration}>${word.text}`
  }

  const baseTime = line.start
  const segments = line.words.map((word) => {
    const offset = Math.max(0, Math.round(word.start - baseTime))
    const duration = Math.max(0, Math.round(word.end - word.start))
    return `<${offset},${duration}>${word.text}`
  })
  return `${formatTimestamp(line.start)}${segments.join('')}`
}

const renderPlainTrack = (lines: LyricsLine[] | null | undefined, tags: Record<string, string> = {}) => {
  if (!lines || !lines.length) return ''
  const headers = buildHeaderLines(tags)
  const body = lines.map(renderPlainLine).filter(Boolean)
  if (!body.length) return ''
  return [...headers, ...body].join('\n')
}

const renderLxTrack = (lines: LyricsLine[] | null | undefined) => {
  if (!lines || !lines.length) return ''
  return lines.map(renderLxLine).filter(Boolean).join('\n')
}

export const toLyricData = (result: LyricsResult | null | undefined): LyricData | null => {
  if (!result) return null
  const lyric = renderPlainTrack(result.original, result.tags)
  if (!lyric) return null

  const tlyric = renderPlainTrack(result.translated)
  const rlyric = renderPlainTrack(result.romanization)
  const lxlyric = result.isWordByWord ? renderLxTrack(result.original) : ''

  return {
    lyric,
    tlyric: tlyric || '',
    rlyric: rlyric || '',
    lxlyric: lxlyric || '',
  }
}
