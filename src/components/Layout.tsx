import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import AnimatedOutlet from './PageTransition'
import {
  X,
  Trash2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Heart,
  ListPlus,
  Repeat,
  Repeat1,
  Shuffle,
  Settings,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Mic2,
  BarChart3,
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserStore } from '@/stores/userStore'
import { formatTime } from '@/utils/format'
import type { PlayMode } from '@/types'
import Sidebar from './Sidebar'
import TitleBar from './TitleBar'
import TopBar from './TopBar'
import Player from './Player'
import MiniPlayer from './MiniPlayer'
import { useUIStore } from '@/stores/uiStore'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlaybackProgressStore } from '@/stores/playbackProgressStore'
import { cn } from '@/utils/cn'
import CoverImage from '@/components/ui/CoverImage'
import CommentSection from '@/components/CommentSection'
import AudioVisualizer from '@/components/AudioVisualizer'
import LxLyricPlayer, { DEFAULT_LYRIC_COLORS, type LyricColorSettings } from '@/components/player/LxLyricPlayer'
import AmllFullPlayer from '@/components/player/AmllFullPlayer'
import PlaybackQualityMenu from '@/components/player/PlaybackQualityMenu'
import PlaybackRateMenu from '@/components/player/PlaybackRateMenu'
import { useCoverBackdrop, resolveBackgroundTheme, type ResolvedBackground } from '@/hooks/useCoverBackdrop'
import { EQ_FREQUENCIES, EQ_PRESETS, REVERB_PRESETS } from '@/utils/audioEffects'
import { isSamePlayableSong } from '@/utils/songIdentity'

type LyricsToneMode = 'dark' | 'light'

const MINI_WINDOW_FALLBACK_WIDTH = 360
const MINI_WINDOW_FALLBACK_HEIGHT = 118
const MINI_WINDOW_FRAME_STORAGE_KEY = 'mini-player-window-frame'
const LYRICS_COLOR_STORAGE_KEY = 'lyrics-color-settings'
const LYRICS_OPTION_STORAGE_KEYS = {
  word: 'lyrics-show-word',
  translation: 'lyrics-show-translation',
  roman: 'lyrics-show-roman',
} as const

type LyricDisplayOptions = {
  word: boolean
  translation: boolean
  roman: boolean
}

const isHexColor = (value: unknown): value is string => {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

const readStoredLyricDisplayOptions = (): LyricDisplayOptions => {
  if (typeof window === 'undefined') {
    return {
      word: true,
      translation: true,
      roman: false,
    }
  }

  return {
    word: window.localStorage.getItem(LYRICS_OPTION_STORAGE_KEYS.word) !== 'false',
    translation: window.localStorage.getItem(LYRICS_OPTION_STORAGE_KEYS.translation) !== 'false',
    roman: window.localStorage.getItem(LYRICS_OPTION_STORAGE_KEYS.roman) === 'true',
  }
}

const readStoredLyricColors = (toneMode: LyricsToneMode): LyricColorSettings => {
  const defaults = DEFAULT_LYRIC_COLORS[toneMode]

  if (typeof window === 'undefined') return defaults

  try {
    const raw = window.localStorage.getItem(LYRICS_COLOR_STORAGE_KEY)
    if (!raw) return defaults

    const parsed = JSON.parse(raw) as Partial<Record<keyof LyricColorSettings, unknown>>
    return Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [
        key,
        isHexColor(parsed[key as keyof LyricColorSettings]) ? parsed[key as keyof LyricColorSettings] : value,
      ]),
    ) as LyricColorSettings
  } catch {
    return defaults
  }
}

const BackgroundLayer = memo(function BackgroundLayer({
  resolvedBg,
  textureSrc,
  isDarkAppearance,
  backgroundMode,
}: {
  resolvedBg: ResolvedBackground
  textureSrc: string | null
  isDarkAppearance: boolean
  backgroundMode: string
}) {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
      <div
        className="absolute inset-0 transition-[background] duration-700 ease-in-out"
        style={{ background: resolvedBg.baseColor }}
      />
      {textureSrc ? (
        backgroundMode === 'image' ? (
          <img
            src={textureSrc}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute top-1/2 left-1/2 min-w-[120%] min-h-[120%] object-cover transition-opacity duration-700 ease-in-out"
            style={{
              filter: resolvedBg.blurPrimary > 0 ? `blur(${resolvedBg.blurPrimary}px)` : undefined,
              transform: 'translate(-50%, -50%)',
              opacity: resolvedBg.textureOpacity,
              contain: 'strict',
            }}
          />
        ) : (
          <img
            src={textureSrc}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              'absolute top-1/2 left-1/2 min-w-[180%] min-h-[180%] object-cover transition-opacity duration-700 ease-in-out',
              isDarkAppearance ? 'mix-blend-screen' : 'mix-blend-multiply'
            )}
            style={{
              filter: `blur(${resolvedBg.blurPrimary}px)`,
              transform: 'translate(-50%, -50%) scale(1.2)',
              opacity: resolvedBg.textureOpacity,
              contain: 'strict',
            }}
          />
        )
      ) : null}
      <div
        className="absolute inset-0 transition-[background] duration-700 ease-in-out"
        style={{ background: resolvedBg.gradientBackground }}
      />
      <div
        className="absolute inset-0 transition-[background] duration-700 ease-in-out"
        style={{ background: resolvedBg.accentBackground }}
      />
      <div className="absolute inset-0" style={{ background: resolvedBg.veilBackground }} />
      {resolvedBg.overlayOpacity > 0 && (
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: resolvedBg.overlayColor,
            opacity: resolvedBg.overlayOpacity,
          }}
        />
      )}
    </div>
  )
})

export default function Layout() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const showLyricsPanel = useUIStore((s) => s.showLyricsPanel)
  const lyricsPlayerMode = useUIStore((s) => s.lyricsPlayerMode)
  const showQueuePanel = useUIStore((s) => s.showQueuePanel)
  const theme = useUIStore((s) => s.theme)
  const isMiniMode = useUIStore((s) => s.isMiniMode)
  const mainWindowAlwaysOnTop = useUIStore((s) => s.mainWindowAlwaysOnTop)
  const backgroundSettings = useUIStore((s) => s.backgroundSettings)
  const currentSong = usePlayerStore((s) => s.currentSong)
  const previousWindowFrameRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const isDarkAppearance = theme === 'system' ? systemPrefersDark : theme === 'dark'
  const coverBackdrop = useCoverBackdrop(currentSong?.cover)
  const appResolvedBg = useMemo(
    () => resolveBackgroundTheme(backgroundSettings, coverBackdrop, isDarkAppearance, 'main'),
    [backgroundSettings, coverBackdrop, isDarkAppearance],
  )
  const lyricsResolvedBg = useMemo(
    () => resolveBackgroundTheme(backgroundSettings, coverBackdrop, isDarkAppearance, 'lyrics'),
    [backgroundSettings, coverBackdrop, isDarkAppearance],
  )
  const backgroundTextureSrc = appResolvedBg.textureSrc || coverBackdrop.textureSrc || currentSong?.cover || null
  const lyricsTextureSrc = lyricsResolvedBg.textureSrc || coverBackdrop.textureSrc || currentSong?.cover || null

  useEffect(() => {
    if (typeof window === 'undefined') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    const legacyMedia = media as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
    }

    setSystemPrefersDark(media.matches)
    if ('addEventListener' in media) {
      media.addEventListener('change', handleChange)
      return () => media.removeEventListener('change', handleChange)
    }

    legacyMedia.addListener?.(handleChange)
    return () => legacyMedia.removeListener?.(handleChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (backgroundSettings.mode === 'image') {
      root.setAttribute('data-bg-mode', 'image')
      root.style.setProperty('--panel-bg-opacity', String(backgroundSettings.overlayOpacity))
      // Map blurIntensity 0-200 to backdrop-blur 0-24px
      const panelBlur = Math.round((backgroundSettings.blurIntensity / 200) * 24)
      root.style.setProperty('--panel-backdrop-blur', `${panelBlur}px`)
    } else {
      root.removeAttribute('data-bg-mode')
      root.style.setProperty('--panel-bg-opacity', '')
      root.style.setProperty('--panel-backdrop-blur', '')
    }
  }, [backgroundSettings.mode, backgroundSettings.overlayOpacity, backgroundSettings.blurIntensity])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--text-primary', appResolvedBg.fgPrimary)
    root.style.setProperty('--text-secondary', appResolvedBg.fgSecondary)
    root.style.setProperty('--text-muted', appResolvedBg.fgMuted)
  }, [appResolvedBg.fgPrimary, appResolvedBg.fgSecondary, appResolvedBg.fgMuted])

  useEffect(() => {
    if (typeof window === 'undefined') return

    let cancelled = false
    let persistTimer: number | null = null
    const readStoredMiniFrame = () => {
      try {
        const raw = window.localStorage.getItem(MINI_WINDOW_FRAME_STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as { x: number; y: number; width: number; height: number }
        if (![parsed?.x, parsed?.y, parsed?.width, parsed?.height].every((value) => Number.isFinite(value))) {
          return null
        }
        return parsed
      } catch {
        return null
      }
    }

    const writeStoredMiniFrame = (frame: { x: number; y: number; width: number; height: number }) => {
      try {
        window.localStorage.setItem(MINI_WINDOW_FRAME_STORAGE_KEY, JSON.stringify(frame))
      } catch {
        // ignore
      }
    }

    const saveCurrentFrame = () => {
      if (!previousWindowFrameRef.current) {
        previousWindowFrameRef.current = {
          x: window.screenX,
          y: window.screenY,
          width: window.outerWidth,
          height: window.outerHeight,
        }
      }
    }

    const applyMiniWindowFallback = () => {
      const storedFrame = readStoredMiniFrame()
      const currentWidth = window.outerWidth
      const currentHeight = window.outerHeight
      const nextX = storedFrame?.x ?? Math.round(window.screenX + (currentWidth - MINI_WINDOW_FALLBACK_WIDTH) / 2)
      const nextY = storedFrame?.y ?? Math.round(window.screenY + (currentHeight - MINI_WINDOW_FALLBACK_HEIGHT) / 2)

      window.resizeTo(MINI_WINDOW_FALLBACK_WIDTH, MINI_WINDOW_FALLBACK_HEIGHT)
      window.moveTo(nextX, nextY)
      writeStoredMiniFrame({
        x: nextX,
        y: nextY,
        width: MINI_WINDOW_FALLBACK_WIDTH,
        height: MINI_WINDOW_FALLBACK_HEIGHT,
      })
    }

    const restoreWindowFallback = () => {
      const previous = previousWindowFrameRef.current
      if (!previous) return

      window.resizeTo(previous.width, previous.height)
      window.moveTo(previous.x, previous.y)
      previousWindowFrameRef.current = null
    }

    const syncMiniMode = async() => {
      if (isMiniMode) {
        saveCurrentFrame()
      }

      if (window.electronAPI?.setMiniMode) {
        try {
          await window.electronAPI.setMiniMode(isMiniMode)
        } catch (error) {
          console.warn('Sync mini mode failed:', error)
        }
      }

      window.setTimeout(() => {
        if (cancelled) return

        if (isMiniMode) {
          if (window.outerWidth > MINI_WINDOW_FALLBACK_WIDTH + 80 || window.outerHeight > MINI_WINDOW_FALLBACK_HEIGHT + 80) {
            applyMiniWindowFallback()
          }

          persistTimer = window.setInterval(() => {
            writeStoredMiniFrame({
              x: window.screenX,
              y: window.screenY,
              width: window.outerWidth,
              height: window.outerHeight,
            })
          }, 400)
          return
        }

        if (previousWindowFrameRef.current && window.outerWidth <= MINI_WINDOW_FALLBACK_WIDTH + 80) {
          restoreWindowFallback()
        }
      }, 120)
    }

    void syncMiniMode()

    return () => {
      cancelled = true
      if (persistTimer != null) {
        window.clearInterval(persistTimer)
      }
    }
  }, [isMiniMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.electronAPI?.setWindowAlwaysOnTop) {
      if (mainWindowAlwaysOnTop) {
        console.warn('Window always-on-top API is unavailable. Restart the desktop app to apply preload/main-process changes.')
      }
      return
    }

    window.electronAPI.setWindowAlwaysOnTop(mainWindowAlwaysOnTop).catch((error) => {
      console.warn('Sync main window always-on-top failed:', error)
    })
  }, [mainWindowAlwaysOnTop])

  return (
    <>
      <div className={cn('flex flex-col h-screen overflow-hidden relative', isMiniMode && 'hidden')}>
        <BackgroundLayer
          resolvedBg={appResolvedBg}
          textureSrc={backgroundTextureSrc}
          isDarkAppearance={isDarkAppearance}
          backgroundMode={backgroundSettings.mode}
        />

        {/* Title bar (for Electron) */}
        <div className="relative z-10">
          <TitleBar />
        </div>

        {/* Top bar with search */}
        <div className={cn(
          'relative z-30 transition-[margin] duration-300',
          sidebarCollapsed ? 'ml-20' : 'ml-56'
        )}>
          <TopBar />
        </div>

        <div className="flex flex-1 overflow-hidden relative">
          {/* Sidebar */}
          <Sidebar />

          {/* Main content */}
          <div className={cn(
            'flex-1 min-w-0 relative transition-[margin] duration-300',
            sidebarCollapsed ? 'ml-20' : 'ml-56'
          )}>
            <div
              className="absolute inset-0 bg-[var(--panel-bg)]"
              style={{ backdropFilter: 'blur(var(--panel-backdrop-blur))' }}
            />
            <main
              className="relative overflow-y-auto h-full"
            >
            <div className="p-6 pt-2 pb-20">
              <AnimatedOutlet />
            </div>
          </main>
          </div>

          {/* Queue panel - floating */}
          {showQueuePanel && (
            <div className="fixed right-4 top-20 bottom-28 w-96 rounded-2xl border border-gray-200/50 dark:border-gray-800/50 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl overflow-y-auto overflow-x-hidden shadow-2xl z-40">
              <QueuePanel />
            </div>
          )}
        </div>

        {/* Player bar - fixed at bottom, wrapper provides spacing */}
        <div className="relative z-10 h-20 flex-shrink-0">
          <Player />
        </div>

        {/* Lyrics panel overlay with slide animation */}
        <AnimatePresence>
          {showLyricsPanel && lyricsPlayerMode === 'amll' && (
            <AmllFullPlayer />
          )}
          {showLyricsPanel && lyricsPlayerMode === 'default' && (
            <LyricsPanel
              resolvedBg={lyricsResolvedBg}
              textureSrc={lyricsTextureSrc}
              isCustomImage={backgroundSettings.mode === 'image'}
            />
          )}
        </AnimatePresence>
      </div>

      {isMiniMode && (
        <div className="relative flex h-screen flex-col overflow-hidden">
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div className="absolute inset-0" style={{ background: appResolvedBg.baseColor }} />
            {backgroundTextureSrc ? (
              backgroundSettings.mode === 'image' ? (
                <>
                  <img
                    src={backgroundTextureSrc}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute top-1/2 left-1/2 min-w-[120%] min-h-[120%] object-cover"
                    style={{
                      filter: appResolvedBg.blurPrimary > 0 ? `blur(${appResolvedBg.blurPrimary}px)` : undefined,
                      transform: 'translate(-50%, -50%)',
                      opacity: appResolvedBg.textureOpacity * 0.9,
                      contain: 'strict',
                    }}
                  />
                  <div className="absolute inset-0" style={{ background: appResolvedBg.gradientBackground }} />
                  <div className="absolute inset-0" style={{ background: appResolvedBg.veilBackground }} />
                </>
              ) : (
                <>
                  <img
                    src={backgroundTextureSrc}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={cn(
                      'absolute top-1/2 left-1/2 min-w-[180%] min-h-[180%] object-cover',
                      isDarkAppearance ? 'mix-blend-screen' : 'mix-blend-multiply'
                    )}
                    style={{
                      filter: `blur(${appResolvedBg.blurPrimary}px)`,
                      transform: 'translate(-50%, -50%) scale(1.16)',
                      opacity: appResolvedBg.textureOpacity * 0.9,
                      contain: 'strict',
                    }}
                  />
                  <div className="absolute inset-0" style={{ background: appResolvedBg.gradientBackground }} />
                  <div className="absolute inset-0" style={{ background: appResolvedBg.veilBackground }} />
                </>
              )
            ) : null}
            {appResolvedBg.overlayOpacity > 0 && (
              <div
                className="absolute inset-0"
                style={{
                  backgroundColor: appResolvedBg.overlayColor,
                  opacity: appResolvedBg.overlayOpacity,
                }}
              />
            )}
          </div>

          <div className="relative z-10 flex-1 overflow-hidden">
            <MiniPlayer />
          </div>
        </div>
      )}
    </>
  )
}

// Queue Panel Component
function QueuePanel() {
  const playlist = usePlayerStore((s) => s.playlist)
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: playlist.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44, // approximate row height
    overscan: 10,
  })

  return (
    <div className="p-4 overflow-x-hidden h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h2 className="text-lg font-semibold truncate">播放队列</h2>
        <button onClick={() => useUIStore.getState().toggleQueuePanel()} className="btn-icon flex-shrink-0">
          <X className="w-5 h-5" />
        </button>
      </div>

      {playlist.length === 0 ? (
        <div className="text-center text-[var(--text-muted)] py-8">
          队列为空
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto overflow-x-hidden">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const index = virtualRow.index
              const song = playlist[index]
              const isCurrentSong = isSamePlayableSong(currentSong, song)
              const isCurrentlyPlaying = isCurrentSong && isPlaying

              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors group overflow-hidden',
                      isCurrentSong && 'bg-primary-500/10'
                    )}
                  >
                    {/* Song info - clickable */}
                    <button
                      onClick={() => {
                        if (isCurrentSong) {
                          usePlayerStore.getState().togglePlay()
                        } else {
                          usePlayerStore.getState().playSong(song, playlist, 'queue')
                        }
                      }}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors overflow-hidden"
                    >
                      <span className={cn(
                        'w-5 text-xs text-center flex-shrink-0',
                        isCurrentSong ? 'text-primary-500 font-medium' : 'text-[var(--text-muted)]'
                      )}>
                        {isCurrentlyPlaying ? (
                          <div className="flex gap-0.5 justify-center">
                            <span className="w-0.5 h-3 bg-primary-500 rounded-full animate-pulse" />
                            <span className="w-0.5 h-4 bg-primary-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                            <span className="w-0.5 h-2 bg-primary-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                          </div>
                        ) : (
                          index + 1
                        )}
                      </span>
                      <CoverImage
                        src={song.cover}
                        alt={song.name}
                        className="w-8 h-8 rounded flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <h4 className={cn(
                          'text-sm font-medium truncate',
                          isCurrentSong && 'text-primary-500'
                        )}>
                          {song.name}
                        </h4>
                        <p className="text-xs text-[var(--text-secondary)] truncate">{song.artist}</p>
                      </div>
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={() => usePlayerStore.getState().removeFromQueue(index)}
                      className="p-1.5 rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 transition-all flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4 text-[var(--text-muted)] hover:text-red-500" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function LyricsProgressSection({
  currentSong,
  seek,
  sliderTrackClass,
  sliderRangeClass,
  sliderThumbClass,
  textMutedClass,
  qualityTriggerClassName,
  qualityContentClassName,
  qualityItemClassName,
  qualityMutedClassName,
}: {
  currentSong: { id?: string } | null
  seek: (time: number) => void
  sliderTrackClass: string
  sliderRangeClass: string
  sliderThumbClass: string
  textMutedClass: string
  qualityTriggerClassName?: string
  qualityContentClassName?: string
  qualityItemClassName?: string
  qualityMutedClassName?: string
}) {
  const currentTime = usePlaybackProgressStore((state) => state.currentTime)
  const duration = usePlaybackProgressStore((state) => state.duration)

  return (
    <div className="mb-6 w-full max-w-xs">
      <Slider.Root
        className="group relative flex h-5 w-full touch-none select-none items-center"
        value={[currentTime]}
        max={duration || 100}
        step={1}
        onValueChange={([value]) => seek(value)}
        disabled={!currentSong}
      >
        <Slider.Track className={cn('relative h-1 grow rounded-full transition-all group-hover:h-1.5', sliderTrackClass)}>
          <Slider.Range className={cn('absolute h-full rounded-full', sliderRangeClass)} />
        </Slider.Track>
        <Slider.Thumb className={cn('block h-3 w-3 rounded-full shadow-md opacity-0 transition-opacity group-hover:opacity-100 focus:outline-none', sliderThumbClass)} />
      </Slider.Root>
      <div className={cn('mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs', textMutedClass)}>
        <span>{formatTime(currentTime)}</span>
        <PlaybackQualityMenu
          triggerClassName={qualityTriggerClassName}
          contentClassName={qualityContentClassName}
          itemClassName={qualityItemClassName}
          mutedClassName={qualityMutedClassName}
          side="top"
          align="center"
        />
        <span className="text-right">{formatTime(duration)}</span>
      </div>
    </div>
  )
}

function LyricsPlaybackSection({
  lyricData,
  lyrics,
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
}: {
  lyricData: Parameters<typeof LxLyricPlayer>[0]['lyricData']
  lyrics: Parameters<typeof LxLyricPlayer>[0]['lyrics']
  isPlaying: Parameters<typeof LxLyricPlayer>[0]['isPlaying']
  playbackRate: Parameters<typeof LxLyricPlayer>[0]['playbackRate']
  fontSize: Parameters<typeof LxLyricPlayer>[0]['fontSize']
  textAlign: Parameters<typeof LxLyricPlayer>[0]['textAlign']
  lineSpacing: Parameters<typeof LxLyricPlayer>[0]['lineSpacing']
  showWordByWord: Parameters<typeof LxLyricPlayer>[0]['showWordByWord']
  showRoman: Parameters<typeof LxLyricPlayer>[0]['showRoman']
  showTranslation: Parameters<typeof LxLyricPlayer>[0]['showTranslation']
  toneMode: Parameters<typeof LxLyricPlayer>[0]['toneMode']
  colors: Parameters<typeof LxLyricPlayer>[0]['colors']
  emptyClassName: Parameters<typeof LxLyricPlayer>[0]['emptyClassName']
  onSeek: Parameters<typeof LxLyricPlayer>[0]['onSeek']
}) {
  const currentTime = usePlaybackProgressStore((state) => state.currentTime)

  return (
    <div className="flex-1 overflow-hidden">
      <LxLyricPlayer
        lyricData={lyricData}
        lyrics={lyrics}
        currentTime={currentTime}
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        fontSize={fontSize}
        textAlign={textAlign}
        lineSpacing={lineSpacing}
        showWordByWord={showWordByWord}
        showRoman={showRoman}
        showTranslation={showTranslation}
        toneMode={toneMode}
        colors={colors}
        emptyClassName={emptyClassName}
        onSeek={onSeek}
        onLineChange={(text) => {
          if (!window.electronAPI || !text) return
          window.electronAPI.updateLyric(text)
        }}
      />
    </div>
  )
}

// Lyrics Panel Component
function LyricsPanel({
  resolvedBg,
  textureSrc,
  isCustomImage,
}: {
  resolvedBg: ResolvedBackground
  textureSrc: string | null
  isCustomImage: boolean
}) {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const playbackSessionKey = usePlayerStore((s) => s.playbackSessionKey)
  const lyrics = usePlayerStore((s) => s.lyrics)
  const lyricData = usePlayerStore((s) => s.lyricData)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isLoading = usePlayerStore((s) => s.isLoading)
  const playMode = usePlayerStore((s) => s.playMode)
  const audioEffects = usePlayerStore((s) => s.audioEffects)
  const toggleLyricsPanel = useUIStore((s) => s.toggleLyricsPanel)
  const lyricsPanelTab = useUIStore((s) => s.lyricsPanelTab)
  const setLyricsPanelTab = useUIStore((s) => s.setLyricsPanelTab)
  const lyricsLeftPanelCollapsed = useUIStore((s) => s.lyricsLeftPanelCollapsed)
  const setLyricsLeftPanelCollapsed = useUIStore((s) => s.setLyricsLeftPanelCollapsed)
  const theme = useUIStore((s) => s.theme)
  const playlists = useUserStore((s) => s.playlists)
  const localPlaylists = useUserStore((s) => s.localPlaylists)
  const isFavorite = useUserStore((s) => s.isFavorite)
  const addToFavorites = useUserStore((s) => s.addToFavorites)
  const removeFromFavorites = useUserStore((s) => s.removeFromFavorites)
  const addToPlaylist = useUserStore((s) => s.addToPlaylist)
  const addToLocalPlaylist = useUserStore((s) => s.addToLocalPlaylist)
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('lyrics-font-size')
    const parsed = saved ? parseInt(saved, 10) : 40
    return Number.isFinite(parsed) ? Math.max(16, Math.min(80, parsed)) : 40
  })
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(() => {
    const saved = localStorage.getItem('lyrics-text-align')
    return (saved as 'left' | 'center' | 'right') || 'left'
  })
  const [lineSpacing, setLineSpacing] = useState(() => {
    const saved = localStorage.getItem('lyrics-line-spacing')
    return saved ? parseInt(saved, 10) : 20
  })
  const [lyricDisplayOptions, setLyricDisplayOptions] = useState(readStoredLyricDisplayOptions)
  const showWordByWord = lyricDisplayOptions.word
  const showTranslation = lyricDisplayOptions.translation
  const showRoman = lyricDisplayOptions.roman
  const [showSettings, setShowSettings] = useState(false)
  const [showAudioTuning, setShowAudioTuning] = useState(false)
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const activeTab = lyricsPanelTab
  const setActiveTab = setLyricsPanelTab
  const canShowComments = Boolean(currentSong && currentSong.platform !== 'local')
  const isDarkAppearance = theme === 'system' ? systemPrefersDark : theme === 'dark'
  const toneMode: LyricsToneMode = isDarkAppearance ? 'dark' : 'light'
  const [lyricColors, setLyricColors] = useState<LyricColorSettings>(() => readStoredLyricColors(toneMode))
  const surfaceButtonClass = cn(
    'flex items-center justify-center rounded-full transition-colors backdrop-blur-md',
    isDarkAppearance
      ? 'bg-white/10 text-white hover:bg-white/[0.18]'
      : 'bg-white/[0.62] text-slate-800 hover:bg-white/[0.82]'
  )
  const ghostIconButtonClass = cn(
    'rounded-full transition-colors',
    isDarkAppearance
      ? 'text-white/70 hover:bg-white/10 hover:text-white'
      : 'text-slate-600 hover:bg-black/[0.05] hover:text-slate-900'
  )
  const tabButtonClass = (active: boolean) => cn(
    'flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-colors',
    active
      ? (isDarkAppearance ? 'bg-white/20 text-white' : 'bg-slate-900/10 text-slate-900')
      : (isDarkAppearance ? 'text-white/50 hover:bg-white/10 hover:text-white/80' : 'text-slate-500 hover:bg-black/[0.05] hover:text-slate-800')
  )
  const pillButtonClass = cn(
    'flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-colors',
    isDarkAppearance
      ? 'bg-white/10 text-white hover:bg-white/20'
      : 'bg-slate-900/10 text-slate-900 hover:bg-slate-900/15'
  )
  const popoverClass = cn(
    'absolute bottom-full right-0 z-[70] mb-2 max-h-[min(78vh,42rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl p-4 shadow-2xl backdrop-blur-xl',
    isDarkAppearance ? 'bg-[#14161b]/92 text-white' : 'bg-white/92 text-slate-900'
  )
  const audioTuningPopoverClass = cn(
    'w-[min(42rem,calc(100vw-3rem))] overflow-hidden rounded-[28px] border p-4 shadow-2xl backdrop-blur-2xl',
    isDarkAppearance ? 'border-white/10 bg-[#14161b]/94 text-white' : 'border-black/[0.06] bg-white/94 text-slate-900'
  )
  const menuClass = cn(
    'z-[60] min-w-[180px] rounded-xl p-1.5 shadow-xl backdrop-blur-xl',
    isDarkAppearance ? 'bg-[#14161b]/92 text-white' : 'bg-white/92 text-slate-900'
  )
  const menuItemClass = cn(
    'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none transition-colors',
    isDarkAppearance ? 'text-white hover:bg-white/10' : 'text-slate-800 hover:bg-black/[0.05]'
  )
  const settingsButtonClass = (active: boolean) => cn(
    'h-7 w-7 rounded-full flex items-center justify-center transition-colors',
    active
      ? (isDarkAppearance ? 'bg-white/30 text-white' : 'bg-slate-900/12 text-slate-900')
      : (isDarkAppearance ? 'bg-white/10 text-white/70 hover:bg-white/20' : 'bg-black/[0.05] text-slate-600 hover:bg-black/[0.08]')
  )
  const switchOnClass = isDarkAppearance ? 'bg-white/25 text-white' : 'bg-slate-900/10 text-slate-900'
  const switchOffClass = isDarkAppearance ? 'bg-white/10 text-white/60 hover:bg-white/[0.15]' : 'bg-black/[0.05] text-slate-500 hover:bg-black/[0.08]'
  const textPrimaryClass = 'text-[var(--text-primary)]'
  const textSecondaryClass = 'text-[var(--text-secondary)]'
  const textMutedClass = 'text-[var(--text-muted)]'
  const sliderTrackClass = isDarkAppearance ? 'bg-white/20' : 'bg-slate-900/10'
  const sliderRangeClass = isDarkAppearance ? 'bg-white' : 'bg-slate-900'
  const sliderThumbClass = isDarkAppearance ? 'bg-white' : 'bg-slate-900'
  const tuningCardClass = cn(
    'rounded-2xl border p-3',
    isDarkAppearance ? 'border-white/10 bg-white/[0.05]' : 'border-black/[0.06] bg-black/[0.03]'
  )
  const tuningChipClass = (active: boolean) => cn(
    'rounded-full px-3 py-1.5 text-xs transition-colors',
    active
      ? 'bg-primary-500 text-white'
      : (isDarkAppearance ? 'bg-white/10 text-white/75 hover:bg-white/15' : 'bg-black/[0.05] text-slate-600 hover:bg-black/[0.08]')
  )
  const lyricColorRows: Array<{ key: keyof LyricColorSettings; label: string }> = [
    { key: 'active', label: '正在播放句' },
    { key: 'played', label: '已播放句' },
    { key: 'unplayed', label: '未播放句' },
    { key: 'word', label: '逐字扫光' },
    { key: 'ttmlLeft', label: 'TTML 左声部' },
    { key: 'ttmlRight', label: 'TTML 右声部' },
    { key: 'ttmlBackground', label: 'TTML 背景歌词' },
  ]
  const lyricSwitchRows: Array<{ key: keyof LyricDisplayOptions; label: string }> = [
    { key: 'word', label: '逐字歌词' },
    { key: 'translation', label: '翻译' },
    { key: 'roman', label: '罗马音' },
  ]
  const toggleLyricDisplayOption = (key: keyof LyricDisplayOptions) => {
    setLyricDisplayOptions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }
  const updateLyricColor = (key: keyof LyricColorSettings, value: string) => {
    if (!isHexColor(value)) return
    setLyricColors((prev) => ({ ...prev, [key]: value }))
  }
  const resetLyricColors = () => {
    setLyricColors(DEFAULT_LYRIC_COLORS[toneMode])
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    const legacyMedia = media as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
    }

    setSystemPrefersDark(media.matches)
    if ('addEventListener' in media) {
      media.addEventListener('change', handleChange)
      return () => media.removeEventListener('change', handleChange)
    }

    legacyMedia.addListener?.(handleChange)
    return () => legacyMedia.removeListener?.(handleChange)
  }, [])

  // Persist font size
  useEffect(() => {
    localStorage.setItem('lyrics-font-size', fontSize.toString())
  }, [fontSize])

  // Persist text align
  useEffect(() => {
    localStorage.setItem('lyrics-text-align', textAlign)
  }, [textAlign])

  // Persist line spacing
  useEffect(() => {
    localStorage.setItem('lyrics-line-spacing', lineSpacing.toString())
  }, [lineSpacing])

  useEffect(() => {
    localStorage.setItem(LYRICS_OPTION_STORAGE_KEYS.word, String(lyricDisplayOptions.word))
    localStorage.setItem(LYRICS_OPTION_STORAGE_KEYS.translation, String(lyricDisplayOptions.translation))
    localStorage.setItem(LYRICS_OPTION_STORAGE_KEYS.roman, String(lyricDisplayOptions.roman))
  }, [lyricDisplayOptions])

  useEffect(() => {
    localStorage.setItem(LYRICS_COLOR_STORAGE_KEY, JSON.stringify(lyricColors))
  }, [lyricColors])

  const isSongFavorited = currentSong ? isFavorite(currentSong.id, currentSong.platform) : false
  const selectablePlaylists = currentSong?.platform === 'local' ? localPlaylists : playlists

  useEffect(() => {
    if (!canShowComments && activeTab === 'comments') {
      setActiveTab('lyrics')
    }
  }, [activeTab, canShowComments, setActiveTab])

  const adjustFontSize = (delta: number) => {
    setFontSize((prev) => Math.max(16, Math.min(80, prev + delta)))
  }

  const handleFavoriteClick = () => {
    if (!currentSong) return
    if (isSongFavorited) {
      removeFromFavorites(currentSong.id, currentSong.platform)
    } else {
      addToFavorites(currentSong)
    }
  }

  const handlePlayModeChange = () => {
    const modes: PlayMode[] = ['sequence', 'loop', 'single', 'shuffle']
    const currentIdx = modes.indexOf(playMode)
    const nextMode = modes[(currentIdx + 1) % modes.length]
    usePlayerStore.getState().setPlayMode(nextMode)
  }

  const getPlayModeIcon = () => {
    switch (playMode) {
      case 'single':
        return <Repeat1 className="w-5 h-5" />
      case 'shuffle':
        return <Shuffle className="w-5 h-5" />
      default:
        return <Repeat className="w-5 h-5" />
    }
  }

  // ESC key to close lyrics panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleLyricsPanel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleLyricsPanel])

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'tween', duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      className="fixed inset-0 z-50 flex overflow-hidden"
      style={{ touchAction: 'none', willChange: 'transform' }}
    >
      {/* Dedicated full-screen backdrop so underlying home content never shows through gaps */}
      <div
        className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
      >
        <div className="absolute inset-0" style={{ background: resolvedBg.baseColor }} />
        {textureSrc && (
          isCustomImage ? (
            <img
              src={textureSrc}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-contain"
              style={{
                filter: resolvedBg.blurPrimary > 0 ? `blur(${resolvedBg.blurPrimary}px)` : undefined,
                opacity: resolvedBg.textureOpacity,
                contain: 'strict',
              }}
            />
          ) : (
            <img
              src={textureSrc}
              alt=""
              loading="lazy"
              decoding="async"
              className={cn(
                'absolute top-1/2 left-1/2 min-w-[180%] min-h-[180%] object-cover',
                isDarkAppearance ? 'mix-blend-screen' : 'mix-blend-multiply'
              )}
              style={{
                filter: `blur(${resolvedBg.blurPrimary}px)`,
                transform: 'translate(-50%, -50%) scale(1.2)',
                opacity: resolvedBg.textureOpacity,
                contain: 'strict',
              }}
            />
          )
        )}
        {resolvedBg.overlayOpacity > 0 && (
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: resolvedBg.overlayColor,
              opacity: resolvedBg.overlayOpacity,
            }}
          />
        )}
      </div>

      {/* Reuse the main app background mood, but keep it self-contained inside the lyrics page */}
      <div className="absolute inset-0 z-0" style={{ background: resolvedBg.gradientBackground }} />
      <div className="absolute inset-0 z-0" style={{ background: resolvedBg.accentBackground }} />
      <div className="absolute inset-0 z-0" style={{ background: resolvedBg.veilBackground }} />
      {audioEffects.audioVisualizationEnabled && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-40 overflow-hidden">
          <AudioVisualizer
            className="absolute inset-x-6 bottom-2 h-32 w-[calc(100%-48px)] opacity-80"
            barColor={isDarkAppearance ? 'rgba(255,255,255,0.48)' : 'rgba(15,23,42,0.28)'}
            glowColor={isDarkAppearance ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)'}
            barCount={120}
          />
          <div className="absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-black/10 via-transparent to-transparent dark:from-black/16 dark:via-transparent dark:to-transparent" />
        </div>
      )}

      {/* Close button */}
      <button
        onClick={toggleLyricsPanel}
        className={cn(surfaceButtonClass, 'absolute right-6 top-6 z-20 h-10 w-10')}
      >
        <X className="w-6 h-6" />
      </button>

      {showAudioTuning && (
        <div className="absolute inset-0 z-[72] flex items-center justify-center px-6 py-10">
          <button
            type="button"
            aria-label="关闭调音面板"
            className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
            onClick={() => setShowAudioTuning(false)}
          />
          <div className={cn(audioTuningPopoverClass, 'relative z-[73] max-h-[min(78vh,780px)]')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">调音面板</h3>
                <p className={cn('mt-1 text-xs', textMutedClass)}>当前播放立即生效，保留和设置页同一套音效参数。</p>
              </div>
              <button
                onClick={() => setShowAudioTuning(false)}
                className={settingsButtonClass(false)}
                aria-label="关闭调音面板"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 max-h-[calc(min(78vh,780px)-4.5rem)] space-y-3 overflow-y-auto pr-1">
              <div className={tuningCardClass}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">音频可视化</p>
                    <p className={cn('mt-1 text-xs', textMutedClass)}>控制播放页底部频谱显示。</p>
                  </div>
                  <button
                    onClick={() => usePlayerStore.getState().setAudioVisualizationEnabled(!audioEffects.audioVisualizationEnabled)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs transition-colors',
                      audioEffects.audioVisualizationEnabled ? switchOnClass : switchOffClass
                    )}
                  >
                    {audioEffects.audioVisualizationEnabled ? '已开启' : '已关闭'}
                  </button>
                </div>
              </div>

              <div className={tuningCardClass}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">均衡器</p>
                    <p className={cn('mt-1 text-xs', textMutedClass)}>10 段 EQ，预设和手调都可直接试听。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => usePlayerStore.getState().resetEq()}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs transition-colors',
                        isDarkAppearance ? 'bg-white/10 text-white/80 hover:bg-white/15' : 'bg-black/[0.05] text-slate-600 hover:bg-black/[0.08]'
                      )}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      重置
                    </button>
                    <button
                      onClick={() => usePlayerStore.getState().setEqEnabled(!audioEffects.eqEnabled)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs transition-colors',
                        audioEffects.eqEnabled ? switchOnClass : switchOffClass
                      )}
                    >
                      {audioEffects.eqEnabled ? '开启' : '关闭'}
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {EQ_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => usePlayerStore.getState().setEqPreset(preset.id)}
                      className={tuningChipClass(audioEffects.eqPresetId === preset.id)}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {EQ_FREQUENCIES.map((frequency) => (
                    <label key={frequency} className={cn(
                      'rounded-xl px-2.5 py-2',
                      isDarkAppearance ? 'bg-white/[0.05]' : 'bg-white/70'
                    )}>
                      <div className="flex items-center justify-between text-[11px]">
                        <span>{frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`}</span>
                        <span className={cn(audioEffects.eqGains[frequency] > 0 ? 'text-primary-400' : textMutedClass)}>
                          {audioEffects.eqGains[frequency] > 0 ? '+' : ''}{audioEffects.eqGains[frequency]}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={1}
                        value={audioEffects.eqGains[frequency]}
                        onChange={(event) => usePlayerStore.getState().setEqGain(frequency, Number(event.target.value))}
                        className="mt-2 w-full accent-primary-500"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className={tuningCardClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">环境混响</p>
                      <p className={cn('mt-1 text-xs', textMutedClass)}>模拟空间感和尾音。</p>
                    </div>
                    <button
                      onClick={() => usePlayerStore.getState().setReverbEnabled(!audioEffects.reverbEnabled)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs transition-colors',
                        audioEffects.reverbEnabled ? switchOnClass : switchOffClass
                      )}
                    >
                      {audioEffects.reverbEnabled ? '开启' : '关闭'}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {REVERB_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => usePlayerStore.getState().setReverbPreset(preset.id)}
                        className={tuningChipClass(audioEffects.reverbPresetId === preset.id)}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>

                  <label className="mt-3 block">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span>直达声</span>
                      <span>{audioEffects.reverbMainGain}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={140}
                      step={1}
                      value={audioEffects.reverbMainGain}
                      onChange={(event) => usePlayerStore.getState().setReverbMainGain(Number(event.target.value))}
                      className="w-full accent-primary-500"
                    />
                  </label>

                  <label className="mt-3 block">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span>混响发送</span>
                      <span>{audioEffects.reverbSendGain}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={140}
                      step={1}
                      value={audioEffects.reverbSendGain}
                      onChange={(event) => usePlayerStore.getState().setReverbSendGain(Number(event.target.value))}
                      className="w-full accent-primary-500"
                    />
                  </label>
                </div>

                <div className={tuningCardClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">环绕与速率</p>
                      <p className={cn('mt-1 text-xs', textMutedClass)}>控制 3D 环绕移动与播放速度。</p>
                    </div>
                    <button
                      onClick={() => usePlayerStore.getState().setSpatialAudioEnabled(!audioEffects.spatialAudioEnabled)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs transition-colors',
                        audioEffects.spatialAudioEnabled ? switchOnClass : switchOffClass
                      )}
                    >
                      {audioEffects.spatialAudioEnabled ? '开启' : '关闭'}
                    </button>
                  </div>

                  <label className="mt-3 block">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span>环绕半径</span>
                      <span>{audioEffects.spatialAudioRadius}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={audioEffects.spatialAudioRadius}
                      onChange={(event) => usePlayerStore.getState().setSpatialAudioRadius(Number(event.target.value))}
                      className="w-full accent-primary-500"
                    />
                  </label>

                  <label className="mt-3 block">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span>环绕速度</span>
                      <span>{audioEffects.spatialAudioSpeed}%</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      step={1}
                      value={audioEffects.spatialAudioSpeed}
                      onChange={(event) => usePlayerStore.getState().setSpatialAudioSpeed(Number(event.target.value))}
                      className="w-full accent-primary-500"
                    />
                  </label>

                  <label className="mt-3 block">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span>播放速率</span>
                      <span>{audioEffects.playbackRate.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.01}
                      value={audioEffects.playbackRate}
                      onChange={(event) => usePlayerStore.getState().setPlaybackRate(Number(event.target.value))}
                      className="w-full accent-primary-500"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toggle left panel button - vertical bar on left edge */}
      <button
        onClick={() => setLyricsLeftPanelCollapsed(!lyricsLeftPanelCollapsed)}
        className={cn(
          surfaceButtonClass,
          'absolute left-0 top-1/2 z-20 h-32 w-6 -translate-y-1/2 rounded-l-none rounded-r-xl'
        )}
        title={lyricsLeftPanelCollapsed ? '展开歌曲信息' : '收起歌曲信息'}
      >
        {lyricsLeftPanelCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* Left side - Album & Controls (30%) */}
      <div
        className={cn(
          'relative z-10 flex flex-col p-6 pt-20 transition-all duration-300',
          lyricsLeftPanelCollapsed ? 'w-0 overflow-hidden p-0 opacity-0' : 'w-[32%]'
        )}
      >
        <div className="flex h-full w-full flex-col items-center justify-center px-8 py-10">
          {/* Album cover */}
          <div className="mb-8 h-64 w-64 overflow-hidden rounded-2xl shadow-2xl">
            {currentSong?.cover ? (
              <CoverImage
                key={`default-lyrics-cover-${playbackSessionKey || currentSong.id}`}
                src={currentSong.cover}
                alt={currentSong.name}
                className="h-full w-full"
              />
            ) : (
              <div className={cn(
                'flex h-full w-full items-center justify-center',
                isDarkAppearance ? 'bg-white/10' : 'bg-slate-200/80'
              )}>
                <span className={cn('text-6xl', isDarkAppearance ? 'text-white/35' : 'text-slate-400')}>♪</span>
              </div>
            )}
          </div>

          {/* Song info */}
          <div className="mb-6 w-full px-4 text-center">
            <h2 className={cn('mb-2 truncate text-2xl font-bold', textPrimaryClass)}>
              {currentSong?.name || '未播放'}
            </h2>
            <p className={cn('truncate', textSecondaryClass)}>{currentSong?.artist || '未知歌手'}</p>

            {/* Tab switcher - 歌词/评论切换按钮 */}
            {currentSong && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  onClick={() => setActiveTab('lyrics')}
                  className={tabButtonClass(activeTab === 'lyrics')}
                >
                  <Mic2 className="w-4 h-4" />
                  歌词
                </button>
                {canShowComments && (
                  <button
                    onClick={() => setActiveTab('comments')}
                    className={tabButtonClass(activeTab === 'comments')}
                  >
                    <MessageCircle className="w-4 h-4" />
                    评论
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Progress bar */}
          <LyricsProgressSection
            currentSong={currentSong}
            seek={(time) => usePlayerStore.getState().seek(time)}
            sliderTrackClass={sliderTrackClass}
            sliderRangeClass={sliderRangeClass}
            sliderThumbClass={sliderThumbClass}
            textMutedClass={textMutedClass}
            qualityTriggerClassName={cn(
              'h-6 min-w-[4.25rem] px-3 text-[11px] backdrop-blur-md',
              isDarkAppearance
                ? 'bg-white/10 text-white/80 hover:bg-white/18'
                : 'bg-slate-900/10 text-slate-700 hover:bg-slate-900/15'
            )}
            qualityContentClassName={menuClass}
            qualityItemClassName={menuItemClass}
            qualityMutedClassName={textMutedClass}
          />

          {/* Playback controls */}
          <div className="mb-6 flex items-center gap-6">
            <button
              onClick={handlePlayModeChange}
              className={cn(
                ghostIconButtonClass,
                'flex h-10 w-10 items-center justify-center',
                playMode !== 'sequence' && 'text-primary-400'
              )}
            >
              {getPlayModeIcon()}
            </button>

            <button
              onClick={() => usePlayerStore.getState().playPrevious()}
              className={cn(surfaceButtonClass, 'h-12 w-12')}
              disabled={!currentSong}
            >
              <SkipBack className="w-6 h-6" />
            </button>

              <button
                onClick={() => usePlayerStore.getState().togglePlay()}
                disabled={!currentSong || isLoading}
                className={cn(
                  'flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 disabled:opacity-50',
                  isDarkAppearance ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'
                )}
              >
                {isLoading ? (
                  <div className={cn(
                    'h-6 w-6 animate-spin rounded-full border-2 border-t-transparent',
                    isDarkAppearance ? 'border-slate-900' : 'border-white'
                  )} />
                ) : isPlaying ? (
                  <Pause className="w-7 h-7" />
                ) : (
                  <Play className="ml-1 w-7 h-7" />
                )}
              </button>

            <button
              onClick={() => usePlayerStore.getState().playNext()}
              className={cn(surfaceButtonClass, 'h-12 w-12')}
              disabled={!currentSong}
            >
              <SkipForward className="w-6 h-6" />
            </button>

            <button
              onClick={handleFavoriteClick}
              className={cn(ghostIconButtonClass, 'flex h-10 w-10 items-center justify-center')}
              disabled={!currentSong}
            >
              <Heart
                className={cn('w-5 h-5', isSongFavorited && 'fill-primary-500 text-primary-500')}
              />
            </button>
          </div>

          {/* Add to playlist & Settings */}
          <div className="flex w-full items-center justify-center gap-2">
              <button
                onClick={() => usePlayerStore.getState().setAudioVisualizationEnabled(!audioEffects.audioVisualizationEnabled)}
                className={cn(
                  pillButtonClass,
                  audioEffects.audioVisualizationEnabled && (isDarkAppearance ? 'bg-white/18 text-white' : 'bg-slate-900/14 text-slate-900')
                )}
                disabled={!currentSong}
                title={audioEffects.audioVisualizationEnabled ? '关闭音频可视化' : '开启音频可视化'}
              >
                <BarChart3 className="w-4 h-4" />
              </button>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className={pillButtonClass}
                    disabled={!currentSong}
                  >
                    <ListPlus className="w-4 h-4" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className={menuClass}
                    sideOffset={8}
                  >
                    {selectablePlaylists.length > 0 ? (
                      selectablePlaylists.map((playlist) => (
                        <DropdownMenu.Item
                          key={playlist.id}
                          className={menuItemClass}
                          onSelect={() => {
                            if (currentSong) {
                              if (currentSong.platform === 'local') {
                                addToLocalPlaylist(playlist.id, currentSong)
                              } else {
                                addToPlaylist(playlist.id, currentSong)
                              }
                            }
                          }}
                        >
                          {playlist.name}
                        </DropdownMenu.Item>
                      ))
                    ) : (
                      <div className={cn('px-3 py-2 text-sm', textMutedClass)}>{currentSong?.platform === 'local' ? '暂无本地歌单' : '暂无歌单'}</div>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              <PlaybackRateMenu
                triggerClassName={cn(
                  pillButtonClass,
                  'h-10 min-w-[4.35rem] px-3',
                  audioEffects.playbackRate !== 1 && (isDarkAppearance ? 'bg-white/18 text-white' : 'bg-slate-900/14 text-slate-900')
                )}
                contentClassName={menuClass}
                itemClassName={menuItemClass}
                mutedClassName={textMutedClass}
                side="top"
                align="center"
              />

              <div className="relative">
                <button
                  onClick={() => {
                    setShowAudioTuning((prev) => !prev)
                    setShowSettings(false)
                  }}
                  className={cn(
                    pillButtonClass,
                    'px-3',
                    showAudioTuning && (isDarkAppearance ? 'bg-white/20' : 'bg-white/[0.82]')
                  )}
                  disabled={!currentSong}
                  title="调音设置"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
              </div>

              <div className="relative">
              <button
                onClick={() => {
                  setShowSettings((prev) => !prev)
                  setShowAudioTuning(false)
                }}
                className={cn(
                  surfaceButtonClass,
                  'h-10 w-10',
                  showSettings && (isDarkAppearance ? 'bg-white/20' : 'bg-white/[0.82]')
                )}
              >
                <Settings className="w-5 h-5" />
              </button>

              {/* Settings panel - floating */}
              {showSettings && (
                <div className={popoverClass}>
                  <h3 className="mb-3 text-sm font-medium">歌词设置</h3>

                  {/* Font size */}
                  <div className="mb-3 flex items-center justify-between">
                    <span className={cn('text-xs', textSecondaryClass)}>字体大小</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => adjustFontSize(-2)}
                        className={settingsButtonClass(false)}
                      >
                        A-
                      </button>
                      <span className={cn('w-8 text-center text-xs', textMutedClass)}>{fontSize}</span>
                      <button
                        onClick={() => adjustFontSize(2)}
                        className={settingsButtonClass(false)}
                      >
                        A+
                      </button>
                    </div>
                  </div>

                  {/* Text align */}
                  <div className="mb-3 flex items-center justify-between">
                    <span className={cn('text-xs', textSecondaryClass)}>对齐方式</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setTextAlign('left')}
                        className={settingsButtonClass(textAlign === 'left')}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <line x1="3" y1="12" x2="15" y2="12" />
                          <line x1="3" y1="18" x2="18" y2="18" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setTextAlign('center')}
                        className={settingsButtonClass(textAlign === 'center')}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <line x1="6" y1="12" x2="18" y2="12" />
                          <line x1="4" y1="18" x2="20" y2="18" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setTextAlign('right')}
                        className={settingsButtonClass(textAlign === 'right')}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <line x1="9" y1="12" x2="21" y2="12" />
                          <line x1="6" y1="18" x2="21" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Line spacing */}
                  <div className="flex items-center justify-between">
                    <span className={cn('text-xs', textSecondaryClass)}>行间距</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setLineSpacing((prev) => Math.max(4, prev - 4))}
                        className={settingsButtonClass(false)}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                          <line x1="3" y1="14" x2="21" y2="14" />
                        </svg>
                      </button>
                      <span className={cn('w-8 text-center text-xs', textMutedClass)}>{lineSpacing}</span>
                      <button
                        onClick={() => setLineSpacing((prev) => Math.min(32, prev + 4))}
                        className={settingsButtonClass(false)}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="3" y1="4" x2="21" y2="4" />
                          <line x1="3" y1="12" x2="21" y2="12" />
                          <line x1="3" y1="20" x2="21" y2="20" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className={cn('mt-3 space-y-2 border-t pt-3', isDarkAppearance ? 'border-white/10' : 'border-black/[0.06]')}>
                    {lyricSwitchRows.map((item) => {
                      const enabled = lyricDisplayOptions[item.key]

                      return (
                        <div key={item.key} className="flex items-center justify-between">
                          <span className={cn('text-xs', textSecondaryClass)}>{item.label}</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={enabled}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleLyricDisplayOption(item.key)
                            }}
                            className={cn(
                              'min-w-[4.25rem] rounded-full px-2.5 py-1 text-xs transition-colors',
                              enabled ? switchOnClass : switchOffClass
                            )}
                          >
                            {enabled ? '已打开' : '未打开'}
                          </button>
                        </div>
                      )
                    })}
                  </div>

                  <div className={cn('mt-3 space-y-2 border-t pt-3', isDarkAppearance ? 'border-white/10' : 'border-black/[0.06]')}>
                    <div className="flex items-center justify-between">
                      <span className={cn('text-xs', textSecondaryClass)}>歌词颜色</span>
                      <button
                        onClick={resetLyricColors}
                        className={cn('rounded-full px-2 py-1 text-[11px] transition-colors', switchOffClass)}
                      >
                        重置
                      </button>
                    </div>
                    {lyricColorRows.map((item) => (
                      <label key={item.key} className="flex items-center justify-between gap-3">
                        <span className={cn('text-xs', textSecondaryClass)}>{item.label}</span>
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'h-5 w-5 rounded-full border shadow-sm',
                              isDarkAppearance ? 'border-white/20' : 'border-black/10',
                            )}
                            style={{ backgroundColor: lyricColors[item.key] }}
                          />
                          <input
                            type="color"
                            value={lyricColors[item.key]}
                            onChange={(event) => updateLyricColor(item.key, event.target.value)}
                            className="h-7 w-9 cursor-pointer rounded-md border-0 bg-transparent p-0"
                            aria-label={item.label}
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Lyrics & Comments */}
      <div
        className={cn(
          'relative z-10 flex flex-col pb-6 pt-20 transition-all duration-300',
          lyricsLeftPanelCollapsed ? 'w-full px-6' : 'w-[68%] pl-0 pr-6'
        )}
      >
        {/* Lyrics */}
        {activeTab === 'lyrics' && (
          <LyricsPlaybackSection
            key={`lyrics-playback-${playbackSessionKey || currentSong?.id || 'empty'}`}
            lyricData={lyricData}
            lyrics={lyrics}
            isPlaying={isPlaying}
            playbackRate={audioEffects.playbackRate}
            fontSize={fontSize}
            textAlign={textAlign}
            lineSpacing={lineSpacing}
            showWordByWord={showWordByWord}
            showRoman={showRoman}
            showTranslation={showTranslation}
            toneMode={toneMode}
            colors={lyricColors}
            emptyClassName={cn('text-xl', textMutedClass)}
            onSeek={(time) => usePlayerStore.getState().seek(time)}
          />
        )}

        {/* Comments */}
        {activeTab === 'comments' && currentSong && canShowComments && (
          <div className="flex-1 overflow-hidden px-8 py-6">
            <CommentSection
              song={currentSong}
              maxHeight="calc(100vh - 190px)"
              theme={isDarkAppearance ? 'dark' : 'light'}
            />
          </div>
        )}
      </div>
    </motion.div>
  )
}
