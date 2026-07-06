import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import type { LyricData } from '@/types'
import { findCurrentLyricIndex, parseRichLyrics, type LyricLine } from '@/utils/format'

type DesktopLyricsPayload = {
  song: {
    id: string
    name: string
    artist: string
    album?: string
    platform: string
  } | null
  lyricData: LyricData | null
  lyrics: string | null
  currentTime: number
  isPlaying: boolean
}

type DesktopLyricsSettings = {
  fontSize: number
  opacity: number
  backgroundOpacity: number
  unplayColor: string
  playedColor: string
  currentLineColor: string
  lock: boolean
  alwaysOnTop: boolean
  showTranslation: boolean
  align: 'left' | 'center' | 'right'
  transparentBackground: boolean
}

const STORAGE_KEY = 'desktop-lyrics-v3-settings'

const defaultPayload: DesktopLyricsPayload = {
  song: null,
  lyricData: null,
  lyrics: null,
  currentTime: 0,
  isPlaying: false,
}

const defaultSettings: DesktopLyricsSettings = {
  fontSize: 30,
  opacity: 95,
  backgroundOpacity: 38,
  unplayColor: '#ffffff',
  playedColor: '#22c55e',
  currentLineColor: '#ffffff',
  lock: false,
  alwaysOnTop: true,
  showTranslation: true,
  align: 'center',
  transparentBackground: false,
}

const FRAME_THROTTLE = 1 / 30

const normalizeHexColor = (color: string, fallback: string) => {
  const value = color.trim()
  return /^#([0-9a-fA-F]{6})$/.test(value) ? value : fallback
}

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = normalizeHexColor(hex, '#ffffff').slice(1)
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const loadSettings = (): DesktopLyricsSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings
    const parsed = JSON.parse(raw) as Partial<DesktopLyricsSettings>
    return {
      ...defaultSettings,
      ...parsed,
      unplayColor: normalizeHexColor(parsed.unplayColor || '', defaultSettings.unplayColor),
      playedColor: normalizeHexColor(parsed.playedColor || '', defaultSettings.playedColor),
      currentLineColor: normalizeHexColor(parsed.currentLineColor || '', defaultSettings.currentLineColor),
    }
  } catch {
    return defaultSettings
  }
}

// Compute karaoke state per word for the current line.
// Returns a list of { text, state, progress } chunks where state is 'played' | 'active' | 'pending'.
type WordChunk = {
  text: string
  state: 'played' | 'active' | 'pending'
  progress: number // only meaningful when state === 'active' (0..1 within the word)
}

const computeWordChunks = (line: LyricLine | null, currentTime: number): WordChunk[] | null => {
  if (!line?.words?.length) return null
  const words = line.words
  const chunks: WordChunk[] = []
  let activeFound = false
  for (const word of words) {
    if (activeFound || currentTime < word.startTime) {
      chunks.push({ text: word.text, state: 'pending', progress: 0 })
      continue
    }
    if (currentTime >= word.endTime) {
      chunks.push({ text: word.text, state: 'played', progress: 1 })
      continue
    }
    const dur = Math.max(word.endTime - word.startTime, 0.001)
    const innerProgress = Math.max(0, Math.min((currentTime - word.startTime) / dur, 1))
    // Round so identical frames don't trigger style recomputation.
    const rounded = Math.round(innerProgress * 1000) / 1000
    chunks.push({ text: word.text, state: 'active', progress: rounded })
    activeFound = true
  }
  return chunks
}

type LyricRowProps = {
  line: LyricLine | null
  chunks: WordChunk[] | null
  position: 'top' | 'bottom'
  settings: DesktopLyricsSettings
}

const LyricRow = memo(function LyricRow({ line, chunks, position, settings }: LyricRowProps) {
  const isCurrent = position === 'top'
  const text = line?.text || ''
  const translation = settings.showTranslation ? (line?.translation || '') : ''

  const baseColor = isCurrent
    ? hexToRgba(settings.currentLineColor, 0.96)
    : hexToRgba(settings.unplayColor, 0.6)
  const playedColor = hexToRgba(settings.playedColor, 1)
  const pendingColor = isCurrent
    ? hexToRgba(settings.currentLineColor, 0.96)
    : hexToRgba(settings.unplayColor, 0.6)

  const renderText = () => {
    if (!isCurrent || !chunks?.length) {
      return text || (isCurrent ? '\u00a0' : '')
    }
    return chunks.map((chunk, i) => {
      if (chunk.state === 'played') {
        return (
          <span key={i} style={{ color: playedColor }}>{chunk.text}</span>
        )
      }
      if (chunk.state === 'pending') {
        return (
          <span key={i} style={{ color: pendingColor }}>{chunk.text}</span>
        )
      }
      // Active word: per-word sweep using background-clip: text on a single span.
      const pct = Math.round(chunk.progress * 1000) / 10
      return (
        <span
          key={i}
          className="dl-word-active"
          style={{
            backgroundImage: `linear-gradient(90deg, ${playedColor} 0%, ${playedColor} calc(${pct}% - 1px), ${pendingColor} calc(${pct}% + 1px), ${pendingColor} 100%)`,
          }}
        >
          {chunk.text}
        </span>
      )
    })
  }

  return (
    <div className={`dl-row dl-row-${position}`}>
      <div
        className="dl-text"
        style={{
          fontSize: `${settings.fontSize}px`,
          textAlign: settings.align,
          color: baseColor,
        }}
      >
        {renderText()}
      </div>
      {translation ? (
        <div
          className="dl-translation"
          style={{
            fontSize: `${Math.max(8, settings.fontSize * 0.55)}px`,
            color: hexToRgba(settings.unplayColor, isCurrent ? 0.78 : 0.5),
            textAlign: settings.align,
          }}
        >
          {translation}
        </div>
      ) : null}
    </div>
  )
})

function DesktopLyricsApp() {
  const [settings, setSettings] = useState<DesktopLyricsSettings>(() => loadSettings())
  const [payload, setPayload] = useState<DesktopLyricsPayload>(defaultPayload)
  const [displayTime, setDisplayTime] = useState(0)
  const timingRef = useRef({ currentTime: 0, isPlaying: false, syncedAt: performance.now() })

  // Persist settings + push runtime flags to the main process.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    window.electronAPI?.setDesktopLyricsAlwaysOnTop?.(settings.alwaysOnTop)
    window.electronAPI?.setDesktopLyricsLockStatus?.(settings.lock)
  }, [settings])

  // On mount: window starts unlocked-interactive.
  useEffect(() => {
    window.electronAPI?.setDesktopLyricsIgnoreMouse?.(false)
    window.electronAPI?.setDesktopLyricsInteractive?.(false)
  }, [])

  // Click-through behavior follows lock state.
  useEffect(() => {
    if (!settings.lock) {
      window.electronAPI?.setDesktopLyricsIgnoreMouse?.(false)
      return
    }
    window.electronAPI?.setDesktopLyricsIgnoreMouse?.(true)
  }, [settings.lock])

  // Receive sync payload from main window.
  useEffect(() => {
    if (!window.electronAPI?.onDesktopLyricsState) return
    return window.electronAPI.onDesktopLyricsState((next) => setPayload(next))
  }, [])

  // Allow the main window menu to control the click-through lock state.
  useEffect(() => {
    if (!window.electronAPI?.onDesktopLyricsLock) return
    return window.electronAPI.onDesktopLyricsLock(() => {
      setSettings((prev) => ({ ...prev, lock: true }))
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onDesktopLyricsUnlock) return
    return window.electronAPI.onDesktopLyricsUnlock(() => {
      setSettings((prev) => ({ ...prev, lock: false }))
    })
  }, [])

  // Snap timing reference whenever the host sends a new sync.
  useEffect(() => {
    timingRef.current = {
      currentTime: payload.currentTime,
      isPlaying: payload.isPlaying,
      syncedAt: performance.now(),
    }
    setDisplayTime(payload.currentTime)
  }, [payload.currentTime, payload.isPlaying, payload.song?.id, payload.lyricData, payload.lyrics])

  // rAF clock to interpolate currentTime smoothly.
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      const t = timingRef.current
      const next = t.isPlaying
        ? t.currentTime + (performance.now() - t.syncedAt) / 1000
        : t.currentTime
      setDisplayTime((prev) => Math.abs(prev - next) >= FRAME_THROTTLE ? next : prev)
      rafId = window.requestAnimationFrame(tick)
    }
    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [])

  const lyricSource = useMemo<LyricData | null>(() => {
    if (payload.lyricData) return payload.lyricData
    if (payload.lyrics) return { lyric: payload.lyrics }
    return null
  }, [payload.lyricData, payload.lyrics])

  const parsedLyrics = useMemo(() => {
    return parseRichLyrics(lyricSource, {
      showTranslation: settings.showTranslation,
      showRoman: false,
      preferWordByWord: true,
    })
  }, [lyricSource, settings.showTranslation])

  const currentIndex = useMemo(
    () => findCurrentLyricIndex(parsedLyrics, displayTime),
    [parsedLyrics, displayTime],
  )

  const currentLine = parsedLyrics[currentIndex] ?? null
  const nextLine = parsedLyrics[currentIndex + 1] ?? null

  const currentChunks = useMemo(
    () => computeWordChunks(currentLine, displayTime),
    [currentLine, displayTime],
  )

  const shellStyle = useMemo<CSSProperties>(() => {
    const base: CSSProperties = {
      opacity: settings.opacity / 100,
    }
    if (settings.transparentBackground) {
      return {
        ...base,
        background: 'transparent',
        boxShadow: 'none',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
      }
    }
    const a = settings.backgroundOpacity / 100
    return {
      ...base,
      background: `linear-gradient(135deg, rgba(15, 23, 42, ${a}) 0%, rgba(15, 23, 42, ${Math.max(a * 0.7, 0.05)}) 100%)`,
      boxShadow: `0 12px 40px rgba(0, 0, 0, ${Math.min(0.3, a * 0.6)})`,
    }
  }, [settings.backgroundOpacity, settings.opacity, settings.transparentBackground])

  // Empty state: no song.
  const showPlaceholder = !payload.song

  return (
    <>
      <style>{`
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        html, body, #desktop-lyrics-root {
          width: 100%; height: 100%; margin: 0;
          overflow: hidden; background: transparent;
          font-family: "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        }
        body { user-select: none; }

        .dl-shell {
          position: relative;
          width: 100%; height: 100%;
          display: flex; flex-direction: column;
          padding: 14px 22px;
          border-radius: 16px;
          overflow: hidden;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          cursor: default;
        }
        .dl-shell.unlocked {
          -webkit-app-region: drag;
          cursor: move;
        }
        .dl-shell.locked { cursor: default; }

        .dl-toolbar, .dl-toolbar *,
        .dl-resize, .dl-resize * {
          -webkit-app-region: no-drag;
        }

        .dl-toolbar {
          position: absolute;
          top: 8px; left: 12px; right: 12px;
          z-index: 4;
          display: flex; flex-wrap: wrap;
          gap: 6px;
          opacity: 0;
          pointer-events: none;
          transition: opacity 160ms ease;
        }
        .dl-shell:hover .dl-toolbar {
          opacity: 1;
          pointer-events: auto;
        }
        .dl-shell.locked .dl-toolbar { opacity: 0; pointer-events: none; }

        .dl-btn {
          height: 26px; padding: 0 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(15, 23, 42, 0.55);
          color: rgba(255,255,255,0.92);
          font-size: 12px;
          cursor: pointer;
          backdrop-filter: blur(12px);
        }
        .dl-btn.active {
          background: rgba(34, 197, 94, 0.3);
          border-color: rgba(134, 239, 172, 0.45);
        }
        .dl-icon {
          width: 26px; height: 26px;
          padding: 0;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 16px;
          line-height: 1;
        }

        .dl-color {
          width: 26px; height: 26px;
          padding: 2px;
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(15, 23, 42, 0.55);
          cursor: pointer;
        }
        .dl-color input {
          width: 100%; height: 100%;
          padding: 0; border: none; background: transparent; cursor: pointer;
        }

        .dl-stage {
          flex: 1;
          display: flex; flex-direction: column;
          justify-content: center;
          gap: 8px;
          min-height: 0;
        }
        .dl-row {
          display: flex; flex-direction: column;
          gap: 4px;
          line-height: 1.18;
        }
        .dl-text {
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: color 200ms ease;
        }
        .dl-row-bottom .dl-text {
          font-weight: 500;
        }
        .dl-word-active {
          color: transparent !important;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          background-repeat: no-repeat;
          background-size: 100% 100%;
        }
        .dl-translation {
          font-weight: 400;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dl-empty {
          flex: 1;
          display: flex; align-items: center; justify-content: center;
          color: rgba(255,255,255,0.7);
          font-size: 16px;
        }

        .dl-resize {
          position: absolute;
          right: 6px; bottom: 6px;
          width: 14px; height: 14px;
          cursor: nwse-resize;
          border-right: 2px solid rgba(255,255,255,0.6);
          border-bottom: 2px solid rgba(255,255,255,0.6);
          opacity: 0;
          transition: opacity 160ms ease;
        }
        .dl-shell:hover .dl-resize { opacity: 0.85; }
      `}</style>

      <div
        className={`dl-shell ${settings.lock ? 'locked' : 'unlocked'}`}
        style={shellStyle}
      >
        <Toolbar settings={settings} setSettings={setSettings} />

        {showPlaceholder ? (
          <div className="dl-empty">桌面歌词 · 等待播放</div>
        ) : (
          <div className="dl-stage">
            <LyricRow
              line={currentLine}
              chunks={currentChunks}
              position="top"
              settings={settings}
            />
            <LyricRow
              line={nextLine}
              chunks={null}
              position="bottom"
              settings={settings}
            />
          </div>
        )}

        {!settings.lock ? <ResizeHandle /> : null}
      </div>
    </>
  )
}

type ToolbarProps = {
  settings: DesktopLyricsSettings
  setSettings: (updater: (prev: DesktopLyricsSettings) => DesktopLyricsSettings) => void
}

function Toolbar({ settings, setSettings }: ToolbarProps) {
  const update = <K extends keyof DesktopLyricsSettings>(key: K, value: DesktopLyricsSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }
  const toggle = (key: keyof DesktopLyricsSettings) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="dl-toolbar">
      <button
        className="dl-btn dl-icon"
        title="关闭桌面歌词"
        onClick={() => window.electronAPI?.toggleDesktopLyrics()}
      >
        ×
      </button>
      {!settings.lock ? (
        <>
          <button
            className={`dl-btn${settings.alwaysOnTop ? ' active' : ''}`}
            onClick={() => toggle('alwaysOnTop')}
          >
            置顶
          </button>
          <button className="dl-btn" onClick={() => update('fontSize', Math.max(10, settings.fontSize - 2))}>A-</button>
          <button className="dl-btn" onClick={() => update('fontSize', Math.min(48, settings.fontSize + 2))}>A+</button>
          <button
            className={`dl-btn${settings.showTranslation ? ' active' : ''}`}
            onClick={() => toggle('showTranslation')}
          >
            翻译
          </button>
          <button
            className={`dl-btn${settings.align === 'left' ? ' active' : ''}`}
            onClick={() => update('align', 'left')}
          >左</button>
          <button
            className={`dl-btn${settings.align === 'center' ? ' active' : ''}`}
            onClick={() => update('align', 'center')}
          >中</button>
          <button
            className={`dl-btn${settings.align === 'right' ? ' active' : ''}`}
            onClick={() => update('align', 'right')}
          >右</button>
          <button className="dl-btn" onClick={() => update('opacity', Math.max(30, settings.opacity - 8))}>透-</button>
          <button className="dl-btn" onClick={() => update('opacity', Math.min(100, settings.opacity + 8))}>透+</button>
          <button className="dl-btn" onClick={() => update('backgroundOpacity', Math.max(0, settings.backgroundOpacity - 8))}>底-</button>
          <button className="dl-btn" onClick={() => update('backgroundOpacity', Math.min(100, settings.backgroundOpacity + 8))}>底+</button>
          <button
            className={`dl-btn${settings.transparentBackground ? ' active' : ''}`}
            onClick={() => toggle('transparentBackground')}
          >
            纯字
          </button>
          <label className="dl-color" title="当前句颜色">
            <input
              type="color"
              value={settings.currentLineColor}
              onChange={(e) => update('currentLineColor', e.target.value)}
            />
          </label>
          <label className="dl-color" title="下一句颜色">
            <input
              type="color"
              value={settings.unplayColor}
              onChange={(e) => update('unplayColor', e.target.value)}
            />
          </label>
          <label className="dl-color" title="逐字扫光颜色">
            <input
              type="color"
              value={settings.playedColor}
              onChange={(e) => update('playedColor', e.target.value)}
            />
          </label>
        </>
      ) : null}
    </div>
  )
}

function ResizeHandle() {
  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = window.innerWidth
    const startHeight = window.innerHeight

    const onMove = (moveEvent: MouseEvent) => {
      const w = Math.max(360, Math.round(startWidth + moveEvent.clientX - startX))
      const h = Math.max(80, Math.round(startHeight + moveEvent.clientY - startY))
      window.resizeTo(w, h)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return <div className="dl-resize" onMouseDown={handleMouseDown} />
}

const rootElement = document.getElementById('desktop-lyrics-root')
if (rootElement) {
  createRoot(rootElement).render(<DesktopLyricsApp />)
}
