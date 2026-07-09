import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { parseTtmlLyrics, type TtmlLyricAlignment, type TtmlLyricLine, type TtmlLyricWord } from './ttmlLyrics'

type Props = {
  lyric: string
  currentTime: number
  isPlaying: boolean
  playbackRate: number
  textAlign: TtmlLyricAlignment
  rootStyle: CSSProperties
  emptyClassName: string
  onSeek: (time: number) => void
  onLineChange?: (text: string, line: number) => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const wordProgress = (word: TtmlLyricWord, currentTime: number) => {
  if (currentTime <= word.startTime) return 0
  if (currentTime >= word.endTime) return 1
  const duration = Math.max(word.endTime - word.startTime, 0.001)
  return clamp((currentTime - word.startTime) / duration, 0, 1)
}

const isLineActive = (line: TtmlLyricLine, currentTime: number) => {
  return currentTime >= line.startTime && currentTime <= line.endTime
}

const isLinePast = (line: TtmlLyricLine, currentTime: number) => {
  return currentTime > line.endTime
}

const findFocusLineIndex = (lines: TtmlLyricLine[], currentTime: number) => {
  if (!lines.length) return -1

  const firstActiveIndex = lines.findIndex((line) => isLineActive(line, currentTime))
  if (firstActiveIndex >= 0) return firstActiveIndex

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (currentTime >= lines[index].startTime) return index
  }

  return 0
}

function TtmlWords({
  words,
  currentTime,
  background = false,
}: {
  words: TtmlLyricWord[]
  currentTime: number
  background?: boolean
}) {
  return (
    <>
      {words.map((word, index) => (
        <span
          key={`${word.startTime}-${word.endTime}-${word.text}-${index}`}
          className={background ? 'ttml-lyric-word is-background' : 'ttml-lyric-word'}
          style={{
            '--word-progress': `${wordProgress(word, currentTime) * 100}%`,
          } as CSSProperties}
        >
          {word.text}
        </span>
      ))}
    </>
  )
}

export default function TtmlLyricPlayer({
  lyric,
  currentTime,
  isPlaying,
  playbackRate,
  textAlign,
  rootStyle,
  emptyClassName,
  onSeek,
  onLineChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([])
  const lastFocusIndexRef = useRef(-1)
  const [displayTime, setDisplayTime] = useState(currentTime)
  const parsed = useMemo(() => parseTtmlLyrics(lyric, textAlign), [lyric, textAlign])
  const focusIndex = useMemo(() => findFocusLineIndex(parsed.lines, displayTime), [displayTime, parsed.lines])

  useEffect(() => {
    if (!isPlaying) {
      setDisplayTime(currentTime)
      return
    }

    const startTime = currentTime
    const startedAt = performance.now()
    let frameId = 0
    let timeoutId = 0

    const tick = () => {
      const elapsed = (performance.now() - startedAt) / 1000
      setDisplayTime(startTime + elapsed * playbackRate)
      // Every update re-renders the whole line list, so cap ticks at ~30fps
      // instead of the display refresh rate.
      timeoutId = window.setTimeout(() => {
        frameId = window.requestAnimationFrame(tick)
      }, 33)
    }

    frameId = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [currentTime, isPlaying, playbackRate])

  useEffect(() => {
    if (focusIndex === lastFocusIndexRef.current) return

    lastFocusIndexRef.current = focusIndex
    const line = parsed.lines[focusIndex]
    if (!line) {
      onLineChange?.('', -1)
      return
    }

    onLineChange?.(line.text || line.backgroundText, focusIndex)

    const container = scrollRef.current
    const target = lineRefs.current[focusIndex]
    if (!container || !target) return

    const scrollTop = target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2
    const behavior: ScrollBehavior = Math.abs(container.scrollTop - scrollTop) <= container.clientHeight ? 'smooth' : 'auto'
    container.scrollTo({ top: scrollTop, behavior })
  }, [focusIndex, onLineChange, parsed.lines])

  if (!parsed.lines.length) {
    return (
      <div className="lx-player-lyrics-empty">
        <p className={emptyClassName}>暂无歌词</p>
      </div>
    )
  }

  return (
    <div className="lx-player-lyrics ttml-lyrics" style={rootStyle}>
      <div ref={scrollRef} className="lx-player-lyrics-scroll ttml-lyrics-scroll">
        <div className="lx-player-lyrics-stage ttml-lyrics-stage">
          <div className="lx-player-lyrics-lines ttml-lyrics-lines">
            {parsed.lines.map((line, index) => {
              const active = isLineActive(line, displayTime)
              const past = isLinePast(line, displayTime)
              return (
                <button
                  key={line.id}
                  ref={(element) => {
                    lineRefs.current[index] = element
                  }}
                  type="button"
                  className={[
                    'ttml-lyric-line',
                    `is-${line.alignment}`,
                    active ? 'is-active' : '',
                    past ? 'is-past' : 'is-future',
                    line.backgroundWords.length ? 'has-background' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => onSeek(line.startTime)}
                >
                  {line.words.length > 0 && (
                    <span className="ttml-lyric-main">
                      <TtmlWords words={line.words} currentTime={displayTime} />
                    </span>
                  )}

                  {line.backgroundWords.length > 0 && (
                    <span className="ttml-lyric-background">
                      <TtmlWords words={line.backgroundWords} currentTime={displayTime} background />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
