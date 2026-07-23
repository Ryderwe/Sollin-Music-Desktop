import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronDown, Heart, ListMusic, Maximize, Minimize,
  Pause, Play, Repeat, Repeat1, Scan, Shuffle, SkipBack, SkipForward,
  SlidersHorizontal, Trash2, Volume2, VolumeX,
} from 'lucide-react'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlaybackProgressStore } from '@/stores/playbackProgressStore'
import { useUIStore } from '@/stores/uiStore'
import { useUserStore } from '@/stores/userStore'
import { cn } from '@/utils/cn'
import { resolvePlaylistSourceLabel } from '@/utils/playlistSource'
import { convertLyricsToMineradio } from '@/utils/mineradioLyricConverter'
import { isGatewayCoverUrl, resolveCoverUrl } from '@/services/officialCoverApi'
import { createMineradioEngine } from '@/vendor/mineradio/engine'
import type { MineradioEngine } from '@/vendor/mineradio/engine'
import MineradioFxPanel from '@/components/player/MineradioFxPanel'
import CoverImage from '@/components/ui/CoverImage'
import '@/vendor/mineradio/mineradio.css'

// 控制条玻璃色散滤镜（提取自 Mineradio index.html，feImage 位移贴图由引擎按控制条尺寸实时生成）
const CONTROL_GLASS_SVG = `
<svg id="control-glass-svg" class="control-glass-filter-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;pointer-events:none">
  <defs>
    <filter id="mineradio-control-glass-filter" color-interpolation-filters="sRGB" x="-12%" y="-28%" width="124%" height="156%">
      <feImage id="control-glass-map" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"></feImage>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="180" xChannelSelector="R" yChannelSelector="B" result="dispRed"></feDisplacementMap>
      <feOffset in="dispRed" dx="-90" dy="0" result="dispRedShifted"></feOffset>
      <feMerge result="dispRedAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispRedShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispRedAligned" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"></feColorMatrix>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="170" xChannelSelector="R" yChannelSelector="B" result="dispGreen"></feDisplacementMap>
      <feOffset in="dispGreen" dx="-90" dy="0" result="dispGreenShifted"></feOffset>
      <feMerge result="dispGreenAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispGreenShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispGreenAligned" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"></feColorMatrix>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="160" xChannelSelector="R" yChannelSelector="B" result="dispBlue"></feDisplacementMap>
      <feOffset in="dispBlue" dx="-90" dy="0" result="dispBlueShifted"></feOffset>
      <feMerge result="dispBlueAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispBlueShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispBlueAligned" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"></feColorMatrix>
      <feBlend in="red" in2="green" mode="screen" result="rg"></feBlend>
      <feBlend in="rg" in2="blue" mode="screen" result="output"></feBlend>
      <feGaussianBlur in="output" stdDeviation="0.5"></feGaussianBlur>
    </filter>
  </defs>
</svg>`

const formatTime = (seconds: number) => {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const min = Math.floor(total / 60)
  const sec = total % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

const VOLUME_WHEEL_STEP = 0.02

export default function MineradioFullPlayer() {
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
  const isFavorite = useUserStore((s) => s.isFavorite)
  const addToFavorites = useUserStore((s) => s.addToFavorites)
  const removeFromFavorites = useUserStore((s) => s.removeFromFavorites)

  const rootRef = useRef<HTMLDivElement>(null)
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const albumBgRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<MineradioEngine | null>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)

  const [engineReady, setEngineReady] = useState(false)
  const [, setFxVersion] = useState(0)
  const [beatChip, setBeatChip] = useState({ visible: false, text: '' })
  const [immersive, setImmersive] = useState(false)
  const [fxPanelOpen, setFxPanelOpen] = useState(false)
  const [miniQueueOpen, setMiniQueueOpen] = useState(false)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)
  const [seekPreview, setSeekPreview] = useState<number | null>(null)

  // ---------- 引擎生命周期 ----------
  useEffect(() => {
    const root = rootRef.current
    const canvasContainer = canvasContainerRef.current
    const albumBg = albumBgRef.current
    if (!root || !canvasContainer || !albumBg) return

    let engine: MineradioEngine | null = null
    try {
      engine = createMineradioEngine({
        canvasContainer,
        albumBg,
        overlayRoot: root,
        audio: usePlayerStore.getState().audioRef,
        assetBase: `${import.meta.env.BASE_URL || './'}mineradio/`,
        toast: (message) => useUIStore.getState().addToast({ type: 'info', message }),
        onFxChange: () => setFxVersion((v) => v + 1),
        onBeatChip: (state) => setBeatChip(state),
        onImmersiveChange: (on) => setImmersive(on),
      })
    } catch (error) {
      console.error('[mineradio] engine init failed:', error)
      return
    }

    engineRef.current = engine
    setEngineReady(true)

    const audio = usePlayerStore.getState().audioRef
    const handleSeeked = () => engine?.notifySeek()
    audio?.addEventListener('seeked', handleSeeked)

    return () => {
      audio?.removeEventListener('seeked', handleSeeked)
      setEngineReady(false)
      engineRef.current = null
      engine?.destroy()
    }
  }, [])

  // ---------- 数据桥接 ----------
  // Sollin 的封面可能是需要异步解析的网关地址（isGatewayCoverUrl），
  // 引擎的封面粒子管线需要可直接加载的图片 URL。
  const [resolvedCover, setResolvedCover] = useState('')
  useEffect(() => {
    let cancelled = false
    const raw = currentSong?.cover || ''
    if (!raw) {
      setResolvedCover('')
      return
    }
    if (!isGatewayCoverUrl(raw)) {
      setResolvedCover(raw)
      return
    }
    setResolvedCover('')
    void resolveCoverUrl(raw)
      .then((url) => {
        if (!cancelled) setResolvedCover(url || '')
      })
      .catch(() => {
        if (!cancelled) setResolvedCover('')
      })
    return () => {
      cancelled = true
    }
  }, [currentSong?.cover])

  useEffect(() => {
    if (!engineReady) return
    const engine = engineRef.current
    if (!engine) return
    if (currentSong) {
      engine.setTrack({
        id: String(currentSong.id),
        name: currentSong.name,
        artist: currentSong.artist,
        album: currentSong.album,
        cover: resolvedCover,
        url: currentSong.url,
        platform: currentSong.platform,
      })
    } else {
      engine.setTrack(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, playbackSessionKey, currentSong?.id, currentSong?.platform, currentSong?.url, resolvedCover])

  useEffect(() => {
    if (!engineReady) return
    engineRef.current?.setPlaying(isPlaying)
  }, [engineReady, isPlaying])

  const mineradioLyrics = useMemo(() => convertLyricsToMineradio(lyricData, lyrics), [lyricData, lyrics])

  useEffect(() => {
    if (!engineReady) return
    engineRef.current?.setLyrics(mineradioLyrics.lines, {
      hasKaraoke: mineradioLyrics.hasKaraoke,
      timingSource: mineradioLyrics.timingSource,
    })
  }, [engineReady, mineradioLyrics])

  // ---------- 关闭 / 沉浸 / 全屏 ----------
  const closeOverlay = useCallback(() => setShowLyricsPanel(false), [setShowLyricsPanel])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (immersive) {
        e.preventDefault()
        engineRef.current?.setImmersive(false)
        return
      }
      if (fxPanelOpen || miniQueueOpen || volumeOpen) {
        e.preventDefault()
        setFxPanelOpen(false)
        setMiniQueueOpen(false)
        setVolumeOpen(false)
        return
      }
      if (document.fullscreenElement) return
      e.preventDefault()
      closeOverlay()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [immersive, fxPanelOpen, miniQueueOpen, volumeOpen, closeOverlay])

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }
  }

  // ---------- 进度条 ----------
  const displayedRatio = duration > 0
    ? Math.min(1, Math.max(0, (seekPreview ?? currentTime) / duration))
    : 0

  const ratioFromPointer = (clientX: number) => {
    const bar = progressBarRef.current
    if (!bar) return 0
    const rect = bar.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const handleProgressPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setSeekPreview(ratioFromPointer(e.clientX) * duration)
    engineRef.current?.markRenderInteraction('progress-seek')
  }

  const handleProgressPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (seekPreview == null || duration <= 0) return
    setSeekPreview(ratioFromPointer(e.clientX) * duration)
    engineRef.current?.emitProgressDragParticles(e.clientX, e.clientY)
  }

  const handleProgressPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (seekPreview == null || duration <= 0) return
    const target = ratioFromPointer(e.clientX) * duration
    setSeekPreview(null)
    usePlayerStore.getState().seek(target)
  }

  // ---------- 播放控制 ----------
  const cyclePlayMode = () => {
    const modes: Array<'sequence' | 'loop' | 'single' | 'shuffle'> = ['sequence', 'loop', 'single', 'shuffle']
    const idx = modes.indexOf(playMode)
    usePlayerStore.getState().setPlayMode(modes[(idx + 1) % modes.length])
  }

  const playModeIcon = playMode === 'single'
    ? <Repeat1 />
    : playMode === 'shuffle'
      ? <Shuffle />
      : <Repeat />

  const playModeLabel = playMode === 'loop' ? '循环' : playMode === 'single' ? '单曲' : playMode === 'shuffle' ? '随机' : '顺序'

  const displayedVolume = isMuted ? 0 : volume

  const handleVolumeWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const direction = e.deltaY < 0 ? 1 : -1
    const next = Math.min(1, Math.max(0, displayedVolume + direction * VOLUME_WHEEL_STEP))
    usePlayerStore.getState().setVolume(Number(next.toFixed(2)))
  }

  const isSongFavorited = currentSong ? isFavorite(currentSong.id, currentSong.platform) : false
  const handleFavoriteClick = () => {
    if (!currentSong) return
    if (isSongFavorited) removeFromFavorites(currentSong.id, currentSong.platform)
    else addToFavorites(currentSong)
  }

  const handleQueueSongClick = (index: number) => {
    const song = playlist[index]
    if (!song) return
    if (currentSong && song.id === currentSong.id && song.platform === currentSong.platform) {
      usePlayerStore.getState().togglePlay()
      return
    }
    void usePlayerStore.getState().playSong(song, playlist)
  }

  const queueSourceLabel = resolvePlaylistSourceLabel(playlistId, playlistName)
  const engineState = engineReady && engineRef.current ? engineRef.current.getState() : null

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        'mineradio-player diy-mode z-50',
        immersive && 'immersive-mode',
      )}
      onClick={() => {
        setMiniQueueOpen(false)
        setVolumeOpen(false)
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: CONTROL_GLASS_SVG }} />

      {/* 背景层：自定义背景 → 封面模糊 → three.js 粒子 */}
      <div id="custom-bg"><video id="custom-bg-video" muted loop playsInline preload="metadata" /></div>
      <div ref={albumBgRef} id="album-bg" />
      <div ref={canvasContainerRef} id="canvas-container" />

      {/* 顶部：关闭 */}
      <button className="mr-close-btn" type="button" title="返回 (Esc)" onClick={closeOverlay}>
        <ChevronDown />
      </button>

      {/* 左下小封面 */}
      <div id="thumb-wrap">
        <img id="thumb-cover" src={resolvedCover || ''} alt="" />
        <div id="thumb-info">
          <div id="thumb-title">{currentSong?.name || ''}</div>
          <div id="thumb-artist">{currentSong?.artist || ''}</div>
        </div>
      </div>

      {/* 节拍 / AI 深度角标 */}
      <div id="beat-chip" className={beatChip.visible ? 'show' : ''}>
        <div className="mini-spin" /><span id="beat-text">{beatChip.text || '分析节奏…'}</span>
      </div>
      <div id="ai-depth-chip">
        <div className="mini-spin" /><span id="ai-depth-text">AI 深度估计…</span>
      </div>

      {/* 底部控制条 */}
      <div id="bottom-bar" className="visible" onClick={(e) => e.stopPropagation()}>
        {miniQueueOpen && (
          <div id="mini-queue-popover" className="mini-queue-popover show">
            <div className="mini-queue-head">
              <div className="min-w-0">
                <div className="mini-queue-title">当前队列</div>
                <div id="mini-queue-count" className="mini-queue-count">
                  {playlist.length} 首
                  {queueSourceLabel ? ` · 来自 ${queueSourceLabel}` : ''}
                </div>
              </div>
              <button
                className="fx-mini-btn ghost"
                style={{ height: 26, padding: '0 9px', fontSize: 13 }}
                onClick={() => setMiniQueueOpen(false)}
              >
                ×
              </button>
            </div>
            <div id="mini-queue-list" className="mini-queue-list">
              {playlist.length === 0 && <div className="mini-queue-empty">队列为空</div>}
              {playlist.map((song, index) => {
                const isCurrent = currentSong?.id === song.id && currentSong?.platform === song.platform
                return (
                  <div
                    key={`${song.platform}-${song.id}-${index}`}
                    className={cn('mini-queue-item', isCurrent && 'now')}
                    onClick={() => handleQueueSongClick(index)}
                  >
                    <CoverImage src={song.cover} alt={song.name} className="mini-queue-cover" />
                    <div className="mini-queue-info">
                      <div className="mini-queue-name">{song.name}</div>
                      <div className="mini-queue-sub">{song.artist}</div>
                    </div>
                    <button
                      className="mini-queue-remove"
                      title="移出队列"
                      onClick={(e) => {
                        e.stopPropagation()
                        usePlayerStore.getState().removeFromQueue(index)
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div
          ref={progressBarRef}
          id="progress-bar"
          onPointerDown={handleProgressPointerDown}
          onPointerMove={handleProgressPointerMove}
          onPointerUp={handleProgressPointerUp}
        >
          <div id="progress-fill" style={{ width: `${displayedRatio * 100}%` }} />
          <div id="progress-thumb" style={{ left: `${displayedRatio * 100}%` }} aria-hidden="true" />
        </div>

        <div id="controls">
          <div className="control-cluster actions">
            <div className="control-track">
              <div
                id="control-cover"
                className={cn('control-cover', !resolvedCover && 'cover-empty')}
                style={resolvedCover ? { backgroundImage: `url("${resolvedCover}")` } : undefined}
                aria-hidden="true"
              />
              <div className="control-meta">
                <div id="control-title" className="control-title" title={currentSong?.name}>{currentSong?.name || '未播放'}</div>
                <div id="control-artist" className="control-artist" title={currentSong?.artist}>{currentSong?.artist || ''}</div>
              </div>
            </div>
            <button
              id="heart-btn"
              className={cn('ctrl-btn', isSongFavorited && 'liked')}
              onClick={handleFavoriteClick}
              title="红心喜欢"
              disabled={!currentSong}
            >
              <Heart className="heart-svg" fill={isSongFavorited ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className="control-cluster transport">
            <button id="play-mode-btn" className="ctrl-btn" onClick={cyclePlayMode} title={`播放顺序：${playModeLabel}`}>
              {playModeIcon}
            </button>
            <button id="prev-btn" className="ctrl-btn" onClick={() => usePlayerStore.getState().playPrevious()} title="上一首" disabled={!currentSong}>
              <SkipBack fill="currentColor" />
            </button>
            <button
              id="play-btn"
              className="ctrl-btn"
              onClick={() => usePlayerStore.getState().togglePlay()}
              title="播放/暂停"
              disabled={!currentSong || isLoading}
            >
              {isLoading ? (
                <span className="mini-spin" />
              ) : isPlaying ? (
                <Pause id="play-icon" fill="currentColor" />
              ) : (
                <Play id="play-icon" fill="currentColor" />
              )}
            </button>
            <button id="next-btn" className="ctrl-btn" onClick={() => usePlayerStore.getState().playNext()} title="下一首" disabled={!currentSong}>
              <SkipForward fill="currentColor" />
            </button>
            <button
              id="mini-queue-btn"
              className={cn('ctrl-btn', miniQueueOpen && 'active')}
              onClick={() => setMiniQueueOpen((v) => !v)}
              title="当前队列"
            >
              <ListMusic />
            </button>
          </div>

          <div className="control-cluster modes">
            <button
              className="ctrl-btn lyrics-toggle-btn"
              onClick={() => engineRef.current?.toggleLyrics()}
              title="歌词"
            >
              <span className="lyrics-word-icon">词</span>
            </button>
            <div
              id="volume-control"
              className={cn('volume-control', volumeOpen && 'open')}
              onWheel={handleVolumeWheel}
            >
              <button
                id="volume-btn"
                className="ctrl-btn"
                onClick={() => setVolumeOpen((v) => !v)}
                title="音量 / 静音"
              >
                {displayedVolume === 0 ? <VolumeX id="volume-icon" /> : <Volume2 id="volume-icon" />}
              </button>
              <div className="volume-popover" onClick={(e) => e.stopPropagation()}>
                <input
                  id="volume-slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={displayedVolume}
                  onChange={(e) => usePlayerStore.getState().setVolume(parseFloat(e.target.value))}
                  aria-label="音量"
                />
                <span id="volume-value">{Math.round(displayedVolume * 100)}%</span>
              </div>
            </div>
            <button
              id="immersive-btn"
              className="ctrl-btn"
              onClick={() => engineRef.current?.setImmersive(true)}
              title="全沉浸式（Esc 退出）"
            >
              <Scan />
            </button>
            <button className="ctrl-btn fullscreen-toggle-btn" onClick={toggleFullscreen} title="全屏">
              {isFullscreen ? <Minimize /> : <Maximize />}
            </button>
            <div id="time-display">
              {formatTime(seekPreview ?? currentTime)} / {formatTime(duration)}
            </div>
          </div>
        </div>
      </div>

      {/* 视觉控制台入口 + 面板 */}
      <button
        id="fx-fab"
        className={cn(fxPanelOpen && 'active')}
        title="视觉控制台"
        onClick={(e) => {
          e.stopPropagation()
          setFxPanelOpen((v) => !v)
        }}
      >
        <SlidersHorizontal />
      </button>
      {engineState && engineRef.current && (
        <div onClick={(e) => e.stopPropagation()}>
          <MineradioFxPanel engine={engineRef.current} state={engineState} visible={fxPanelOpen} />
        </div>
      )}
    </motion.div>
  )
}
