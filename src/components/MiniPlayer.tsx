import { useEffect, useMemo, useState } from 'react'
import { Disc, Expand, Heart, Pause, Pin, PinOff, Play, Settings2, SkipForward, X } from 'lucide-react'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlaybackProgressStore } from '@/stores/playbackProgressStore'
import { useUIStore } from '@/stores/uiStore'
import { useUserStore } from '@/stores/userStore'
import { cn } from '@/utils/cn'
import { findCurrentLyricIndex, parseRichLyrics } from '@/utils/format'
import CoverImage from '@/components/ui/CoverImage'

const MINI_PLAYER_CARD_OPACITY_KEY = 'mini-player-card-opacity'

export default function MiniPlayer() {
  const {
    setMiniMode,
    mainWindowAlwaysOnTop,
    toggleMainWindowAlwaysOnTop,
    theme,
  } = useUIStore()
  const {
    currentSong,
    playlist,
    isPlaying,
    isLoading,
    lyricData,
    lyrics,
    playbackSessionKey,
    togglePlay,
    playNext,
  } = usePlayerStore()
  const isFavorite = useUserStore((s) => s.isFavorite)
  const addToFavorites = useUserStore((s) => s.addToFavorites)
  const removeFromFavorites = useUserStore((s) => s.removeFromFavorites)
  const currentTime = usePlaybackProgressStore((state) => state.currentTime)
  const [platform, setPlatform] = useState<string>('')
  const [showSettings, setShowSettings] = useState(false)
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [cardOpacity, setCardOpacity] = useState(() => {
    if (typeof window === 'undefined') return 0.78
    const storedValue = Number.parseFloat(window.localStorage.getItem(MINI_PLAYER_CARD_OPACITY_KEY) || '')
    if (!Number.isFinite(storedValue)) return 0.78
    return Math.min(0.96, Math.max(0.35, storedValue))
  })

  const displaySong = currentSong || playlist[0] || null
  const isSongFavorited = currentSong ? isFavorite(currentSong.id, currentSong.platform) : false
  const isMac = platform === 'darwin'
  const isDarkAppearance = theme === 'system' ? systemPrefersDark : theme === 'dark'
  const cardBackgroundColor = isDarkAppearance
    ? `rgba(9, 11, 17, ${Math.min(0.98, Math.max(0.4, cardOpacity + 0.08))})`
    : `rgba(255, 255, 255, ${cardOpacity})`
  const lyricPrimaryColor = 'var(--text-primary)'
  const lyricSecondaryColor = 'var(--text-secondary)'
  const parsedLyrics = useMemo(() => {
    if (!lyricData && !lyrics) return []
    return parseRichLyrics(lyricData || (lyrics ? { lyric: lyrics } : null), {
      showTranslation: false,
      showRoman: false,
      preferWordByWord: true,
    })
  }, [lyricData, lyrics])

  const lyricPreview = useMemo(() => {
    if (parsedLyrics.length > 0) {
      const lines: string[] = []
      const activeIndex = Math.max(findCurrentLyricIndex(parsedLyrics, currentTime), 0)

      for (let index = activeIndex; index < parsedLyrics.length && lines.length < 2; index += 1) {
        const text = parsedLyrics[index]?.text?.trim()
        if (text) lines.push(text)
      }

      if (lines.length > 0) return lines
    }

    const rawLyricText = (lyricData?.lyric || lyrics || '').trim()
    if (rawLyricText) {
      const plainLines = rawLyricText
        .split(/\r?\n/)
        .map((line) => line.replace(/\[[^\]]+\]/g, '').trim())
        .filter(Boolean)
        .slice(0, 2)

      if (plainLines.length > 0) return plainLines
    }

    if (displaySong) {
      return ['暂无歌词', displaySong.album ? `专辑：${displaySong.album}` : displaySong.artist]
    }

    return ['播放一首歌后', '这里会显示歌名和歌词']
  }, [currentTime, displaySong, lyricData?.lyric, lyrics, parsedLyrics, playbackSessionKey])

  useEffect(() => {
    if (window.electronAPI?.getPlatform) {
      window.electronAPI.getPlatform().then(setPlatform).catch(() => setPlatform(''))
    }
  }, [])

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
    if (typeof window === 'undefined') return
    window.localStorage.setItem(MINI_PLAYER_CARD_OPACITY_KEY, cardOpacity.toString())
  }, [cardOpacity])

  useEffect(() => {
    if (!window.electronAPI?.setWindowOpacity) return

    const nextOpacity = Math.min(1, Math.max(0.35, cardOpacity))
    window.electronAPI.setWindowOpacity(nextOpacity).catch((error) => {
      console.warn('Sync mini window opacity failed:', error)
    })
  }, [cardOpacity])

  useEffect(() => {
    if (!window.electronAPI?.setWindowOpacity) return
    return () => {
      window.electronAPI?.setWindowOpacity(1).catch((error) => {
        console.warn('Restore window opacity failed:', error)
      })
    }
  }, [])

  const handleFavoriteClick = () => {
    if (!currentSong) return

    if (isSongFavorited) {
      removeFromFavorites(currentSong.id, currentSong.platform)
      return
    }

    addToFavorites(currentSong)
  }

  return (
    <div className="relative z-10 h-full overflow-hidden">
      <div
        className="drag-region relative flex h-full w-full overflow-hidden shadow-[0_18px_60px_rgba(15,23,42,0.2)] dark:shadow-[0_28px_70px_rgba(0,0,0,0.5)]"
        style={{ backgroundColor: cardBackgroundColor }}
      >
        {displaySong?.cover ? (
          <>
            <img
              key={`mini-bg-${playbackSessionKey || displaySong.id || displaySong.name}`}
              src={displaySong.cover}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-[72px] opacity-28 dark:opacity-38"
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundColor: isDarkAppearance
                  ? `rgba(2, 6, 23, ${Math.min(0.76, cardOpacity)})`
                  : `rgba(255, 255, 255, ${Math.min(0.7, cardOpacity * 0.82)})`,
              }}
            />
          </>
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/14 via-transparent to-black/10 dark:from-white/4 dark:via-transparent dark:to-black/24" />

        <div className="relative flex h-full w-full items-center gap-2.5 px-3 py-2.5">
          <div
            className={cn(
              'flex h-[64px] w-[64px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-white/80 shadow-[0_12px_28px_rgba(15,23,42,0.18)] dark:bg-white/10',
              isMac && 'mt-[18px] self-start'
            )}
          >
            {displaySong ? (
              <CoverImage
                key={`mini-cover-${playbackSessionKey || displaySong.id || displaySong.name}`}
                src={displaySong.cover}
                alt={displaySong.name}
                className="h-full w-full"
              />
            ) : (
              <Disc className="h-9 w-9 text-[var(--text-muted)]" />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col self-stretch">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 truncate pr-1 text-[14px] font-semibold text-[var(--text-primary)]">
                {displaySong?.name || 'Sollin Mini'}
              </p>

              <div className="no-drag flex shrink-0 items-center gap-1">
                <button
                  onClick={togglePlay}
                  disabled={(!currentSong && playlist.length === 0) || isLoading}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary-500 text-white shadow-lg shadow-primary-500/25 transition-all hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                  title={isPlaying ? '暂停' : '播放'}
                >
                  {isLoading ? (
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="ml-0.5 h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  onClick={playNext}
                  disabled={!currentSong}
                  className="btn-icon h-[26px] w-[26px] rounded-full bg-white/68 text-[var(--text-primary)] hover:bg-white dark:bg-white/10 dark:text-[var(--text-primary)] dark:hover:bg-white/15 disabled:opacity-40"
                  title="下一首"
                >
                  <SkipForward className="h-3 w-3" />
                </button>
                <button
                  onClick={handleFavoriteClick}
                  disabled={!currentSong}
                  className="btn-icon h-[26px] w-[26px] rounded-full bg-white/68 text-[var(--text-primary)] hover:bg-white dark:bg-white/10 dark:text-[var(--text-primary)] dark:hover:bg-white/15 disabled:opacity-40"
                  title={isSongFavorited ? '取消收藏' : '收藏'}
                >
                  <Heart className={cn('h-3 w-3', isSongFavorited && 'fill-primary-500 text-primary-500')} />
                </button>
                <button
                  onClick={toggleMainWindowAlwaysOnTop}
                  className={cn(
                    'btn-icon h-6 w-6 rounded-full shadow-sm transition-colors',
                    mainWindowAlwaysOnTop
                      ? 'bg-primary-500 text-white hover:bg-primary-600'
                      : 'bg-white/72 text-[var(--text-secondary)] hover:bg-white dark:bg-white/10 dark:text-[var(--text-secondary)] dark:hover:bg-white/15'
                  )}
                  title={mainWindowAlwaysOnTop ? '取消置顶' : '始终置顶'}
                >
                  {mainWindowAlwaysOnTop ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                </button>
                <button
                  onClick={() => setShowSettings((value) => !value)}
                  className={showSettings
                    ? 'btn-icon h-6 w-6 rounded-full bg-primary-500 text-white shadow-sm hover:bg-primary-600'
                    : 'btn-icon h-6 w-6 rounded-full bg-white/72 text-[var(--text-secondary)] shadow-sm hover:bg-white dark:bg-white/10 dark:text-[var(--text-secondary)] dark:hover:bg-white/15'}
                  title="迷你设置"
                >
                  <Settings2 className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setMiniMode(false)}
                  className="btn-icon h-6 w-6 rounded-full bg-white/72 text-[var(--text-secondary)] shadow-sm hover:bg-white dark:bg-white/10 dark:text-[var(--text-secondary)] dark:hover:bg-white/15"
                  title="退出迷你模式"
                >
                  <Expand className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 pt-1">
              <p className="truncate text-[11px] text-[var(--text-muted)]">
                {displaySong ? displaySong.artist : '迷你播放界面'}
              </p>
              <div className="mt-1">
                {lyricPreview.map((line, index) => (
                  <p
                    key={`${index}-${line}`}
                    className={cn(
                      'max-w-full text-[12px] leading-[18px]',
                      index === 0 ? 'line-clamp-2' : 'mt-1 line-clamp-1',
                    )}
                    style={{
                      color: index === 0 ? lyricPrimaryColor : lyricSecondaryColor,
                      fontWeight: index === 0 ? 500 : 400,
                    }}
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {showSettings && (
          <div className="no-drag absolute inset-0 z-20 overflow-y-auto bg-white/75 backdrop-blur-xl dark:bg-slate-950/82">
            <div className="flex min-h-full flex-col px-3 py-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-semibold text-[var(--text-primary)]">迷你设置</p>
                  <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">调整卡片透明度</p>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="btn-icon h-6 w-6 rounded-full bg-white/75 text-[var(--text-secondary)] shadow-sm hover:bg-white dark:bg-white/10 dark:text-[var(--text-secondary)] dark:hover:bg-white/15"
                  title="关闭设置"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 pb-2">
                <label className="mt-2 block text-[11px] text-[var(--text-secondary)]">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span>卡片透明度</span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {Math.round(cardOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="35"
                    max="96"
                    step="1"
                    value={Math.round(cardOpacity * 100)}
                    onChange={(event) => setCardOpacity(Number(event.target.value) / 100)}
                    className="w-full accent-primary-500"
                  />
                </label>

                <p className="text-[10px] leading-4 text-[var(--text-muted)]">
                  提示：透明度越低，迷你窗口会越能透出你后面的 App 内容。
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
