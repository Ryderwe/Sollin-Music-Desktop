import { useState, useEffect, useMemo, useRef, type WheelEvent } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Shuffle,
  Volume2,
  VolumeX,
  ListMusic,
  Lock,
  Mic2,
  Heart,
  ListPlus,
  Monitor,
  MoreHorizontal,
  Share2,
  Download,
  Disc,
  Sparkles,
  PictureInPicture2,
  Timer,
  Unlock,
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlaybackProgressStore } from '@/stores/playbackProgressStore'
import { useSleepTimerCountdownStore } from '@/stores/sleepTimerStore'
import { useUserStore } from '@/stores/userStore'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import neteaseAuthApi from '@/services/neteaseAuth'
import { cn } from '@/utils/cn'
import { getPlatformColor, parseLyrics, findCurrentLyricIndex } from '@/utils/format'
import type { PlayMode } from '@/types'
import CoverImage from '@/components/ui/CoverImage'
import Tooltip from '@/components/ui/Tooltip'
import AudioVisualizer from '@/components/AudioVisualizer'
import PlaybackQualityMenu from '@/components/player/PlaybackQualityMenu'
import PlaybackRateMenu from '@/components/player/PlaybackRateMenu'
import SourceSwitchPopover from '@/components/player/SourceSwitchPopover'
import ProgressBarTop from '@/components/player/ProgressBarTop'
import { downloadManager } from '@/services/downloadManager'

const DESKTOP_LYRICS_TIMING_SYNC_INTERVAL = 0.25
const VOLUME_SLIDER_HIDE_DELAY_MS = 350
const VOLUME_WHEEL_STEP = 0.01

export default function Player() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const playbackSessionKey = usePlayerStore((s) => s.playbackSessionKey)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const volume = usePlayerStore((s) => s.volume)
  const isMuted = usePlayerStore((s) => s.isMuted)
  const playMode = usePlayerStore((s) => s.playMode)
  const isLoading = usePlayerStore((s) => s.isLoading)
  const playlist = usePlayerStore((s) => s.playlist)
  const quality = usePlayerStore((s) => s.quality)
  const currentQuality = usePlayerStore((s) => s.currentQuality)
  const manualQualityOverride = usePlayerStore((s) => s.manualQualityOverride)
  const sourceSwitch = usePlayerStore((s) => s.sourceSwitch)
  const sourceSwitchInfo = usePlayerStore((s) => s.sourceSwitchInfo)
  const sourceSwitchAlternatives = usePlayerStore((s) => s.sourceSwitchAlternatives)
  const lyricData = usePlayerStore((s) => s.lyricData)
  const lyrics = usePlayerStore((s) => s.lyrics)
  const audioEffects = usePlayerStore((s) => s.audioEffects)
  const sleepTimerMode = usePlayerStore((s) => s.sleepTimerMode)
  const sleepTimerRemainingSeconds = useSleepTimerCountdownStore((s) => s.remainingSeconds)

  const isFavorite = useUserStore((s) => s.isFavorite)
  const addToFavorites = useUserStore((s) => s.addToFavorites)
  const removeFromFavorites = useUserStore((s) => s.removeFromFavorites)
  const playlists = useUserStore((s) => s.playlists)
  const localPlaylists = useUserStore((s) => s.localPlaylists)
  const addToPlaylist = useUserStore((s) => s.addToPlaylist)
  const addToLocalPlaylist = useUserStore((s) => s.addToLocalPlaylist)
  const toggleLyricsPanel = useUIStore((s) => s.toggleLyricsPanel)
  const toggleQueuePanel = useUIStore((s) => s.toggleQueuePanel)
  const addToast = useUIStore((s) => s.addToast)
  const theme = useUIStore((s) => s.theme)
  const toggleMiniMode = useUIStore((s) => s.toggleMiniMode)
  const cookie = useAuthStore((s) => s.cookie)

  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [intelligenceLoading, setIntelligenceLoading] = useState(false)
  const [isIntelligenceMode, setIsIntelligenceMode] = useState(false)
  const [desktopLyricsEnabled, setDesktopLyricsEnabled] = useState(false)
  const [desktopLyricsLocked, setDesktopLyricsLocked] = useState(false)
  const [menuBarLyricsEnabled, setMenuBarLyricsEnabled] = useState(false)
  const [platform, setPlatform] = useState<string>('')
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const isDarkAppearance = theme === 'system' ? systemPrefersDark : theme === 'dark'

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

  // 获取平台、桌面歌词和菜单栏歌词状态
  useEffect(() => {
    if (!window.electronAPI) return

    window.electronAPI.getPlatform().then(setPlatform)
    window.electronAPI.getDesktopLyricsStatus().then(setDesktopLyricsEnabled)
    window.electronAPI.getDesktopLyricsLockStatus?.().then(setDesktopLyricsLocked)
    window.electronAPI.getMenuBarLyricsStatus?.().then(setMenuBarLyricsEnabled)

    const unsubscribeDesktopLyrics = window.electronAPI.onDesktopLyricsStatus((enabled) => {
      setDesktopLyricsEnabled(enabled)
    })
    const unsubscribeDesktopLyricsLock = window.electronAPI.onDesktopLyricsLockStatus?.((locked) => {
      setDesktopLyricsLocked(locked)
    })
    const unsubscribeMenuBarLyrics = window.electronAPI.onMenuBarLyricsStatus?.((enabled) => {
      setMenuBarLyricsEnabled(enabled)
    })

    return () => {
      unsubscribeDesktopLyrics()
      unsubscribeDesktopLyricsLock?.()
      unsubscribeMenuBarLyrics?.()
    }
  }, [])

  const titleContainerRef = useRef<HTMLDivElement>(null)
  const titleTextRef = useRef<HTMLSpanElement>(null)
  const lastLyricIndexRef = useRef(-1)
  const lastDesktopTimingRef = useRef<{ currentTime: number; isPlaying: boolean } | null>(null)
  const volumeSliderHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const parsedLyrics = useMemo(() => (lyrics ? parseLyrics(lyrics) : []), [lyrics])
  const lyricLineSyncEnabled = desktopLyricsEnabled || menuBarLyricsEnabled

  // 底栏歌词同步：仅在歌词索引变化时触发重渲染
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1)
  useEffect(() => {
    if (parsedLyrics.length === 0) {
      setCurrentLyricIndex(-1)
      return
    }
    const unsubscribe = usePlaybackProgressStore.subscribe((state) => {
      const idx = findCurrentLyricIndex(parsedLyrics, state.currentTime)
      setCurrentLyricIndex((prev) => (prev !== idx ? idx : prev))
    })
    return unsubscribe
  }, [parsedLyrics])
  useEffect(() => {
    setCurrentLyricIndex(-1)
  }, [playbackSessionKey, currentSong?.id])

  useEffect(() => {
    if (!lyricLineSyncEnabled) {
      lastLyricIndexRef.current = -1
    }
  }, [lyricLineSyncEnabled, playbackSessionKey, currentSong?.id])

  // 检测标题文字是否溢出，需要滚动
  useEffect(() => {
    const container = titleContainerRef.current
    const text = titleTextRef.current
    if (!container || !text) return

    let anim: Animation | null = null
    const SPEED = 240 // px/s

    const setup = () => {
      const overflow = text.scrollWidth - container.clientWidth

      anim?.cancel()
      if (overflow > 0) {
        const duration = (text.scrollWidth + container.clientWidth) / SPEED * 1000
        const pauseMs = 2000
        anim = text.animate(
          [
            { transform: 'translateX(0)', offset: 0 },
            { transform: 'translateX(0)', offset: pauseMs / (duration + pauseMs) },
            { transform: `translateX(${-overflow}px)`, offset: 1 },
          ],
          { duration: duration + pauseMs, iterations: Infinity },
        )
      }
    }

    setup()
    const observer = new ResizeObserver(setup)
    observer.observe(container)
    observer.observe(text)
    return () => { observer.disconnect(); anim?.cancel() }
  }, [playbackSessionKey, currentSong?.id, currentSong?.name, currentSong?.artist])

  // Current lyric sync for floating desktop lyrics and macOS menu bar lyrics.
  useEffect(() => {
    if (!window.electronAPI || !lyricLineSyncEnabled || parsedLyrics.length === 0) return

    const unsubscribe = usePlaybackProgressStore.subscribe((state) => {
      const currentTime = state.currentTime
      const currentIndex = findCurrentLyricIndex(parsedLyrics, currentTime)

      if (currentIndex !== lastLyricIndexRef.current && currentIndex >= 0) {
        lastLyricIndexRef.current = currentIndex
        const currentLyric = parsedLyrics[currentIndex]?.text || ''
        window.electronAPI!.updateLyric(currentLyric)
      }
    })

    return unsubscribe
  }, [lyricLineSyncEnabled, parsedLyrics])

  const desktopLyricsStaticPayload = useMemo(() => (
    {
      song: currentSong
        ? {
            id: currentSong.id,
            name: currentSong.name,
            artist: currentSong.artist,
            album: currentSong.album,
            platform: currentSong.platform,
          }
        : null,
      lyricData: lyricData
        ? {
            lyric: lyricData.lyric,
            tlyric: lyricData.tlyric,
            rlyric: lyricData.rlyric,
            lxlyric: lyricData.lxlyric,
          }
        : null,
      lyrics,
    }
  ), [
    currentSong?.album,
    currentSong?.artist,
    currentSong?.id,
    currentSong?.name,
    currentSong?.platform,
    playbackSessionKey,
    lyricData,
    lyrics,
  ])

  useEffect(() => {
    if (!window.electronAPI?.syncDesktopLyrics || !desktopLyricsEnabled) return

    // Send full payload once when song/lyrics change
    const currentTime = usePlaybackProgressStore.getState().currentTime
    const nextTime = Number(currentTime.toFixed(3))
    lastDesktopTimingRef.current = { currentTime: nextTime, isPlaying }
    window.electronAPI.syncDesktopLyrics({
      ...desktopLyricsStaticPayload,
      currentTime: nextTime,
      isPlaying,
    })
  }, [desktopLyricsEnabled, desktopLyricsStaticPayload, isPlaying])

  // Subscribe to progress updates for desktop lyrics timing sync (no re-renders)
  useEffect(() => {
    if (!window.electronAPI?.syncDesktopLyrics || !desktopLyricsEnabled) return

    const unsubscribe = usePlaybackProgressStore.subscribe((state) => {
      const nextTime = Number(state.currentTime.toFixed(3))
      const previous = lastDesktopTimingRef.current
      const currentIsPlaying = usePlayerStore.getState().isPlaying
      const shouldSync = !previous
        || previous.isPlaying !== currentIsPlaying
        || Math.abs(nextTime - previous.currentTime) >= DESKTOP_LYRICS_TIMING_SYNC_INTERVAL

      if (!shouldSync) return

      lastDesktopTimingRef.current = { currentTime: nextTime, isPlaying: currentIsPlaying }
      window.electronAPI!.syncDesktopLyrics({
        currentTime: nextTime,
        isPlaying: currentIsPlaying,
      })
    })

    return unsubscribe
  }, [desktopLyricsEnabled])

  // 获取副歌时间标记 - moved to ProgressBar component

  const handleFavoriteClick = () => {
    if (!currentSong) return

    if (isFavorite(currentSong.id, currentSong.platform)) {
      removeFromFavorites(currentSong.id, currentSong.platform)
    } else {
      addToFavorites(currentSong)
    }
  }

  const handlePlayModeChange = () => {
    const modes: PlayMode[] = ['sequence', 'loop', 'single', 'shuffle']
    const currentIndex = modes.indexOf(playMode)
    const nextMode = modes[(currentIndex + 1) % modes.length]
    usePlayerStore.getState().setPlayMode(nextMode)
  }

  const getPlayModeIcon = () => {
    switch (playMode) {
      case 'single':
        return <Repeat1 className="w-4 h-4" />
      case 'shuffle':
        return <Shuffle className="w-4 h-4" />
      default:
        return <Repeat className="w-4 h-4" />
    }
  }

  const getPlayModeTooltip = () => {
    switch (playMode) {
      case 'sequence':
        return '顺序播放'
      case 'loop':
        return '列表循环'
      case 'single':
        return '单曲循环'
      case 'shuffle':
        return '随机播放'
    }
  }

  const isSongFavorited = currentSong ? isFavorite(currentSong.id, currentSong.platform) : false
  const sleepTimerLabel = sleepTimerMode === 'timer'
    ? formatTimerCountdown(sleepTimerRemainingSeconds)
    : sleepTimerMode === 'songEnd'
      ? '播完停止'
      : ''

  const clearVolumeSliderHideTimer = () => {
    if (!volumeSliderHideTimerRef.current) return
    clearTimeout(volumeSliderHideTimerRef.current)
    volumeSliderHideTimerRef.current = null
  }

  const showVolumeControls = () => {
    clearVolumeSliderHideTimer()
    setShowVolumeSlider(true)
  }

  const scheduleHideVolumeControls = () => {
    clearVolumeSliderHideTimer()
    volumeSliderHideTimerRef.current = setTimeout(() => {
      setShowVolumeSlider(false)
      volumeSliderHideTimerRef.current = null
    }, VOLUME_SLIDER_HIDE_DELAY_MS)
  }

  const handleVolumeWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    showVolumeControls()

    const currentAudibleVolume = isMuted ? 0 : volume
    const direction = event.deltaY < 0 ? 1 : -1
    const nextVolume = Math.min(1, Math.max(0, currentAudibleVolume + direction * VOLUME_WHEEL_STEP))
    usePlayerStore.getState().setVolume(Number(nextVolume.toFixed(2)))
  }

  useEffect(() => {
    return () => {
      if (volumeSliderHideTimerRef.current) {
        clearTimeout(volumeSliderHideTimerRef.current)
      }
    }
  }, [])

  // 保存原始播放列表用于关闭心动模式时恢复
  const [originalPlaylist, setOriginalPlaylist] = useState<typeof playlist>([])
  const [originalPlaylistId, setOriginalPlaylistId] = useState<string>('')

  // 心动模式 - 只对小芸音乐歌曲有效
  const handleIntelligenceMode = async () => {
    if (!currentSong || currentSong.platform !== 'netease' || !cookie) {
      addToast({ type: 'warning', message: '心动模式仅支持小芸音乐' })
      return
    }

    // 如果已经是心动模式，则关闭
    if (isIntelligenceMode) {
      setIsIntelligenceMode(false)
      // 恢复原始播放列表
      if (originalPlaylist.length > 0) {
        usePlayerStore.getState().setPlaylist(originalPlaylist, originalPlaylistId)
      }
      addToast({ type: 'info', message: '已关闭心动模式' })
      return
    }

    setIntelligenceLoading(true)
    try {
      // 保存当前播放列表
      const currentPlaylistId = usePlayerStore.getState().playlistId || ''
      setOriginalPlaylist([...playlist])
      setOriginalPlaylistId(currentPlaylistId)

      // 使用当前歌曲和当前播放列表ID
      const playlistIdMatch = currentPlaylistId.match(/netease-playlist-(\d+)/)
      const pid = playlistIdMatch ? playlistIdMatch[1] : currentSong.albumId || currentSong.id

      const intelligenceSongs = await neteaseAuthApi.getIntelligenceList(
        currentSong.id,
        pid,
        undefined,
        cookie
      )

      if (intelligenceSongs.length > 0) {
        // 将当前歌曲放在最前面
        const newPlaylist = [currentSong, ...intelligenceSongs]
        setIsIntelligenceMode(true)
        usePlayerStore.getState().setPlaylist(newPlaylist, `netease-intelligence-${pid}`)
        addToast({ type: 'success', message: '已开启心动模式 💗' })
      } else {
        addToast({ type: 'warning', message: '暂无推荐歌曲' })
      }
    } catch (error) {
      console.error('Intelligence mode error:', error)
      addToast({ type: 'error', message: '心动模式启动失败' })
    } finally {
      setIntelligenceLoading(false)
    }
  }

  // 检查是否是小芸音乐歌曲
  const isNeteaseSong = currentSong?.platform === 'netease'

  const selectablePlaylists = currentSong?.platform === 'local' ? localPlaylists : playlists

  return (
    <div className="fixed bottom-0 left-0 right-0 h-20 bg-[var(--panel-bg)] z-40"
      style={{ backdropFilter: 'blur(var(--panel-backdrop-blur))' }}>
      {/* Progress bar as top border */}
      <ProgressBarTop
        songId={currentSong?.id}
        songPlatform={currentSong?.platform}
        songCover={currentSong?.cover}
        disabled={!currentSong}
      />
      {audioEffects.audioVisualizationEnabled && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 overflow-hidden">
          <div className="absolute inset-x-3 bottom-2 top-2 rounded-[28px] bg-white/[0.04] dark:bg-white/[0.03] backdrop-blur-[2px]" />
          <AudioVisualizer
            className="absolute inset-x-2 bottom-1 h-[68px] w-[calc(100%-16px)] opacity-75"
            barColor={isDarkAppearance ? 'rgba(250,250,250,0.42)' : 'rgba(15,23,42,0.22)'}
            glowColor={isDarkAppearance ? 'rgba(255,255,255,0.08)' : 'rgba(59,130,246,0.06)'}
            barCount={96}
          />
          <div className="absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-white/14 via-transparent to-transparent dark:from-black/10 dark:via-transparent dark:to-transparent" />
        </div>
      )}
      <div className="relative z-10 h-full flex items-center px-6 gap-4">
        {/* Song info */}
        <div className="flex items-stretch gap-3 w-80 min-w-0">
          {currentSong ? (
            <>
              <button
                onClick={toggleLyricsPanel}
                className="relative group cursor-pointer flex-shrink-0"
                title="查看歌词"
              >
                <CoverImage
                  src={currentSong.cover}
                  alt={currentSong.name}
                  className="w-14 h-14 rounded-lg shadow-lg transition-transform hover:scale-105"
                />
                <div
                  className="absolute bottom-1 right-1 w-2 h-2 rounded-full"
                  style={{ backgroundColor: getPlatformColor(currentSong.platform) }}
                  title={currentSong.platform}
                />
              </button>
              <div className="min-w-0 flex-1 h-14 flex flex-col justify-between pb-0.5">
                <div ref={titleContainerRef} className="overflow-hidden whitespace-nowrap">
                  <span ref={titleTextRef} className="inline-block font-medium text-sm">
                    {currentSong.name} <span className="text-xs text-[var(--text-muted)] font-normal">- {currentSong.artist}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1 min-w-0">
                  <PlaybackQualityMenu
                    triggerClassName="h-5 min-w-[3.5rem] px-2 text-[10px] bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-500/15 dark:text-primary-200 dark:hover:bg-primary-500/25"
                    contentClassName="z-[90]"
                    side="top"
                    align="start"
                  />
                  {currentQuality && currentQuality !== quality && !manualQualityOverride && (
                    <span className="px-2 py-0.5 text-[10px] rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                      已自动降级
                    </span>
                  )}
                  {sourceSwitch && (
                    sourceSwitchInfo ? (
                      <SourceSwitchPopover
                        info={sourceSwitchInfo}
                        fallbackLabel={sourceSwitch}
                        alternatives={sourceSwitchAlternatives}
                      />
                    ) : (
                      <Tooltip
                        side="top"
                        align="start"
                        content={
                          <span className="text-[11px] text-[var(--text-secondary)]">{sourceSwitch}</span>
                        }
                      >
                        <span className="px-2 py-0.5 text-[10px] rounded-full bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 truncate cursor-help">
                          临时换源
                        </span>
                      </Tooltip>
                    )
                  )}
                </div>
              </div>
            </>
          ) : playlist.length > 0 ? (
            // Show first song in queue as preview
            <>
              <div className="relative group opacity-60">
                <CoverImage
                  src={playlist[0].cover}
                  alt={playlist[0].name}
                  className="w-14 h-14 rounded-lg shadow-lg"
                />
              </div>
              <div className="min-w-0 flex-1 opacity-60">
                <h4 className="font-medium text-sm truncate">{playlist[0].name}</h4>
                <p className="text-xs text-[var(--text-secondary)] truncate">点击播放开始</p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 text-[var(--text-muted)]">
              <div className="w-14 h-14 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <Disc className="w-6 h-6" />
              </div>
              <span className="text-sm">搜索歌曲开始播放</span>
            </div>
          )}
        </div>

        {/* Player controls */}
        <div className="flex-1 flex flex-col items-center gap-1 max-w-2xl mx-auto">
          {/* 歌词行 */}
          {currentSong && parsedLyrics.length > 0 && (
            <div className="w-full flex items-center justify-between px-8 h-5">
              <span className="text-xs font-semibold text-[var(--text-primary)] truncate max-w-[40%]">
                {currentLyricIndex >= 0 ? parsedLyrics[currentLyricIndex]?.text || '' : ''}
              </span>
              <span className="text-xs font-medium text-[var(--text-secondary)] truncate max-w-[40%] text-right">
                {currentLyricIndex >= 0 && currentLyricIndex + 1 < parsedLyrics.length
                  ? parsedLyrics[currentLyricIndex + 1]?.text || ''
                  : ''}
              </span>
            </div>
          )}
          {/* Control buttons */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleFavoriteClick}
              className="btn-icon"
              disabled={!currentSong}
            >
              <Heart
                className={cn(
                  'w-5 h-5 transition-colors',
                  isSongFavorited ? 'fill-primary-500 text-primary-500' : ''
                )}
              />
            </button>

            <button
              onClick={handlePlayModeChange}
              className={cn(
                'btn-icon',
                playMode !== 'sequence' && 'text-primary-500'
              )}
              title={getPlayModeTooltip()}
            >
              {getPlayModeIcon()}
            </button>

            <button onClick={() => usePlayerStore.getState().playPrevious()} className="btn-icon" disabled={!currentSong}>
              <SkipBack className="w-5 h-5" />
            </button>

            <button
              onClick={() => usePlayerStore.getState().togglePlay()}
              disabled={(!currentSong && playlist.length === 0) || isLoading}
              className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center',
                'bg-primary-500 text-white hover:bg-primary-600',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'transition-all duration-200'
              )}
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" />
              )}
            </button>

            <button onClick={() => usePlayerStore.getState().playNext()} className="btn-icon" disabled={!currentSong}>
              <SkipForward className="w-5 h-5" />
            </button>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="btn-icon" disabled={!currentSong}>
                  <ListPlus className="w-5 h-5" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-50 min-w-[160px] rounded-lg bg-[var(--panel-bg)] p-1 shadow-lg border border-[var(--border)]"
                  sideOffset={8}
                >
                  {selectablePlaylists.length > 0 ? (
                    selectablePlaylists.map((pl) => (
                      <DropdownMenu.Item
                        key={pl.id}
                        className="px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-[var(--hover-bg)] outline-none"
                        onSelect={() => {
                          if (currentSong) {
                            if (currentSong.platform === 'local') {
                              addToLocalPlaylist(pl.id, currentSong)
                            } else {
                              addToPlaylist(pl.id, currentSong)
                            }
                          }
                        }}
                      >
                        {pl.name}
                      </DropdownMenu.Item>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-[var(--text-muted)]">
                      {currentSong?.platform === 'local' ? '暂无本地歌单' : '暂无歌单'}
                    </div>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <button onClick={toggleLyricsPanel} className="btn-icon" disabled={!currentSong}>
              <Mic2 className="w-4 h-4" />
            </button>

            {/* 心动模式按钮 - 仅小芸音乐歌曲显示 */}
            {isNeteaseSong && (
              <button
                onClick={handleIntelligenceMode}
                disabled={!currentSong || intelligenceLoading}
                className={cn(
                  'btn-icon relative',
                  isIntelligenceMode && 'text-pink-500 bg-pink-500/10'
                )}
                title={isIntelligenceMode ? '关闭心动模式' : '开启心动模式'}
              >
                <Sparkles className={cn(
                  'w-4 h-4',
                  intelligenceLoading && 'animate-spin',
                  isIntelligenceMode && 'text-pink-500'
                )} />
                {isIntelligenceMode && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-pink-500 rounded-full animate-pulse" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 w-64 justify-end">
          {/* Volume */}
          <div
            className="relative flex items-center"
            onMouseEnter={showVolumeControls}
            onMouseLeave={scheduleHideVolumeControls}
            onWheel={handleVolumeWheel}
          >
            <button
              onClick={() => usePlayerStore.getState().toggleMute()}
              className="btn-icon"
              title="音量"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-5 h-5" />
              ) : (
                <Volume2 className="w-5 h-5" />
              )}
            </button>

            {showVolumeSlider && (
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2"
                onMouseEnter={showVolumeControls}
                onMouseLeave={scheduleHideVolumeControls}
              >
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
                  <Slider.Root
                    className="relative flex flex-col items-center select-none touch-none h-24 w-4"
                    orientation="vertical"
                    value={[isMuted ? 0 : volume]}
                    max={1}
                    step={0.01}
                    onValueChange={([value]) => usePlayerStore.getState().setVolume(value)}
                  >
                    <Slider.Track className="bg-gray-200 dark:bg-gray-700 relative grow rounded-full w-1">
                      <Slider.Range className="absolute bg-primary-500 rounded-full w-full" />
                    </Slider.Track>
                    <Slider.Thumb className="block w-3 h-3 bg-white shadow-md rounded-full focus:outline-none" />
                  </Slider.Root>
                </div>
              </div>
            )}
          </div>

          {/* Queue */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className={cn(
                  'btn-icon relative',
                  sleepTimerMode && 'text-primary-500 bg-primary-500/10'
                )}
                title={sleepTimerLabel ? `定时停止：${sleepTimerLabel}` : '定时停止'}
              >
                <Timer className="w-5 h-5" />
                {sleepTimerMode && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary-500" />
                )}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-[180px] bg-white dark:bg-gray-800 rounded-xl p-1.5 shadow-xl border border-gray-200 dark:border-gray-700 animate-scale-in z-50"
                sideOffset={8}
                align="end"
              >
                {sleepTimerLabel && (
                  <>
                    <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                      当前：{sleepTimerLabel}
                    </div>
                    <DropdownMenu.Separator className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
                  </>
                )}
                {[15, 30, 60, 90].map((minutes) => (
                  <DropdownMenu.Item
                    key={minutes}
                    className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                    onSelect={() => {
                      usePlayerStore.getState().startSleepTimer(minutes * 60)
                      addToast({ type: 'success', message: `将在 ${minutes} 分钟后停止播放` })
                    }}
                  >
                    <Timer className="w-4 h-4" />
                    {minutes} 分钟后停止
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Item
                  className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                  disabled={!currentSong}
                  onSelect={() => {
                    usePlayerStore.getState().stopAfterCurrentSong()
                    addToast({ type: 'success', message: '将在当前歌曲结束后停止播放' })
                  }}
                >
                  <Timer className="w-4 h-4" />
                  当前歌曲结束后停止
                </DropdownMenu.Item>
                {sleepTimerMode && (
                  <>
                    <DropdownMenu.Separator className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
                    <DropdownMenu.Item
                      className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 outline-none"
                      onSelect={() => {
                        usePlayerStore.getState().stopSleepTimer()
                        addToast({ type: 'info', message: '已取消定时停止' })
                      }}
                    >
                      取消定时停止
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <PlaybackRateMenu
            triggerClassName="h-9 min-w-[3.75rem] bg-transparent px-2 text-[12px] hover:bg-[var(--hover-bg)] dark:bg-transparent dark:hover:bg-white/10"
            contentClassName="z-50"
            side="top"
            align="end"
          />

          <button onClick={toggleQueuePanel} className="btn-icon">
            <ListMusic className="w-5 h-5" />
          </button>

          <button onClick={toggleMiniMode} className="btn-icon" title="迷你模式">
            <PictureInPicture2 className="w-5 h-5" />
          </button>

          {/* More options */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="btn-icon" disabled={!currentSong}>
                <MoreHorizontal className="w-5 h-5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-[180px] bg-white dark:bg-gray-800 rounded-xl p-1.5 shadow-xl border border-gray-200 dark:border-gray-700 animate-scale-in z-50"
                sideOffset={8}
                align="end"
              >
                <DropdownMenu.Item
                  className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                  onSelect={() => {
                    if (currentSong) {
                      navigator.clipboard.writeText(`${currentSong.name} - ${currentSong.artist}`)
                    }
                  }}
                >
                  <Share2 className="w-4 h-4" />
                  复制歌曲信息
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
                {currentSong && currentSong.platform !== 'local' && (
                  <DropdownMenu.Item
                    className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                    onSelect={async () => {
                      if (!currentSong) return
                      try {
                        addToast({ type: 'info', message: '开始下载，已加入下载队列' })
                        const result = await downloadManager.downloadSong(currentSong)
                        addToast({
                          type: result.warning ? 'warning' : 'success',
                          message: result.warning || '下载完成并写入元数据',
                        })
                      } catch (error) {
                        addToast({
                          type: 'error',
                          message: error instanceof Error ? error.message : '下载失败',
                        })
                      }
                    }}
                  >
                    <Download className="w-4 h-4" />
                    下载歌曲
                  </DropdownMenu.Item>
                )}

                {/* 歌词窗口选项 - 仅 Electron 环境显示 */}
                {window.electronAPI && (
                  <>
                    <DropdownMenu.Separator className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
                    {platform === 'darwin' && (
                      <DropdownMenu.Item
                        className="flex items-center justify-between px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                        onSelect={(e) => {
                          e.preventDefault()
                          window.electronAPI?.toggleMenuBarLyrics()
                        }}
                      >
                        <span className="flex items-center gap-3">
                          <Mic2 className="w-4 h-4" />
                          菜单栏歌词
                        </span>
                        <span className={cn(
                          'w-8 h-4 rounded-full transition-colors relative',
                          menuBarLyricsEnabled ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'
                        )}>
                          <span className={cn(
                            'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform',
                            menuBarLyricsEnabled ? 'translate-x-4' : 'translate-x-0.5'
                          )} />
                        </span>
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Item
                      className="flex items-center justify-between px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                      onSelect={(e) => {
                        e.preventDefault()
                        window.electronAPI?.toggleDesktopLyrics()
                      }}
                    >
                      <span className="flex items-center gap-3">
                        <Monitor className="w-4 h-4" />
                        桌面歌词
                      </span>
                      <span className={cn(
                        'w-8 h-4 rounded-full transition-colors relative',
                        desktopLyricsEnabled ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'
                      )}>
                        <span className={cn(
                          'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform',
                          desktopLyricsEnabled ? 'translate-x-4' : 'translate-x-0.5'
                        )} />
                      </span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none disabled:cursor-not-allowed disabled:opacity-50',
                        desktopLyricsLocked && 'text-primary-500'
                      )}
                      disabled={!desktopLyricsEnabled}
                      onSelect={() => {
                        const nextLocked = !desktopLyricsLocked
                        setDesktopLyricsLocked(nextLocked)
                        if (nextLocked) {
                          window.electronAPI?.lockDesktopLyrics()
                          addToast({ type: 'success', message: '已锁定桌面歌词' })
                        } else {
                          window.electronAPI?.unlockDesktopLyrics()
                          addToast({ type: 'success', message: '已解锁桌面歌词' })
                        }
                      }}
                    >
                      {desktopLyricsLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                      {desktopLyricsLocked ? '解锁桌面歌词' : '锁定桌面歌词'}
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </div>
  )
}

function formatTimerCountdown(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const restSeconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
}
