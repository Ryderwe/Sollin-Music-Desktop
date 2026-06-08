import { Buffer } from 'buffer'
import type { LyricsLine, LyricsResult, LyricsWord } from './types'
import { isWordByWord } from './types'

// ---- Common helpers ----

const TAG_PATTERN = /^\[(\w+):([^\]]*)\]$/
const KRC_LINE_PATTERN = /^\[(\d+),(\d+)\](.*)$/
const KRC_WORD_PATTERN = /<(\d+),(\d+),(\d+)>([^<]*)/g

const QRC_XML_PATTERN = /<Lyric_1\s+LyricType="1"\s+LyricContent="([\s\S]*?)"\s*\/>/
const QRC_LINE_PATTERN = /^\[(\d+),(\d+)\](.*)$/
const QRC_WORD_PATTERN = /((?:(?!\(\d+,\d+\)).)*)\((\d+),(\d+)\)/g

const YRC_LINE_PATTERN = /^\[(\d+),(\d+)\](.*)$/
const YRC_WORD_PATTERN = /\((\d+),(\d+),\d+\)([^()]*)/g

const LRC_LINE_PATTERN = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/
const LRC_TIME_TAG_PATTERN = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g

const decodeBase64Utf8 = (text: string): string => {
  try {
    return Buffer.from(text, 'base64').toString('utf-8')
  } catch {
    return ''
  }
}

// ----------------------------------------------------------------------
// Kugou KRC parser (ported from Lyrico KrcParser)
// ----------------------------------------------------------------------

interface KrcLanguageItem {
  type: number
  lyricContent: string[][]
}
interface KrcLanguageRoot {
  content: KrcLanguageItem[]
}

const parseKrcLanguage = (raw: string): KrcLanguageRoot | null => {
  try {
    const json = decodeBase64Utf8(raw)
    if (!json) return null
    return JSON.parse(json) as KrcLanguageRoot
  } catch {
    return null
  }
}

export const parseKrc = (krcText: string): LyricsResult => {
  const tags: Record<string, string> = {}
  const original: LyricsLine[] = []

  for (const rawLine of krcText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('[')) continue

    const tagMatch = TAG_PATTERN.exec(line)
    if (tagMatch) {
      tags[tagMatch[1]] = tagMatch[2] || ''
      continue
    }

    const lineMatch = KRC_LINE_PATTERN.exec(line)
    if (!lineMatch) continue

    const lineStart = Number(lineMatch[1])
    const lineDuration = Number(lineMatch[2])
    const lineEnd = lineStart + lineDuration
    const content = lineMatch[3] ?? ''

    const wordOffsets: Array<{ offset: number; text: string }> = []
    const regex = new RegExp(KRC_WORD_PATTERN.source, 'g')
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      const offset = Number(match[1])
      const text = match[4] ?? ''
      wordOffsets.push({ offset, text })
    }

    const words: LyricsWord[] = []
    for (let i = 0; i < wordOffsets.length; i++) {
      const { offset, text } = wordOffsets[i]
      const wordStart = lineStart + offset
      const wordEnd = i < wordOffsets.length - 1
        ? lineStart + wordOffsets[i + 1].offset
        : lineEnd
      words.push({ start: wordStart, end: wordEnd, text })
    }

    if (!words.length && content) {
      words.push({ start: lineStart, end: lineEnd, text: content })
    }

    original.push({ start: lineStart, end: lineEnd, words })
  }

  let translated: LyricsLine[] | null = null
  let romanization: LyricsLine[] | null = null

  const languageTag = tags.language?.trim()
  if (languageTag) {
    const root = parseKrcLanguage(languageTag)
    if (root) {
      for (const item of root.content) {
        if (item.type === 0) {
          // Romanization, line aligned (skip empty original lines)
          const romaList: LyricsLine[] = []
          let offset = 0
          for (let i = 0; i < original.length; i++) {
            const origLine = original[i]
            const hasText = origLine.words.some((w) => w.text.trim())
            if (!hasText) {
              offset++
              continue
            }
            const contentIndex = i - offset
            const syllables = item.lyricContent?.[contentIndex] ?? []
            const fullLine = syllables.map((s) => s.trim()).filter(Boolean).join(' ')
            if (fullLine) {
              romaList.push({
                start: origLine.start,
                end: origLine.end,
                words: [{ start: origLine.start, end: origLine.end, text: fullLine }],
              })
            } else {
              romaList.push({ start: origLine.start, end: origLine.end, words: [] })
            }
          }
          romanization = romaList
        } else if (item.type === 1) {
          // Translation, line aligned with original
          const transList: LyricsLine[] = []
          for (let i = 0; i < original.length; i++) {
            const origLine = original[i]
            const cells = item.lyricContent?.[i] ?? []
            const text = cells.length ? cells[0] : ''
            if (text) {
              transList.push({
                start: origLine.start,
                end: origLine.end,
                words: [{ start: origLine.start, end: origLine.end, text }],
              })
            } else {
              transList.push({ start: origLine.start, end: origLine.end, words: [] })
            }
          }
          translated = transList
        }
      }
    }
  }

  return {
    tags,
    original,
    translated,
    romanization,
    isWordByWord: isWordByWord(original),
  }
}

// ----------------------------------------------------------------------
// QQ Music QRC parser (ported from Lyrico QrcParser)
// ----------------------------------------------------------------------

const parseQrcFormat = (text: string): LyricsLine[] => {
  if (!text || !text.trim()) return []
  let content = text
  const xmlMatch = QRC_XML_PATTERN.exec(text)
  if (xmlMatch) content = xmlMatch[1] ?? ''

  const result: LyricsLine[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (TAG_PATTERN.test(line)) continue

    const lineMatch = QRC_LINE_PATTERN.exec(line)
    if (!lineMatch) continue

    const lineStart = Number(lineMatch[1])
    const lineDuration = Number(lineMatch[2])
    const lineEnd = lineStart + lineDuration
    const lineContent = lineMatch[3] ?? ''

    const wordList: Array<{ start: number; text: string }> = []
    const regex = new RegExp(QRC_WORD_PATTERN.source, 'g')
    let match: RegExpExecArray | null
    while ((match = regex.exec(lineContent)) !== null) {
      const text = match[1] ?? ''
      const start = Number(match[2])
      wordList.push({ start, text })
    }

    const words: LyricsWord[] = []
    for (let i = 0; i < wordList.length; i++) {
      const { start, text } = wordList[i]
      const end = i < wordList.length - 1 ? wordList[i + 1].start : lineEnd
      words.push({ start, end, text })
    }

    if (!words.length && lineContent) {
      words.push({ start: lineStart, end: lineEnd, text: lineContent })
    }

    result.push({ start: lineStart, end: lineEnd, words })
  }
  return result
}

const parseLrcLineList = (text: string): LyricsLine[] => {
  if (!text || !text.trim()) return []
  const temp: Array<{ start: number; content: string }> = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = LRC_LINE_PATTERN.exec(line)
    if (!match) continue
    const minutes = Number(match[1])
    const seconds = Number(match[2])
    const totalMs = Math.round(minutes * 60 * 1000 + seconds * 1000)
    temp.push({ start: totalMs, content: match[3] ?? '' })
  }
  if (!temp.length) return []
  temp.sort((a, b) => a.start - b.start)

  const lines: LyricsLine[] = []
  for (let i = 0; i < temp.length; i++) {
    const current = temp[i]
    const next = temp[i + 1]
    const end = next ? Math.max(current.start, next.start - 10) : current.start + 2000
    lines.push({
      start: current.start,
      end,
      words: [{ start: current.start, end, text: current.content }],
    })
  }
  return lines
}

const lyricsMerge = (
  original: LyricsLine[],
  secondary: LyricsLine[] | null | undefined,
): LyricsLine[] | null => {
  if (!secondary || !secondary.length) return null
  const sorted = [...secondary].sort((a, b) => a.start - b.start)
  const aligned: LyricsLine[] = []

  let idx = 0
  for (let i = 0; i < original.length; i++) {
    const orig = original[i]
    const winStart = orig.start
    const winEnd = i < original.length - 1 ? original[i + 1].start : Number.MAX_SAFE_INTEGER

    let matched = ''
    while (idx < sorted.length) {
      const trans = sorted[idx]
      if (trans.start < winStart - 500) {
        idx++
        continue
      }
      if (trans.start >= winEnd) break
      matched = trans.words.map((w) => w.text).join('')
      idx++
      break
    }

    aligned.push({
      start: orig.start,
      end: orig.end,
      words: [{ start: orig.start, end: orig.end, text: matched }],
    })
  }
  return aligned
}

export const parseQrc = (
  qrc: string,
  trans: string | undefined | null,
  roma: string | undefined | null,
  tags: Record<string, string> = {},
): LyricsResult => {
  const inferredTags: Record<string, string> = { ...tags }
  for (const rawLine of qrc.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    const tagMatch = TAG_PATTERN.exec(trimmed)
    if (tagMatch) inferredTags[tagMatch[1]] = tagMatch[2] || ''
  }

  const original = parseQrcFormat(qrc)
  const rawTrans = trans ? parseLrcLineList(trans) : null
  const rawRoma = roma ? parseQrcFormat(roma) : null
  const translated = lyricsMerge(original, rawTrans)
  const romanization = lyricsMerge(original, rawRoma)

  return {
    tags: inferredTags,
    original,
    translated,
    romanization,
    isWordByWord: isWordByWord(original),
  }
}

export const parseLrc = (
  lrc: string | null | undefined,
  tlyric: string | null | undefined,
  rlyric: string | null | undefined,
  tags: Record<string, string> = {},
): LyricsResult | null => {
  if (!lrc) return null

  const inferredTags: Record<string, string> = { ...tags }
  for (const rawLine of lrc.split(/\r?\n/)) {
    const tagMatch = TAG_PATTERN.exec(rawLine.trim())
    if (tagMatch) inferredTags[tagMatch[1]] = tagMatch[2] || ''
  }

  const original = parsePlainLrcWithMultipleTimestamps(lrc)
    .slice()
    .sort((a, b) => a.start - b.start)
  if (!original.length) return null

  const translatedRaw = tlyric ? parsePlainLrcWithMultipleTimestamps(tlyric) : null
  const romanizationRaw = rlyric ? parsePlainLrcWithMultipleTimestamps(rlyric) : null

  return {
    tags: inferredTags,
    original,
    translated: lyricsMerge(original, translatedRaw),
    romanization: lyricsMerge(original, romanizationRaw),
    isWordByWord: false,
  }
}

// ----------------------------------------------------------------------
// Netease YRC parser (ported from Lyrico YrcParser)
// ----------------------------------------------------------------------

const parseYrcLineList = (yrc: string): LyricsLine[] => {
  const lines: LyricsLine[] = []
  for (const rawLine of yrc.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const lineMatch = YRC_LINE_PATTERN.exec(line)
    if (!lineMatch) continue
    const lineStart = Number(lineMatch[1])
    const lineDuration = Number(lineMatch[2])
    const lineEnd = lineStart + lineDuration
    const content = lineMatch[3] ?? ''

    const words: LyricsWord[] = []
    const regex = new RegExp(YRC_WORD_PATTERN.source, 'g')
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      const start = Number(match[1])
      const duration = Number(match[2])
      const text = match[3] ?? ''
      words.push({ start, end: start + duration, text })
    }

    if (!words.length && content) {
      words.push({ start: lineStart, end: lineEnd, text: content })
    }

    if (words.length) {
      words.sort((a, b) => a.start - b.start)
      lines.push({ start: lineStart, end: lineEnd, words })
    }
  }
  return lines
}

const parsePlainLrcWithMultipleTimestamps = (lrc: string): LyricsLine[] => {
  const timed: Array<{ start: number; text: string }> = []
  for (const rawLine of lrc.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const matcher = new RegExp(LRC_TIME_TAG_PATTERN.source, 'g')
    const stamps: number[] = []
    let match: RegExpExecArray | null
    let contentStart = 0
    while ((match = matcher.exec(line)) !== null) {
      const min = Number(match[1])
      const sec = Number(match[2])
      const msPart = (match[3] ?? '0').padEnd(3, '0').slice(0, 3)
      const ms = Number(msPart)
      stamps.push(min * 60_000 + sec * 1000 + ms)
      contentStart = matcher.lastIndex
    }
    if (!stamps.length) continue
    const text = line.slice(contentStart).trim()
    for (const stamp of stamps) timed.push({ start: stamp, text })
  }
  timed.sort((a, b) => a.start - b.start)

  const lines: LyricsLine[] = []
  for (let i = 0; i < timed.length; i++) {
    const { start, text } = timed[i]
    if (!text) continue
    const next = timed[i + 1]
    const end = next ? Math.max(start, next.start) : start + 3000
    lines.push({
      start,
      end,
      words: [{ start, end, text }],
    })
  }
  return lines
}

export const parseYrc = (
  yrc: string | null | undefined,
  lrc: string | null | undefined,
  tlyric: string | null | undefined,
  romalrc: string | null | undefined,
): LyricsResult | null => {
  if (!yrc && !lrc) return null

  const original = (yrc ? parseYrcLineList(yrc) : parsePlainLrcWithMultipleTimestamps(lrc!))
    .slice()
    .sort((a, b) => a.start - b.start)

  if (!original.length) return null

  const translatedRaw = tlyric ? parsePlainLrcWithMultipleTimestamps(tlyric) : null
  const romaRaw = romalrc ? parsePlainLrcWithMultipleTimestamps(romalrc) : null

  const translated = lyricsMerge(original, translatedRaw)
  const romanization = lyricsMerge(original, romaRaw)

  return {
    tags: {},
    original,
    translated,
    romanization,
    isWordByWord: Boolean(yrc),
  }
}
