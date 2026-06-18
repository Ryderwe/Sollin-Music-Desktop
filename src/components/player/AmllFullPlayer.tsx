import { useEffect, useMemo, useRef, useState } from 'react'
import { LyricPlayer } from '@applemusic-like-lyrics/react'
import type { LyricPlayerRef } from '@applemusic-like-lyrics/react'
import type { LyricLineMouseEvent } from '@applemusic-like-lyrics/core'
import { motion } from 'framer-motion'
import {
  Play, Pause, SkipBack, SkipForward,
  Repeat, Repeat1, Shuffle, ChevronDown, ListMusic, Heart, Settings as SettingsIcon,
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import { useUserStore } from '@/stores/userStore'
import { usePlaybackProgressStore } from '@/stores/playbackProgressStore'
import { convertSollinLyricsToAmll } from '@/utils/amllLyricConverter'
import { cn } from '@/utils/cn'
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

const SETTINGS_POPOVER_WIDTH = 224
const SETTINGS_POPOVER_ESTIMATED_HEIGHT = 360
const SETTINGS_POPOVER_MARGIN = 16

export default function AmllFullPlayer() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const playbackSessionKey = usePlayerStore((s) => s.playbackSessionKey)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isLoading = usePlayerStore((s) => s.isLoading)
  const playMode = usePlayerStore((s) => s.playMode)
  const lyricData = usePlayerStore((s) => s.lyricData)
  const lyrics = usePlayerStore((s) => s.lyrics)
  const currentTime = usePlaybackProgressStore((s) => s.currentTime)
  const duration = usePlaybackProgressStore((s) => s.duration)
  const setShowLyricsPanel = useUIStore((s) => s.setShowLyricsPanel)
  const lyricsPlayerMode = useUIStore((s) => s.lyricsPlayerMode)
  const setLyricsPlayerMode = useUIStore((s) => s.setLyricsPlayerMode)
  const playerBackdropMode = useUIStore((s) => s.playerBackdropMode)
  const setPlayerBackdropMode = useUIStore((s) => s.setPlayerBackdropMode)
  const isFavorite = useUserStore((s) => s.isFavorite)
  const addToFavorites = useUserStore((s) => s.addToFavorites)
  const removeFromFavorites = useUserStore((s) => s.removeFromFavorites)

  const [isSeeking, setIsSeeking] = useState(false)
  const [seekValue, setSeekValue] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsPosition, setSettingsPosition] = useState({ left: 0, top: 0 })
  const [isTitleOverflow, setIsTitleOverflow] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const lyricPlayerRef = useRef<LyricPlayerRef>(null)

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
    const ref = lyricPlayerRef.current
    if (!ref?.lyricPlayer) return
    // Recalculate layout multiple times during the entry animation
    const timers = [100, 300, 600].map((delay) =>
      setTimeout(() => {
        ref.lyricPlayer?.calcLayout(true, true)
      }, delay)
    )
    return () => timers.forEach(clearTimeout)
  }, [])

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

  const handleFavoriteClick = () => {
    if (!currentSong) return
    if (isFavorite(currentSong.id, currentSong.platform)) {
      removeFromFavorites(currentSong.id, currentSong.platform)
    } else {
      addToFavorites(currentSong)
    }
  }

  const isSongFavorited = currentSong ? isFavorite(currentSong.id, currentSong.platform) : false

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
                <div className="relative mb-1 h-[1.75rem] overflow-hidden">
                  {/* Hidden plain text for overflow measurement */}
                  <h2
                    ref={titleRef}
                    className="invisible text-2xl font-bold whitespace-nowrap"
                  >
                    {currentSong?.name || '未播放'}
                  </h2>
                  {/* Visible content */}
                  {isTitleOverflow ? (
                    <div className="absolute inset-0 overflow-hidden text-2xl font-bold text-white whitespace-nowrap">
                      <span
                        className="inline-flex"
                        style={{ animation: 'title-led-scroll 8s linear infinite' }}
                      >
                        <span className="pr-8">{currentSong?.name || '未播放'}</span>
                        <span className="pr-8">{currentSong?.name || '未播放'}</span>
                      </span>
                    </div>
                  ) : (
                    <h2 className="absolute inset-0 truncate text-2xl font-bold text-white">
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
                      className="fixed z-[80] w-56 rounded-xl bg-black/80 p-3 shadow-xl ring-1 ring-white/10 backdrop-blur-xl"
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
              <Slider.Track className="relative h-[3px] w-full grow rounded-full bg-white/20 transition-all group-hover:h-1">
                <Slider.Range className="absolute h-full rounded-full bg-white" />
              </Slider.Track>
              <Slider.Thumb className="block h-3 w-3 scale-0 rounded-full bg-white shadow-lg outline-none transition-transform group-hover:scale-100" />
            </Slider.Root>
            <div className="mt-1.5 flex justify-between text-[11px] text-white/40">
              <span>{formatMs(displayTime)}</span>
              <span>{formatMs(durationMs)}</span>
            </div>
          </div>

          {/* Playback controls */}
          <div className="mt-5 flex items-center gap-8">
            <button
              onClick={cyclePlayMode}
              className={cn(
                'transition-colors',
                playMode !== 'sequence' ? 'text-white' : 'text-white/30 hover:text-white/60'
              )}
            >
              {getPlayModeIcon()}
            </button>

            <button
              onClick={() => usePlayerStore.getState().playPrevious()}
              className="text-white/80 transition-colors hover:text-white disabled:opacity-30"
              disabled={!currentSong}
            >
              <SkipBack className="h-8 w-8" fill="currentColor" />
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
              <SkipForward className="h-8 w-8" fill="currentColor" />
            </button>

            <button
              onClick={() => useUIStore.getState().toggleQueuePanel()}
              className="text-white/30 transition-colors hover:text-white/60"
            >
              <ListMusic className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Right: Lyrics */}
        <div className="relative flex w-[60%] flex-col pl-4">
          <div className="relative z-10 flex-1 min-h-0 rounded-2xl">
            <LyricPlayer
              ref={lyricPlayerRef}
              className="h-full w-full"
              lyricLines={amllLines}
              currentTime={currentTimeMs}
              playing={isPlaying}
              enableSpring={true}
              enableBlur={true}
              enableScale={true}
              alignPosition={0.45}
              wordFadeWidth={0.5}
              onLyricLineClick={handleLyricLineClick}
            />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
