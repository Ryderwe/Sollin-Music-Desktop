import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import type { LyricData } from '@/types'
import { convertInlineWordLrcToLxLyric, convertInlineWordLrcToPlainLrc } from '@/utils/format'
import TtmlLyricPlayer from './TtmlLyricPlayer'
import { isTtmlLyric } from './ttmlLyrics'
import Lyric from '@/vendor/lxmusic/common/utils/lyric-font-player/index.js'
import './lxLyricPlayer.css'

type LyricsToneMode = 'dark' | 'light'

export type LyricColorSettings = {
  active: string
  played: string
  unplayed: string
  word: string
  ttmlLeft: string
  ttmlRight: string
  ttmlBackground: string
}

export const DEFAULT_LYRIC_COLORS: Record<LyricsToneMode, LyricColorSettings> = {
  dark: {
    active: '#f8fafc',
    played: '#dbe4f0',
    unplayed: '#7f8ea3',
    word: '#22d3ee',
    ttmlLeft: '#f8fafc',
    ttmlRight: '#f9a8d4',
    ttmlBackground: '#67e8f9',
  },
  light: {
    active: '#0f172a',
    played: '#334155',
    unplayed: '#8a94a6',
    word: '#0284c7',
    ttmlLeft: '#0f172a',
    ttmlRight: '#be185d',
    ttmlBackground: '#0f766e',
  },
}

type RenderLine = {
  text: string
  time: number
  extendedLyrics?: string[]
  dom_line: HTMLElement
}

type LxLyricInstance = {
  pause: () => void
  play: (time: number) => void
  setLyric: (lyric: string, extendedLyrics: string[]) => void
  setPlaybackRate: (rate: number) => void
}

type Props = {
  lyricData: LyricData | null
  lyrics: string | null
  currentTime: number
  isPlaying: boolean
  playbackRate: number
  fontSize: number
  textAlign: 'left' | 'center' | 'right'
  lineSpacing: number
  showWordByWord: boolean
  showRoman: boolean
  showTranslation: boolean
  toneMode: LyricsToneMode
  colors?: LyricColorSettings
  emptyClassName: string
  onSeek: (time: number) => void
  onLineChange?: (text: string, line: number) => void
}

const TIMED_LYRIC_TOKEN = /(?:^\[\d+,\d+\])|(?:\[\d{1,3}(?::\d{1,3}){0,2}(?:\.\d{1,3})?\])|(?:<-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?)?>)/m
const META_TAG_REGEX = /^\[(?:ti|ar|al|by|offset):[^\]]*]$/i
const TIME_TAG_REGEX = /\[(?:\d{1,3}(?::\d{1,3}){0,2}(?:\.\d{1,3})?)\]/g
const HAS_TIME_TAG_REGEX = /\[(?:\d{1,3}(?::\d{1,3}){0,2}(?:\.\d{1,3})?)\]/
const TIME_TAG_CAPTURE_REGEX = /\[(\d{1,3}(?::\d{1,3}){0,2}(?:\.\d{1,3})?)\]/g
const WORD_TAG_REGEX = /<-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?)?>/g
const LX_WORD_LINE_REGEX = /^\s*(?:\[\d{1,3}(?::\d{1,3}){0,2}(?:\.\d{1,3})?\])+\s*<-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?)?>/

type SplitLyricTracks = {
  plainLyric: string
  wordLyric: string
  companionLyric: string
}

type TimedTextLine = {
  line: string
  text: string
  times: number[]
}

const hasLxWordLines = (sourceLyric: string) => {
  return sourceLyric
    .split(/\r?\n/)
    .some((line) => LX_WORD_LINE_REGEX.test(line))
}

const isTimedTextLine = (line: string) => {
  return HAS_TIME_TAG_REGEX.test(line)
}

const stripWordTags = (line: string) => {
  return line.replace(WORD_TAG_REGEX, '')
}

const stripTimedLyricLine = (line: string) => {
  return stripWordTags(line).replace(TIME_TAG_REGEX, '').trim()
}

const parseTimeValueMs = (value: string) => {
  const parts = value.split(':')
  if (!parts.length) return null

  const seconds = parts.reduce((total, part) => {
    const numeric = Number.parseFloat(part)
    return Number.isFinite(numeric) ? total * 60 + numeric : Number.NaN
  }, 0)

  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null
}

const getLineTimesMs = (line: string) => {
  const times: number[] = []
  let match: RegExpExecArray | null
  const regex = new RegExp(TIME_TAG_CAPTURE_REGEX)

  while ((match = regex.exec(line)) !== null) {
    const time = parseTimeValueMs(match[1])
    if (time != null) times.push(time)
  }

  return times
}

const getTimedTextLines = (lyric: string): TimedTextLine[] => {
  return lyric
    .split(/\r\n|\r|\n/)
    .map((rawLine) => rawLine.trim())
    .filter((line) => line && !META_TAG_REGEX.test(line) && isTimedTextLine(line))
    .map((line) => ({
      line,
      text: stripTimedLyricLine(line),
      times: getLineTimesMs(line),
    }))
    .filter((line) => line.text && line.times.length > 0)
}

const normalizeLxWordLine = (line: string) => {
  const convertedLine = convertInlineWordLrcToLxLyric(line)
  if (convertedLine && hasLxWordLines(convertedLine)) return convertedLine
  return LX_WORD_LINE_REGEX.test(line) ? line : ''
}

const normalizePlainWordLine = (line: string) => {
  const convertedLine = convertInlineWordLrcToPlainLrc(line)
  if (convertedLine && convertedLine !== line) return convertedLine
  if (LX_WORD_LINE_REGEX.test(line)) return stripWordTags(line)
  return ''
}

const splitMixedLyricTracks = (sourceLyric: string): SplitLyricTracks | null => {
  if (!sourceLyric || isTtmlLyric(sourceLyric)) return null

  const plainLines: string[] = []
  const wordLines: string[] = []
  const companionLines: string[] = []

  for (const rawLine of sourceLyric.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim()
    if (!line || META_TAG_REGEX.test(line)) continue

    const wordLine = normalizeLxWordLine(line)
    if (wordLine) {
      wordLines.push(wordLine)

      const plainLine = normalizePlainWordLine(line)
      if (plainLine) plainLines.push(plainLine)
      continue
    }

    if (isTimedTextLine(line) && stripTimedLyricLine(line)) {
      companionLines.push(line)
    }
  }

  if (!wordLines.length) return null

  return {
    plainLyric: plainLines.join('\n'),
    wordLyric: wordLines.join('\n'),
    companionLyric: companionLines.join('\n'),
  }
}

const getLyricCandidates = (lyricData: LyricData | null, lyrics: string | null) => {
  const candidates = [lyricData?.lxlyric, lyricData?.lyric, lyrics].filter((value): value is string => Boolean(value?.trim()))
  const seen = new Set<string>()

  return candidates.filter((candidate) => {
    if (seen.has(candidate)) return false
    seen.add(candidate)
    return true
  })
}

const normalizeWordLyric = (sourceLyric: string) => {
  if (!sourceLyric) return ''
  if (isTtmlLyric(sourceLyric)) return sourceLyric

  return splitMixedLyricTracks(sourceLyric)?.wordLyric || ''
}

const buildWordLyric = (lyricData: LyricData | null, lyrics: string | null) => {
  for (const candidate of getLyricCandidates(lyricData, lyrics)) {
    const normalized = normalizeWordLyric(candidate)
    if (isTtmlLyric(normalized) || hasLxWordLines(normalized)) return normalized
  }

  return lyricData?.lyric || lyrics || lyricData?.lxlyric || ''
}

const buildPrimaryTextMap = (primaryLyric: string) => {
  const map = new Map<number, Set<string>>()

  for (const line of getTimedTextLines(primaryLyric)) {
    for (const time of line.times) {
      const texts = map.get(time) ?? new Set<string>()
      texts.add(line.text)
      map.set(time, texts)
    }
  }

  return map
}

const extractCompanionLyricFromPlainTrack = (candidate: string, primaryLyric: string) => {
  const primaryTextMap = buildPrimaryTextMap(primaryLyric)
  if (!primaryTextMap.size) return ''

  return getTimedTextLines(candidate)
    .filter((line) => {
      return line.times.some((time) => {
        const primaryTexts = primaryTextMap.get(time)
        return primaryTexts && !primaryTexts.has(line.text)
      })
    })
    .map((line) => line.line)
    .join('\n')
}

const buildPlainPrimaryLyric = (lyricData: LyricData | null, lyrics: string | null) => {
  for (const candidate of getLyricCandidates(lyricData, lyrics)) {
    const splitTracks = splitMixedLyricTracks(candidate)
    if (splitTracks?.plainLyric) return splitTracks.plainLyric
  }

  const sourceLyric = lyricData?.lyric || lyrics || lyricData?.lxlyric || ''
  if (!sourceLyric) return ''

  return convertInlineWordLrcToPlainLrc(sourceLyric) || sourceLyric
}

const buildPrimaryLyric = (lyricData: LyricData | null, lyrics: string | null, showWordByWord: boolean) => {
  if (showWordByWord) {
    return buildWordLyric(lyricData, lyrics)
  }

  return buildPlainPrimaryLyric(lyricData, lyrics)
}

const buildExtendedLyrics = (
  lyricData: LyricData | null,
  lyrics: string | null,
  showRoman: boolean,
  showTranslation: boolean,
) => {
  const extendedLyrics: string[] = []
  if (showRoman && lyricData?.rlyric) extendedLyrics.push(lyricData.rlyric)
  if (showTranslation) {
    const mixedTranslation = getLyricCandidates(lyricData, lyrics)
      .map((candidate) => splitMixedLyricTracks(candidate)?.companionLyric || '')
      .find((track) => track.trim())
    const primaryPlainLyric = buildPlainPrimaryLyric(lyricData, lyrics)
    const extractedTranslation = getLyricCandidates(lyricData, lyrics)
      .map((candidate) => extractCompanionLyricFromPlainTrack(candidate, primaryPlainLyric))
      .find((track) => track.trim())

    if (lyricData?.tlyric) extendedLyrics.push(lyricData.tlyric)
    else if (mixedTranslation) extendedLyrics.push(mixedTranslation)
    else if (extractedTranslation) extendedLyrics.push(extractedTranslation)
  }
  return extendedLyrics
}

const buildPlainLyrics = (rawLyric: string) => {
  if (!rawLyric.trim()) return []

  return rawLyric
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !META_TAG_REGEX.test(line))
    .map((line) => line.replace(TIME_TAG_REGEX, '').replace(WORD_TAG_REGEX, '').trim())
    .filter(Boolean)
}

export default function LxLyricPlayer({
  lyricData,
  lyrics,
  currentTime,
  isPlaying,
  playbackRate,
  fontSize,
  textAlign,
  lineSpacing,
  showWordByWord,
  showRoman,
  showTranslation,
  toneMode,
  colors,
  emptyClassName,
  onSeek,
  onLineChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const lineElementsRef = useRef<HTMLElement[]>([])
  const lyricRef = useRef<LxLyricInstance | null>(null)
  const syncStateRef = useRef<{
    sourceTime: number | null
    isPlaying: boolean
  }>({
    sourceTime: null,
    isPlaying: false,
  })
  const currentLineRef = useRef(-1)
  const seekRef = useRef(onSeek)
  const lineChangeRef = useRef(onLineChange)
  const [timedLinesState, setTimedLinesState] = useState<'pending' | 'ready' | 'empty'>('empty')
  seekRef.current = onSeek
  lineChangeRef.current = onLineChange

  const primaryLyric = useMemo(
    () => buildPrimaryLyric(lyricData, lyrics, showWordByWord),
    [lyricData, lyrics, showWordByWord],
  )
  const extendedLyrics = useMemo(
    () => buildExtendedLyrics(lyricData, lyrics, showRoman, showTranslation),
    [lyricData, lyrics, showRoman, showTranslation],
  )
  const shouldRenderTtmlLyrics = useMemo(
    () => isTtmlLyric(primaryLyric),
    [primaryLyric],
  )
  const plainLyrics = useMemo(() => buildPlainLyrics(primaryLyric), [primaryLyric])
  const shouldRenderTimedLyrics = useMemo(
    () => shouldRenderTtmlLyrics || TIMED_LYRIC_TOKEN.test(primaryLyric),
    [primaryLyric, shouldRenderTtmlLyrics],
  )

  const scrollToLine = (lineIndex: number, smooth = true) => {
    const container = scrollRef.current
    if (!container) return

    if (lineIndex < 0) {
      container.scrollTo({ top: 0, behavior: 'auto' })
      return
    }

    const target = lineElementsRef.current[lineIndex]
    if (!target) return

    const containerHeight = container.clientHeight
    const scrollTop = target.offsetTop - containerHeight / 2 + target.clientHeight / 2
    const behavior: ScrollBehavior = smooth && Math.abs(container.scrollTop - scrollTop) <= containerHeight ? 'smooth' : 'auto'
    container.scrollTo({ top: scrollTop, behavior })
  }

  const mountLines = (lines: RenderLine[]) => {
    const host = linesRef.current
    lineElementsRef.current = []
    if (!host) {
      setTimedLinesState(lines.length > 0 ? 'pending' : 'empty')
      return
    }

    const fragment = document.createDocumentFragment()

    for (const line of lines) {
      const domLine = line.dom_line
      domLine.onclick = () => seekRef.current(line.time / 1000)
      lineElementsRef.current.push(domLine)
      fragment.appendChild(domLine)
    }

    host.textContent = ''
    host.appendChild(fragment)
    setTimedLinesState(lines.length > 0 ? 'ready' : 'empty')

    window.requestAnimationFrame(() => {
      scrollToLine(currentLineRef.current, false)
    })
  }

  const syncLyricPlayback = (force = false) => {
    const lyric = lyricRef.current
    if (!lyric || timedLinesState !== 'ready') return

    const targetTime = Math.max(Math.round(currentTime * 1000), 0)
    const syncState = syncStateRef.current
    const jumped = syncState.sourceTime == null || Math.abs(targetTime - syncState.sourceTime) > (isPlaying ? 450 : 120)

    if (!isPlaying) {
      if (force || syncState.isPlaying || jumped) {
        lyric.play(targetTime)
        lyric.pause()
        syncState.sourceTime = targetTime
      } else {
        lyric.pause()
      }

      syncState.isPlaying = false
      return
    }

    if (force || !syncState.isPlaying || jumped) {
      lyric.play(targetTime)
    }

    syncState.sourceTime = targetTime
    syncState.isPlaying = true
  }

  useEffect(() => {
    lyricRef.current = new Lyric({
      shadowContent: false,
      rate: playbackRate,
      onPlay(line: number, text: string) {
        currentLineRef.current = line
        window.requestAnimationFrame(() => {
          scrollToLine(line)
        })
        lineChangeRef.current?.(text, line)
      },
      onSetLyric(lines: RenderLine[]) {
        mountLines(lines)
      },
      onUpdateLyric(lines: RenderLine[]) {
        mountLines(lines)
      },
    }) as LxLyricInstance

    return () => {
      lyricRef.current?.pause()
      lyricRef.current = null
      lineElementsRef.current = []
      if (linesRef.current) linesRef.current.textContent = ''
    }
  }, [])

  useEffect(() => {
    syncStateRef.current = {
      sourceTime: null,
      isPlaying: false,
    }
    currentLineRef.current = -1
    setTimedLinesState(shouldRenderTimedLyrics ? 'pending' : 'empty')

    if (!primaryLyric.trim()) {
      lineChangeRef.current?.('', -1)
      lyricRef.current?.setLyric('', [])
      return
    }

    if (shouldRenderTtmlLyrics) {
      lyricRef.current?.pause()
      lyricRef.current?.setLyric('', [])
      setTimedLinesState('ready')
      return
    }

    lyricRef.current?.setLyric(primaryLyric, extendedLyrics)

    window.requestAnimationFrame(() => {
      syncLyricPlayback(true)
    })
  }, [extendedLyrics, primaryLyric, shouldRenderTimedLyrics, shouldRenderTtmlLyrics])

  useEffect(() => {
    if (timedLinesState !== 'ready') return
    lyricRef.current?.setPlaybackRate(playbackRate)
    window.requestAnimationFrame(() => {
      syncLyricPlayback(true)
    })
  }, [playbackRate, timedLinesState])

  useEffect(() => {
    syncLyricPlayback(false)
  }, [currentTime, isPlaying, playbackRate, timedLinesState])

  const resolvedColors = useMemo(
    () => ({
      ...DEFAULT_LYRIC_COLORS[toneMode],
      ...colors,
    }),
    [colors, toneMode],
  )
  const rootStyle = useMemo(() => ({
    '--lx-lyrics-font-size': `${fontSize}px`,
    '--lx-lyrics-align': textAlign,
    '--lx-lyrics-plain-color': resolvedColors.active,
    '--lx-lyrics-active-color': resolvedColors.active,
    '--lx-lyrics-plain-line-height': `${Math.max(1.4, 1.2 + lineSpacing / 18)}`,
    '--lx-lyrics-text-shadow': 'none',
    '--line-gap': `${lineSpacing}px`,
    '--line-extended-gap': `${Math.max(4, Math.round(lineSpacing / 3))}px`,
    '--color-lyric-unplay': resolvedColors.unplayed,
    '--color-lyric-active-unplay': resolvedColors.active,
    '--color-lyric-played-line': resolvedColors.played,
    '--color-lyric-word': resolvedColors.word,
    '--color-lyric-sweep': resolvedColors.word,
    '--color-ttml-left': resolvedColors.ttmlLeft,
    '--color-ttml-right': resolvedColors.ttmlRight,
    '--color-ttml-background': resolvedColors.ttmlBackground,
    '--color-ttml-bg-unplay': resolvedColors.unplayed,
  }) as CSSProperties, [
    fontSize,
    lineSpacing,
    resolvedColors,
    textAlign,
  ])

  if (!primaryLyric.trim()) {
    return (
      <div className="lx-player-lyrics-empty">
        <p className={emptyClassName}>暂无歌词</p>
      </div>
    )
  }

  if (!shouldRenderTimedLyrics) {
    return plainLyrics.length > 0 ? (
      <div
        className={`lx-player-lyrics-plain is-${textAlign}`}
        style={rootStyle}
      >
        {plainLyrics.map((line, index) => (
          <p
            key={`${line}-${index}`}
            className="lx-player-lyrics-plain-line"
          >
            {line}
          </p>
        ))}
      </div>
    ) : (
      <div className="lx-player-lyrics-empty">
        <p className={emptyClassName}>暂无歌词</p>
      </div>
    )
  }

  if (shouldRenderTtmlLyrics) {
    return (
      <TtmlLyricPlayer
        lyric={primaryLyric}
        currentTime={currentTime}
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        textAlign={textAlign}
        rootStyle={rootStyle}
        emptyClassName={emptyClassName}
        onSeek={onSeek}
        onLineChange={onLineChange}
      />
    )
  }

  return (
    <div className="lx-player-lyrics" style={rootStyle}>
      <div ref={scrollRef} className="lx-player-lyrics-scroll">
        <div className="lx-player-lyrics-stage">
          <div ref={linesRef} className="lx-player-lyrics-lines" />
        </div>
      </div>
      {timedLinesState === 'empty' && (
        <div className="lx-player-lyrics-empty lx-player-lyrics-empty-overlay">
          <p className={emptyClassName}>暂无歌词</p>
        </div>
      )}
    </div>
  )
}
