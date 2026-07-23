import { useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react'
import { LyricPlayer } from '@applemusic-like-lyrics/react'
import type { LyricPlayerRef } from '@applemusic-like-lyrics/react'
import type { LyricLineMouseEvent } from '@applemusic-like-lyrics/core'
import { motion } from 'framer-motion'
import {
  Play, Pause, Rewind, FastForward,
  Repeat, Repeat1, Shuffle, ChevronDown, ListMusic, Heart, Settings as SettingsIcon,
  MessageCircle, Mic2, Trash2, Volume2, VolumeX,
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import { useUserStore } from '@/stores/userStore'
import { usePlaybackProgressStore } from '@/stores/playbackProgressStore'
import { convertSollinLyricsToAmll } from '@/utils/amllLyricConverter'
import { cn } from '@/utils/cn'
import { resolvePlaylistSourceLabel } from '@/utils/playlistSource'
import CommentSection from '@/components/CommentSection'
import CoverImage from '@/components/ui/CoverImage'
import PlayerBackdrop from '@/components/player/PlayerBackdrop'
import PlaybackRateMenu from '@/components/player/PlaybackRateMenu'
import { PLAYER_MODE_OPTIONS } from '@/constants/playerModes'
import '@applemusic-like-lyrics/core/style.css'

const formatMs = (ms: number) => {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

const SETTINGS_POPOVER_WIDTH = 280
const SETTINGS_POPOVER_ESTIMATED_HEIGHT = 640
const SETTINGS_POPOVER_MARGIN = 16
const VOLUME_WHEEL_STEP = 0.01

type SideView = 'lyrics' | 'comments' | 'queue'

type SettingsSliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  formatValue: (value: number) => string
  onChange: (value: number) => void
}

function SettingsSlider({ label, value, min, max, step, formatValue, onChange }: SettingsSliderProps) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between px-1 text-xs">
        <span className="text-white/50">{label}</span>
        <span className="tabular-nums text-white/70">{formatValue(value)}</span>
      </div>
      <Slider.Root
        className="group relative flex h-5 w-full touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([nextValue]) => onChange(nextValue)}
      >
        <Slider.Track className="relative h-1 w-full grow rounded-full bg-white/15">
          <Slider.Range className="absolute h-full rounded-full bg-white/80" />
        </Slider.Track>
        <Slider.Thumb className="block h-3.5 w-3.5 rounded-full bg-white shadow-lg outline-none ring-white/20 transition-transform group-hover:scale-110 focus:ring-4" />
      </Slider.Root>
    </div>
  )
}

export default function AmllFullPlayer() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const playbackSessionKey = usePlayerStore((s) => s.playbackSessionKey)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isLoading = usePlayerStore((s) => s.isLoading)
  const playMode = usePlayerStore((s) => s.playMode)
  const volume = usePlayerStore((s) => s.volume)
  const isMuted = usePlayerStore((s) => s.isMuted)
  const playlist = usePlayerStore((s) => s.playlist)
  const playlistId = usePlayerStore((s) => s.playlistId)
  const playlistName = usePlayerStore((s) => s.playlistName)
  const lyricData = usePlayerStore((s) => s.lyricData)
  const lyrics = usePlayerStore((s) => s.lyrics)
  const currentTime = usePlaybackProgressStore((s) => s.currentTime)
  const duration = usePlaybackProgressStore((s) => s.duration)
  const setShowLyricsPanel = useUIStore((s) => s.setShowLyricsPanel)
  const lyricsPanelTab = useUIStore((s) => s.lyricsPanelTab)
  const setLyricsPanelTab = useUIStore((s) => s.setLyricsPanelTab)
  const lyricsPlayerMode = useUIStore((s) => s.lyricsPlayerMode)
  const setLyricsPlayerMode = useUIStore((s) => s.setLyricsPlayerMode)
  const playerBackdropMode = useUIStore((s) => s.playerBackdropMode)
  const setPlayerBackdropMode = useUIStore((s) => s.setPlayerBackdropMode)
  const amllLyricSettings = useUIStore((s) => s.amllLyricSettings)
  const setAmllLyricSettings = useUIStore((s) => s.setAmllLyricSettings)
  const resetAmllLyricSettings = useUIStore((s) => s.resetAmllLyricSettings)
  const isFavorite = useUserStore((s) => s.isFavorite)
  const addToFavorites = useUserStore((s) => s.addToFavorites)
  const removeFromFavorites = useUserStore((s) => s.removeFromFavorites)

  const [isSeeking, setIsSeeking] = useState(false)
  const [seekValue, setSeekValue] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsPosition, setSettingsPosition] = useState({ left: 0, top: 0 })
  const [isTitleOverflow, setIsTitleOverflow] = useState(false)
  const [sideView, setSideView] = useState<SideView>(lyricsPanelTab)
  const settingsRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const lyricPlayerRef = useRef<LyricPlayerRef>(null)

  const recalculateLyricLayout = (delays: number[] = [0, 80, 180]) => {
    const ref = lyricPlayerRef.current
    if (!ref?.lyricPlayer) return []

    return delays.map((delay) =>
      setTimeout(() => {
        const latestRef = lyricPlayerRef.current
        if (!latestRef?.lyricPlayer) return
        void latestRef.wrapperEl?.offsetHeight
        void latestRef.lyricPlayer.calcLayout(true, true)
      }, delay)
    )
  }

  const updateSettingsPosition = () => {
    const button = settingsButtonRef.current
    if (!button) return

    const rect = button.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const preferredLeft = rect.right - SETTINGS_POPOVER_WIDTH
    const preferredTop = rect.bottom + 8
    const fallbackTop = rect.top - SETTINGS_POPOVER_ESTIMATED_HEIGHT - 8

    setSettingsPosition({
      left: Math.round(Math.min(
        Math.max(preferredLeft, SETTINGS_POPOVER_MARGIN),
        viewportWidth - SETTINGS_POPOVER_WIDTH - SETTINGS_POPOVER_MARGIN,
      )),
      top: Math.round(
        preferredTop + SETTINGS_POPOVER_ESTIMATED_HEIGHT > viewportHeight - SETTINGS_POPOVER_MARGIN
          ? Math.max(SETTINGS_POPOVER_MARGIN, fallbackTop)
          : preferredTop,
      ),
    })
  }

  // Force AMLL to recalculate layout after mount (container may have 0 height during entry animation)
  useEffect(() => {
    // Recalculate layout multiple times during the entry animation
    const timers = recalculateLyricLayout([100, 300, 600])
    return () => timers.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (sideView !== 'lyrics') return
    const timers = recalculateLyricLayout()
    return () => timers.forEach(clearTimeout)
  }, [
    sideView,
    amllLyricSettings.fontSize,
    amllLyricSettings.lineHeight,
    amllLyricSettings.lineGap,
    amllLyricSettings.alignPosition,
  ])

  // Close settings popover on outside click
  useEffect(() => {
    if (!showSettings) return
    const handleClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showSettings])

  useEffect(() => {
    if (!showSettings) return
    updateSettingsPosition()
    window.addEventListener('resize', updateSettingsPosition)
    return () => window.removeEventListener('resize', updateSettingsPosition)
  }, [showSettings])

  // Check if song title overflows
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    setIsTitleOverflow(el.scrollWidth > el.clientWidth)
  }, [playbackSessionKey, currentSong?.name])

  const amllLines = useMemo(
    () => convertSollinLyricsToAmll(lyricData, lyrics),
    [lyricData, lyrics]
  )

  const currentTimeMs = Math.round(currentTime * 1000)
  const durationMs = Math.round(duration * 1000)
  const displayTime = isSeeking ? seekValue : currentTimeMs
  const handleLyricLineClick = (e: LyricLineMouseEvent) => {
    if (!amllLines[e.lineIndex]) return
    usePlayerStore.getState().seek(amllLines[e.lineIndex].startTime / 1000)
  }

  const handleSeekStart = () => {
    setIsSeeking(true)
    setSeekValue(currentTimeMs)
  }

  const handleSeekChange = (value: number[]) => {
    setSeekValue(value[0])
  }

  const handleSeekEnd = () => {
    setIsSeeking(false)
    usePlayerStore.getState().seek(seekValue / 1000)
  }

  const handleVolumeWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const currentAudibleVolume = isMuted ? 0 : volume
    const direction = event.deltaY < 0 ? 1 : -1
    const nextVolume = Math.min(1, Math.max(0, currentAudibleVolume + direction * VOLUME_WHEEL_STEP))
    usePlayerStore.getState().setVolume(Number(nextVolume.toFixed(2)))
  }

  const handleFavoriteClick = () => {
    if (!currentSong) return
    if (isFavorite(currentSong.id, currentSong.platform)) {
      removeFromFavorites(currentSong.id, currentSong.platform)
    } else {
      addToFavorites(currentSong)
    }
  }

  const setRightSideView = (view: SideView) => {
    setSideView(view)
    if (view !== 'queue') {
      setLyricsPanelTab(view)
    }
  }

  const handleQueueSongClick = (songIndex: number) => {
    const song = playlist[songIndex]
    if (!song) return

    if (currentSong && song.id === currentSong.id && song.platform === currentSong.platform) {
      usePlayerStore.getState().togglePlay()
      return
    }

    usePlayerStore.getState().playSong(song, playlist)
  }

  const queueSourceLabel = resolvePlaylistSourceLabel(playlistId, playlistName)
  const isSongFavorited = currentSong ? isFavorite(currentSong.id, currentSong.platform) : false
  const displayedVolume = isMuted ? 0 : volume
  const volumeLabel = `${Math.round(displayedVolume * 100)}%`
  const lyricPlayerStyle = useMemo(() => ({
    '--amll-lp-font-size': `${amllLyricSettings.fontSize}px`,
    '--amll-custom-line-height': String(amllLyricSettings.lineHeight),
    '--amll-custom-line-gap': String(amllLyricSettings.lineGap),
  }) as CSSProperties, [amllLyricSettings])

  const cyclePlayMode = () => {
    const modes: Array<'sequence' | 'loop' | 'single' | 'shuffle'> = ['sequence', 'loop', 'single', 'shuffle']
    const idx = modes.indexOf(playMode)
    usePlayerStore.getState().setPlayMode(modes[(idx + 1) % modes.length])
  }

  const getPlayModeIcon = () => {
    switch (playMode) {
      case 'single': return <Repeat1 className="h-[18px] w-[18px]" />
      case 'shuffle': return <Shuffle className="h-[18px] w-[18px]" />
      default: return <Repeat className="h-[18px] w-[18px]" />
    }
  }

  const getPlayModeLabel = () => {
    switch (playMode) {
      case 'loop': return '循环'
      case 'single': return '单曲'
      case 'shuffle': return '随机'
      default: return '顺序'
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black"
    >
      <style>{`
        .amll-lyric-player {
          --amll-line-color: rgba(255,255,255,0.95) !important;
          --amll-word-active-color: white !important;
          --amll-line-active-color: white !important;
          line-height: var(--amll-custom-line-height, 1.2);
        }
        .amll-lyric-player.dom {
          line-height: var(--amll-custom-line-height, 1.2) !important;
        }
        .amll-lyric-player [class*="_lyricLine"] {
          padding-top: calc(var(--amll-custom-line-gap, 0.5) * 1em) !important;
          padding-bottom: calc(var(--amll-custom-line-gap, 0.5) * 1em) !important;
        }
        @keyframes title-led-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
      <PlayerBackdrop
        cover={currentSong?.cover}
        isPlaying={isPlaying}
        mode={playerBackdropMode}
      />

      {/* Top bar: close button */}
      <div className="relative z-20 flex items-center justify-between px-6 pt-14 pb-4">
        <button
          onClick={() => setShowLyricsPanel(false)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition-colors hover:bg-white/20"
        >
          <ChevronDown className="w-6 h-6 text-white" />
        </button>
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-white/60">正在播放</p>
        </div>
        <div className="w-10" />
      </div>

      {/* Main content area */}
      <div className="relative z-10 flex flex-1 overflow-hidden px-8 pb-4">
        {/* Left: Album cover + info */}
        <div className="flex w-[40%] flex-col items-center justify-center pr-8">
          {/* Album cover */}
          <div className={cn(
            'mb-8 aspect-square w-full max-w-[360px] overflow-hidden rounded-2xl shadow-2xl transition-all duration-500 ease-out',
            isPlaying ? 'scale-100' : 'scale-[0.88]'
          )}>
            {currentSong?.cover ? (
              <CoverImage
                key={`amll-cover-${playbackSessionKey || currentSong.id}`}
                src={currentSong.cover}
                alt={currentSong.name}
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/10">
                <span className="text-8xl text-white/30">♪</span>
              </div>
            )}
          </div>

          {/* Song info */}
          <div className="w-full max-w-[360px]">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1 text-left">
                <div className="relative mb-1 min-h-[1.35em] overflow-hidden text-2xl font-bold leading-tight text-white">
                  {/* Hidden plain text for overflow measurement */}
                  <h2
                    ref={titleRef}
                    className="invisible whitespace-nowrap"
                  >
                    {currentSong?.name || '未播放'}
                  </h2>
                  {/* Visible content */}
                  {isTitleOverflow ? (
                    <div className="absolute inset-x-0 top-0 overflow-hidden whitespace-nowrap">
                      <span
                        className="inline-flex"
                        style={{ animation: 'title-led-scroll 8s linear infinite' }}
                      >
                        <span className="pr-8">{currentSong?.name || '未播放'}</span>
                        <span className="pr-8">{currentSong?.name || '未播放'}</span>
                      </span>
                    </div>
                  ) : (
                    <h2 className="absolute inset-x-0 top-0 truncate">
                      {currentSong?.name || '未播放'}
                    </h2>
                  )}
                </div>
                <p className="truncate text-base text-white/60">
                  {currentSong?.artist || '未知歌手'}
                  {currentSong?.album && <span className="text-white/30"> · {currentSong.album}</span>}
                </p>
              </div>
              <div className="ml-3 flex items-center gap-1">
                <button
                  onClick={handleFavoriteClick}
                  className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                >
                  <Heart
                    className={cn(
                      'h-5 w-5 transition-colors',
                      isSongFavorited ? 'fill-red-500 text-red-500' : 'text-white/50 hover:text-white/80'
                    )}
                  />
                </button>
                <div className="relative" ref={settingsRef}>
                  <button
                    ref={settingsButtonRef}
                    onClick={() => {
                      updateSettingsPosition()
                      setShowSettings(!showSettings)
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
                  >
                    <SettingsIcon className="h-5 w-5" />
                  </button>
                  {showSettings && (
                    <div
                      className="scrollbar-thin fixed z-[80] max-h-[calc(100vh-32px)] w-[280px] overflow-y-auto rounded-xl bg-black/80 p-3 shadow-xl ring-1 ring-white/10 backdrop-blur-xl"
                      style={{
                        left: settingsPosition.left,
                        top: settingsPosition.top,
                      }}
                    >
                      <p className="mb-2 px-1 text-xs font-medium text-white/40">播放界面</p>
                      {PLAYER_MODE_OPTIONS.map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          onClick={() => {
                            setLyricsPlayerMode(id)
                            setShowSettings(false)
                          }}
                          className={cn(
                            'mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors first:mt-0',
                            lyricsPlayerMode === id
                              ? 'bg-white/15 text-white'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          <span>{label}</span>
                        </button>
                      ))}
                      <div className="my-3 h-px bg-white/10" />
                      <div className="flex items-center justify-between px-1">
                        <p className="text-xs font-medium text-white/40">歌词显示</p>
                        <button
                          onClick={resetAmllLyricSettings}
                          className="rounded-full px-2 py-1 text-xs text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
                        >
                          重置
                        </button>
                      </div>
                      <SettingsSlider
                        label="字号"
                        value={amllLyricSettings.fontSize}
                        min={24}
                        max={72}
                        step={1}
                        formatValue={(value) => `${Math.round(value)}px`}
                        onChange={(fontSize) => setAmllLyricSettings({ fontSize })}
                      />
                      <SettingsSlider
                        label="行高"
                        value={amllLyricSettings.lineHeight}
                        min={1}
                        max={1.8}
                        step={0.05}
                        formatValue={(value) => value.toFixed(2)}
                        onChange={(lineHeight) => setAmllLyricSettings({ lineHeight })}
                      />
                      <SettingsSlider
                        label="行距（重新进入生效）"
                        value={amllLyricSettings.lineGap}
                        min={0.2}
                        max={1.2}
                        step={0.05}
                        formatValue={(value) => value.toFixed(2)}
                        onChange={(lineGap) => setAmllLyricSettings({ lineGap })}
                      />
                      <SettingsSlider
                        label="对齐位置"
                        value={amllLyricSettings.alignPosition}
                        min={0.25}
                        max={0.65}
                        step={0.01}
                        formatValue={(value) => `${Math.round(value * 100)}%`}
                        onChange={(alignPosition) => setAmllLyricSettings({ alignPosition })}
                      />
                      <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1">
                        {([
                          ['enableBlur', '模糊'],
                          ['enableScale', '缩放'],
                        ] as const).map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => setAmllLyricSettings(
                              key === 'enableBlur'
                                ? { enableBlur: !amllLyricSettings.enableBlur }
                                : { enableScale: !amllLyricSettings.enableScale }
                            )}
                            className={cn(
                              'rounded-md px-3 py-2 text-sm transition-colors',
                              amllLyricSettings[key]
                                ? 'bg-white/16 text-white'
                                : 'text-white/54 hover:bg-white/10 hover:text-white'
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="my-3 h-px bg-white/10" />
                      <p className="mb-2 px-1 text-xs font-medium text-white/40">播放倍速</p>
                      <PlaybackRateMenu
                        triggerClassName="h-9 w-full justify-between rounded-lg bg-white/5 px-3 text-sm text-white/70 hover:bg-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
                        contentClassName="z-[90] border-white/10 bg-black/85 text-white"
                        itemClassName="text-white hover:bg-white/10 dark:hover:bg-white/10"
                        mutedClassName="text-white/40"
                        side="left"
                        align="start"
                        showIcon={false}
                      />
                      <div className="my-3 h-px bg-white/10" />
                      <p className="mb-2 px-1 text-xs font-medium text-white/40">背景效果</p>
                      <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1">
                        {([
                          ['dynamic', '动态'],
                          ['static', '静态'],
                          ['amll', 'AMLL'],
                        ] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            onClick={() => setPlayerBackdropMode(mode)}
                            className={cn(
                              'rounded-md px-3 py-2 text-sm transition-colors',
                              playerBackdropMode === mode
                                ? 'bg-white/16 text-white'
                                : 'text-white/54 hover:bg-white/10 hover:text-white'
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-6 w-full max-w-[360px]">
            <Slider.Root
              className="group relative flex h-5 w-full touch-none select-none items-center"
              value={[displayTime]}
              max={durationMs || 100}
              step={100}
              onValueChange={handleSeekChange}
              onPointerDown={handleSeekStart}
              onPointerUp={handleSeekEnd}
            >
              <Slider.Track className="relative h-[5px] w-full grow rounded-full bg-white/22 transition-all group-hover:h-[6px]">
                <Slider.Range className="absolute h-full rounded-full bg-white" />
              </Slider.Track>
              <Slider.Thumb className="block h-3.5 w-3.5 scale-0 rounded-full bg-white shadow-lg outline-none transition-transform group-hover:scale-100" />
            </Slider.Root>
            <div className="mt-1.5 flex justify-between text-[11px] text-white/40">
              <span>{formatMs(displayTime)}</span>
              <span>{formatMs(durationMs)}</span>
            </div>
          </div>

          {/* Playback controls */}
          <div className="mt-5 flex items-center gap-12">
            <button
              onClick={() => usePlayerStore.getState().playPrevious()}
              className="text-white/80 transition-colors hover:text-white disabled:opacity-30"
              disabled={!currentSong}
            >
              <Rewind className="h-9 w-9" fill="currentColor" />
            </button>

            <button
              onClick={() => usePlayerStore.getState().togglePlay()}
              disabled={!currentSong || isLoading}
              className="text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-30"
            >
              {isLoading ? (
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : isPlaying ? (
                <Pause className="h-8 w-8" fill="currentColor" />
              ) : (
                <Play className="ml-0.5 h-8 w-8" fill="currentColor" />
              )}
            </button>

            <button
              onClick={() => usePlayerStore.getState().playNext()}
              className="text-white/80 transition-colors hover:text-white disabled:opacity-30"
              disabled={!currentSong}
            >
              <FastForward className="h-9 w-9" fill="currentColor" />
            </button>
          </div>

          {/* Volume control */}
          <div
            className="mt-4 flex w-full max-w-[300px] items-center gap-3 text-white/60"
            onWheel={handleVolumeWheel}
          >
            <button
              onClick={() => usePlayerStore.getState().toggleMute()}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white"
              title="音量"
            >
              {displayedVolume === 0 ? (
                <VolumeX className="h-[18px] w-[18px]" />
              ) : (
                <Volume2 className="h-[18px] w-[18px]" />
              )}
            </button>
            <Slider.Root
              className="group relative flex h-5 flex-1 touch-none select-none items-center"
              value={[displayedVolume]}
              max={1}
              step={0.01}
              onValueChange={([value]) => usePlayerStore.getState().setVolume(value)}
            >
              <Slider.Track className="relative h-[5px] w-full grow rounded-full bg-white/22 transition-all group-hover:h-[6px]">
                <Slider.Range className="absolute h-full rounded-full bg-white/85" />
              </Slider.Track>
              <Slider.Thumb className="block h-3.5 w-3.5 rounded-full bg-white shadow-lg outline-none ring-white/20 transition-transform group-hover:scale-110 focus:ring-4" />
            </Slider.Root>
            <span className="w-9 flex-shrink-0 text-right text-xs tabular-nums text-white/45">
              {volumeLabel}
            </span>
          </div>

          <div className="mt-3 flex h-10 w-full max-w-[300px] items-center overflow-hidden rounded-xl bg-white/[0.07] p-1 text-white/60 ring-1 ring-white/10 backdrop-blur-md">
            <button
              onClick={cyclePlayMode}
              className={cn(
                'flex h-8 w-10 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
                playMode !== 'sequence'
                  ? 'bg-white/14 text-white'
                  : 'hover:bg-white/10 hover:text-white/85'
              )}
              title={`播放顺序：${getPlayModeLabel()}`}
            >
              {getPlayModeIcon()}
            </button>
            <div className="mx-1 h-5 w-px flex-shrink-0 bg-white/10" />
            <div className="grid min-w-0 flex-1 grid-cols-3 gap-1">
              {([
                ['lyrics', Mic2, '歌词'],
                ['comments', MessageCircle, '评论'],
                ['queue', ListMusic, '队列'],
              ] as const).map(([view, Icon, label]) => (
                <button
                  key={view}
                  onClick={() => setRightSideView(view)}
                  className={cn(
                    'flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors',
                    sideView === view
                      ? 'bg-white/16 text-white'
                      : 'hover:bg-white/10 hover:text-white/85'
                  )}
                >
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Lyrics / comments */}
        <div className="relative flex w-[60%] flex-col pl-4">
          <div className="relative z-10 flex-1 min-h-0 rounded-2xl">
            {sideView === 'comments' ? (
              <div className="h-full min-h-0 overflow-hidden rounded-2xl bg-black/18 p-4 ring-1 ring-white/10 backdrop-blur-md">
                <CommentSection
                  song={currentSong}
                  theme="dark"
                  className="h-full min-h-0"
                  maxHeight="calc(100vh - 210px)"
                />
              </div>
            ) : sideView === 'queue' ? (
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-black/18 p-4 ring-1 ring-white/10 backdrop-blur-md">
                <div className="mb-4 flex flex-shrink-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ListMusic className="h-5 w-5 flex-shrink-0 text-white/70" />
                      <h3 className="font-medium text-white">播放队列</h3>
                      <span className="text-sm text-white/45">({playlist.length})</span>
                    </div>
                    {queueSourceLabel && (
                      <p className="mt-1 truncate pl-7 text-xs text-white/45" title={queueSourceLabel}>
                        来自 · {queueSourceLabel}
                      </p>
                    )}
                  </div>
                  {playlist.length > 0 && (
                    <button
                      onClick={() => usePlayerStore.getState().clearQueue()}
                      className="flex-shrink-0 rounded-full px-3 py-1.5 text-sm text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
                    >
                      清空
                    </button>
                  )}
                </div>

                {playlist.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-white/40">
                    队列为空
                  </div>
                ) : (
                  <div className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                    {playlist.map((song, index) => {
                      const isCurrentQueueSong = currentSong?.id === song.id && currentSong?.platform === song.platform
                      const isCurrentPlaying = isCurrentQueueSong && isPlaying

                      return (
                        <div
                          key={`${song.platform}-${song.id}-${index}`}
                          className={cn(
                            'group flex items-center gap-2 rounded-xl p-2 transition-colors',
                            isCurrentQueueSong ? 'bg-white/10' : 'hover:bg-white/5'
                          )}
                        >
                          <button
                            onClick={() => handleQueueSongClick(index)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <span className={cn(
                              'flex h-5 w-6 flex-shrink-0 items-center justify-center text-xs tabular-nums',
                              isCurrentQueueSong ? 'text-white' : 'text-white/40'
                            )}>
                              {isCurrentPlaying ? (
                                <span className="flex items-end gap-0.5">
                                  <span className="h-2.5 w-0.5 animate-pulse rounded-full bg-white" />
                                  <span className="h-3.5 w-0.5 animate-pulse rounded-full bg-white" style={{ animationDelay: '0.2s' }} />
                                  <span className="h-2 w-0.5 animate-pulse rounded-full bg-white" style={{ animationDelay: '0.4s' }} />
                                </span>
                              ) : (
                                index + 1
                              )}
                            </span>
                            <CoverImage
                              src={song.cover}
                              alt={song.name}
                              className="h-10 w-10 flex-shrink-0 rounded-lg"
                            />
                            <div className="min-w-0 flex-1">
                              <p className={cn(
                                'truncate text-sm font-medium',
                                isCurrentQueueSong ? 'text-white' : 'text-white/85'
                              )}>
                                {song.name}
                              </p>
                              <p className="truncate text-xs text-white/45">{song.artist}</p>
                            </div>
                          </button>
                          <button
                            onClick={() => usePlayerStore.getState().removeFromQueue(index)}
                            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white/30 opacity-0 transition-all hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              <LyricPlayer
                ref={lyricPlayerRef}
                className="h-full w-full"
                style={lyricPlayerStyle}
                lyricLines={amllLines}
                currentTime={currentTimeMs}
                playing={isPlaying}
                enableSpring={true}
                enableBlur={amllLyricSettings.enableBlur}
                enableScale={amllLyricSettings.enableScale}
                alignPosition={amllLyricSettings.alignPosition}
                wordFadeWidth={0.5}
                onLyricLineClick={handleLyricLineClick}
              />
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
