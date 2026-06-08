import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Search, User, Settings, Download, X, Flame, Clock3, Clock, Globe, LogOut, Calendar, Radio, Sun, Moon, Monitor, Check, Music2, RefreshCw, ExternalLink } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { useDownloadStore } from '@/stores/downloadStore'
import { useFeatureStore } from '@/stores/featureStore'
import { usePlayerStore } from '@/stores/playerStore'
import { lxSourceApi, type LxManagedSource } from '@/services/lxSource'
import neteaseAuthApi from '@/services/neteaseAuth'
import { cn } from '@/utils/cn'
import type { Platform, AudioQuality } from '@/types'
import { QUALITY_NAMES, QUALITY_OPTIONS } from '@/constants/audio'
import { APP_VERSION } from '@/config'
import { checkGithubUpdate, type GithubUpdateInfo } from '@/services/githubUpdate'

const PLATFORM_OPTIONS: { id: Platform | 'all'; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'netease', name: '小芸' },
  { id: 'qq', name: '小秋' },
  { id: 'kuwo', name: '小蜗' },
  { id: 'kugou', name: '小枸' },
  { id: 'migu', name: '小蜜' },
]

const THEME_OPTIONS = [
  { id: 'light' as const, label: '浅色', icon: Sun },
  { id: 'dark' as const, label: '深色', icon: Moon },
  { id: 'system' as const, label: '跟随系统', icon: Monitor },
]

const QUALITY_OPTION_BY_ID = new Map(QUALITY_OPTIONS.map((option) => [option.id, option]))

function SourceSwitcherContent() {
  const [sources, setSources] = useState<LxManagedSource[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const addToast = useUIStore((s) => s.addToast)

  const defaultQuality = usePlayerStore((s) => s.quality)
  const setDefaultQuality = usePlayerStore((s) => s.setQuality)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const status = await lxSourceApi.getStatus()
        if (cancelled) return
        setSources(status.managedSources)
        setActiveId(status.activeSourceId)
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const handleSwitch = async (sourceId: string) => {
    try {
      const status = await lxSourceApi.setActiveSource(sourceId)
      setActiveId(status.activeSourceId)
      const name = status.managedSources.find((s) => s.id === sourceId)?.scriptInfo?.name || '音源'
      addToast({ type: 'success', message: `已切换到: ${name}` })
    } catch {
      addToast({ type: 'error', message: '切换音源失败' })
    }
  }

  const handleDefaultQualitySelect = (nextQuality: AudioQuality) => {
    if (nextQuality === defaultQuality) return
    setDefaultQuality(nextQuality)
    addToast({
      type: 'success',
      message: `已设置默认音质为 ${QUALITY_NAMES[nextQuality]}，新播放的歌曲将使用此音质`,
    })
  }

  return (
    <DropdownMenu.Content
      className="min-w-[220px] max-w-[300px] bg-white dark:bg-gray-800 rounded-xl shadow-xl p-1.5 z-[10001] border border-gray-200 dark:border-gray-700 animate-scale-in"
      sideOffset={8}
      align="end"
    >
      <div className="px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)]">切换音源</div>
      {loading ? (
        <div className="px-3 py-3 text-sm text-[var(--text-muted)] text-center">加载中...</div>
      ) : sources.length === 0 ? (
        <div className="px-3 py-3 text-sm text-[var(--text-muted)] text-center">暂无已导入的音源</div>
      ) : (
        sources.map((source) => (
          <DropdownMenu.Item
            key={source.id}
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer outline-none transition-colors',
              source.id === activeId
                ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400'
                : 'text-[var(--text-secondary)] hover:bg-gray-100 dark:hover:bg-gray-700',
            )}
            onSelect={() => {
              if (source.id !== activeId) {
                void handleSwitch(source.id)
              }
            }}
          >
            <Radio className="w-4 h-4 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{source.scriptInfo?.name || '未知音源'}</div>
              {source.scriptInfo?.version && (
                <div className="text-xs text-[var(--text-muted)] truncate">v{source.scriptInfo.version}</div>
              )}
            </div>
            {source.id === activeId && (
              <span className="text-xs text-primary-500 flex-shrink-0">当前</span>
            )}
          </DropdownMenu.Item>
        ))
      )}

      {/* Default Quality Switcher (global) */}
      <DropdownMenu.Separator className="my-1.5 h-px bg-gray-200 dark:bg-gray-700" />
      <div className="px-3 py-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-muted)]">默认音质</span>
        <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[140px]">
          {QUALITY_OPTION_BY_ID.get(defaultQuality)?.label || QUALITY_NAMES[defaultQuality]}
        </span>
      </div>
      {QUALITY_OPTIONS.map(({ id: qualityId, label, desc }) => {
        const isCurrent = qualityId === defaultQuality
        return (
          <DropdownMenu.Item
            key={qualityId}
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer outline-none transition-colors',
              isCurrent
                ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400'
                : 'text-[var(--text-secondary)] hover:bg-gray-100 dark:hover:bg-gray-700',
            )}
            onSelect={(e) => {
              e.preventDefault()
              handleDefaultQualitySelect(qualityId)
            }}
          >
            <Music2 className="w-4 h-4 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{label}</div>
              <div className="text-xs text-[var(--text-muted)] truncate">{desc}</div>
            </div>
            {isCurrent && <Check className="w-4 h-4 flex-shrink-0 text-primary-500" />}
          </DropdownMenu.Item>
        )
      })}
    </DropdownMenu.Content>
  )
}

function ThemeToggleButton() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    setSystemPrefersDark(media.matches)
    if ('addEventListener' in media) {
      media.addEventListener('change', handleChange)
      return () => media.removeEventListener('change', handleChange)
    }
    return undefined
  }, [])

  const isDarkAppearance = theme === 'system' ? systemPrefersDark : theme === 'dark'
  const TriggerIcon = theme === 'system' ? Monitor : isDarkAppearance ? Moon : Sun
  const currentLabel = THEME_OPTIONS.find((t) => t.id === theme)?.label || '主题'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="p-2 rounded-full hover:bg-gray-100/80 dark:hover:bg-gray-800/60 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title={`主题：${currentLabel}`}
        >
          <TriggerIcon className="w-5 h-5" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[160px] bg-white dark:bg-gray-800 rounded-xl shadow-xl p-1.5 z-[10001] border border-gray-200 dark:border-gray-700 animate-scale-in"
          sideOffset={8}
          align="end"
        >
          <div className="px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)]">主题模式</div>
          {THEME_OPTIONS.map(({ id, label, icon: Icon }) => (
            <DropdownMenu.Item
              key={id}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer outline-none transition-colors',
                theme === id
                  ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400'
                  : 'text-[var(--text-secondary)] hover:bg-gray-100 dark:hover:bg-gray-700',
              )}
              onSelect={() => setTheme(id)}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {theme === id && <Check className="w-4 h-4 flex-shrink-0 text-primary-500" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function VersionStatusButton() {
  const addToast = useUIStore((s) => s.addToast)
  const [updateInfo, setUpdateInfo] = useState<GithubUpdateInfo | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [hasChecked, setHasChecked] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadVersionStatus = async() => {
      setIsChecking(true)
      try {
        const data = await checkGithubUpdate(APP_VERSION)
        if (cancelled) return
        setUpdateInfo(data)
        setHasChecked(true)
      } catch (error) {
        console.debug('Top bar update check failed:', error)
      } finally {
        if (!cancelled) setIsChecking(false)
      }
    }

    void loadVersionStatus()
    return () => { cancelled = true }
  }, [])

  const refreshVersionStatus = async() => {
    setIsChecking(true)
    try {
      const data = await checkGithubUpdate(APP_VERSION)
      setUpdateInfo(data)
      setHasChecked(true)
      addToast({
        type: data.hasUpdate ? 'info' : 'success',
        message: data.hasUpdate ? `发现新版本 ${data.latestVersion}` : '已是最新版本',
      })
    } catch (error) {
      console.error('Refresh update status failed:', error)
      addToast({ type: 'error', message: '检查更新失败，请稍后重试' })
    } finally {
      setIsChecking(false)
    }
  }

  const handleOpenDownload = () => {
    if (!updateInfo?.downloadUrl) return
    window.open(updateInfo.downloadUrl, '_blank', 'noopener,noreferrer')
  }

  const hasUpdate = Boolean(updateInfo?.hasUpdate)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'relative inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-colors',
            hasUpdate
              ? 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15'
              : 'bg-gray-100/80 dark:bg-gray-800/60 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-gray-200/80 dark:hover:bg-gray-700/60',
          )}
          title={hasUpdate ? `发现新版本 v${updateInfo?.latestVersion}` : `当前版本 v${APP_VERSION}`}
        >
          <span>v{APP_VERSION}</span>
          {isChecking ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : hasUpdate ? (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-gray-950" />
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="w-[320px] bg-white dark:bg-gray-800 rounded-xl shadow-xl p-3 z-[10001] border border-gray-200 dark:border-gray-700 animate-scale-in"
          sideOffset={8}
          align="end"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">版本更新</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">当前版本 v{APP_VERSION}</p>
            </div>
            <button
              type="button"
              onClick={() => void refreshVersionStatus()}
              disabled={isChecking}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              title="重新检查"
            >
              <RefreshCw className={cn('w-4 h-4', isChecking && 'animate-spin')} />
            </button>
          </div>

          <div className={cn(
            'mt-3 rounded-xl border p-3',
            hasUpdate
              ? 'border-red-500/20 bg-red-500/5'
              : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40',
          )}>
            {hasUpdate && updateInfo ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                      发现新版本 v{updateInfo.latestVersion}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">建议下载最新版本安装包</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenDownload}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs hover:bg-primary-600 transition-colors flex-shrink-0"
                  >
                    更新
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-3 max-h-40 overflow-y-auto space-y-1">
                  {updateInfo.releaseNotes.map((line, index) => (
                    <p key={`${line}-${index}`} className="text-xs leading-5 text-[var(--text-secondary)] break-words">
                      {line}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>{hasChecked ? '当前已是最新版本' : '正在检查更新状态'}</span>
              </div>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export default function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { searchQuery, setSearchQuery, searchPlatform, setSearchPlatform } = useUIStore()
  const setShowAuthModal = useUIStore((s) => s.setShowAuthModal)
  const setShowSettingsModal = useUIStore((s) => s.setShowSettingsModal)
  const setTopBarSearchActive = useUIStore((s) => s.setTopBarSearchActive)

  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const userData = useAuthStore((s) => s.userData)
  const neteaseLogout = useAuthStore((s) => s.logout)
  const [neteaseDropdownOpen, setNeteaseDropdownOpen] = useState(false)
  const neteaseHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const downloadTasks = useDownloadStore((s) => s.tasks)
  const activeDownloads = downloadTasks.filter((t) => t.status === 'downloading' || t.status === 'pending').length

  const { searchHistory, removeSearchHistory, clearSearchHistory } = useFeatureStore()

  const [localQuery, setLocalQuery] = useState(searchQuery)
  const [isFocused, setIsFocused] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [hotKeywords, setHotKeywords] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const searchFormRef = useRef<HTMLFormElement>(null)

  const isSearchPage = location.pathname === '/search'

  // Load hot search keywords
  useEffect(() => {
    let cancelled = false
    const loadHotSearch = async () => {
      const list = await neteaseAuthApi.getHotSearch()
      if (cancelled) return
      const keywords = list
        .map((item) => String(item?.searchWord || item?.first || item?.keyword || '').trim())
        .filter(Boolean)
        .slice(0, 20)
      setHotKeywords(Array.from(new Set(keywords)))
    }
    void loadHotSearch()
    return () => { cancelled = true }
  }, [])

  // Sync search active state with store for Layout overlay
  const topBarSearchActive = useUIStore((s) => s.topBarSearchActive)
  useEffect(() => {
    setTopBarSearchActive(showSuggestions)
    return () => setTopBarSearchActive(false)
  }, [showSuggestions, setTopBarSearchActive])

  // Close local suggestions when overlay in Layout dismisses
  useEffect(() => {
    if (!topBarSearchActive && showSuggestions) {
      setShowSuggestions(false)
    }
  }, [topBarSearchActive])

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        searchFormRef.current &&
        !searchFormRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = localQuery.trim()
    if (trimmed) {
      setSearchQuery(trimmed)
      setShowSuggestions(false)
      if (!isSearchPage) {
        navigate('/search')
      }
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalQuery(e.target.value)
  }

  const handleClear = () => {
    setLocalQuery('')
    setSearchQuery('')
    setShowSuggestions(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClear()
      setShowSuggestions(false)
    }
  }

  const handleFocus = () => {
    setIsFocused(true)
    setShowSuggestions(true)
  }

  const handleBlur = () => {
    setIsFocused(false)
  }

  const handleKeywordClick = (keyword: string) => {
    setLocalQuery(keyword)
    setSearchQuery(keyword)
    setShowSuggestions(false)
    if (!isSearchPage) {
      navigate('/search')
    }
  }

  const currentPlatformName = PLATFORM_OPTIONS.find((p) => p.id === searchPlatform)?.name || '全部'

  return (
    <div className="h-14 flex items-center gap-4 px-6 bg-[var(--panel-bg)] border-b border-gray-200/30 dark:border-gray-800/50"
      style={{ backdropFilter: 'blur(var(--panel-backdrop-blur))' }}>
      {/* Search Box (with platform selector merged inside) */}
      <form ref={searchFormRef} onSubmit={handleSearch} className="flex-1 max-w-xl relative">
        <div
          className={cn(
            'relative flex items-center rounded-full transition-all duration-200',
            isFocused
              ? 'bg-white dark:bg-gray-800 shadow-lg ring-2 ring-primary-500/30'
              : 'bg-gray-100/80 dark:bg-gray-800/60 hover:bg-gray-200/80 dark:hover:bg-gray-700/60'
          )}
        >
          {/* Inline Platform Selector */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 pl-3 pr-2 py-1 my-1 ml-1 rounded-full text-xs font-medium text-[var(--text-secondary)] hover:bg-gray-200/70 dark:hover:bg-gray-700/60 transition-colors flex-shrink-0"
                title="选择搜索平台"
              >
                <Globe className="w-3.5 h-3.5" />
                <span className="max-w-[48px] truncate">{currentPlatformName}</span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-[120px] bg-white dark:bg-gray-800 rounded-xl shadow-xl p-1 z-[10001] border border-gray-200 dark:border-gray-700"
                sideOffset={6}
                align="start"
              >
                {PLATFORM_OPTIONS.map((platform) => (
                  <DropdownMenu.Item
                    key={platform.id}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer outline-none transition-colors',
                      searchPlatform === platform.id
                        ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400'
                        : 'text-[var(--text-secondary)] hover:bg-gray-100 dark:hover:bg-gray-700',
                    )}
                    onSelect={() => setSearchPlatform(platform.id)}
                  >
                    {platform.name}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Divider */}
          <div className="w-px h-4 bg-gray-300/70 dark:bg-gray-600/60 mx-1 flex-shrink-0" />

          <Search className="w-4 h-4 text-[var(--text-muted)] pointer-events-none flex-shrink-0 ml-1" />
          <input
            ref={inputRef}
            type="text"
            value={localQuery}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="搜索歌曲、歌手、专辑..."
            className="w-full pl-2 pr-10 py-2.5 bg-transparent text-sm text-[var(--text-primary)] placeholder-gray-400 dark:placeholder-gray-500 outline-none rounded-full"
          />
          {localQuery && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            </button>
          )}
        </div>

        {/* Suggestions Panel */}
        {showSuggestions && (hotKeywords.length > 0 || searchHistory.length > 0) && (
          <div
            ref={suggestionsRef}
            className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden"
          >
            <div className="max-h-[400px] overflow-y-auto scrollbar-hide">
              {/* Search History */}
              {searchHistory.length > 0 && (
                <div className="p-3 border-b border-gray-100 dark:border-gray-700/50">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
                      <Clock3 className="w-3.5 h-3.5" />
                      搜索历史
                    </h3>
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        clearSearchHistory()
                      }}
                      className="text-xs text-[var(--text-muted)] hover:text-red-500 transition-colors"
                    >
                      清空
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {searchHistory.slice(0, 10).map((keyword) => (
                      <span
                        key={keyword}
                        className="inline-flex items-center gap-1 rounded-full bg-gray-100/80 dark:bg-gray-700/60 px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                      >
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault()
                            handleKeywordClick(keyword)
                          }}
                          className="max-w-[120px] truncate"
                        >
                          {keyword}
                        </button>
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            removeSearchHistory(keyword)
                          }}
                          className="rounded-full p-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Hot Keywords */}
              {hotKeywords.length > 0 && (
                <div className="p-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] mb-2">
                    <Flame className="w-3.5 h-3.5" />
                    热门搜索
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {hotKeywords.map((keyword, index) => (
                      <button
                        key={`${keyword}-${index}`}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          handleKeywordClick(keyword)
                        }}
                        className="rounded-full bg-gray-100/80 dark:bg-gray-700/60 px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-primary-500 hover:text-white transition-colors"
                      >
                        {keyword}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </form>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Account Section */}
      <div className="flex items-center gap-2">
        <VersionStatusButton />

        {/* Netease Account */}
        {isLoggedIn && userData ? (
          <div
            className="relative"
            onMouseEnter={() => {
              if (neteaseHoverTimeout.current) clearTimeout(neteaseHoverTimeout.current)
              setNeteaseDropdownOpen(true)
            }}
            onMouseLeave={() => {
              neteaseHoverTimeout.current = setTimeout(() => setNeteaseDropdownOpen(false), 200)
            }}
          >
            <button
              onClick={() => navigate('/netease-home')}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-full hover:bg-gray-100/80 dark:hover:bg-gray-800/60 transition-colors"
              title="小芸音乐"
            >
              {userData.avatarUrl ? (
                <img
                  src={userData.avatarUrl}
                  alt={userData.nickname}
                  className="w-6 h-6 rounded-full object-cover"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center">
                  <User className="w-3 h-3 text-white" />
                </div>
              )}
            </button>
            {neteaseDropdownOpen && (
              <div className="absolute right-0 top-full pt-1.5 z-[10001]">
                <div className="min-w-[180px] bg-white dark:bg-gray-800 rounded-xl shadow-xl p-1 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    {userData.avatarUrl ? (
                      <img
                        src={userData.avatarUrl}
                        alt={userData.nickname}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center">
                        <User className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {userData.nickname}
                    </span>
                  </div>
                  <div className="h-px bg-gray-200 dark:bg-gray-700 mx-2 my-1" />
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-[var(--text-secondary)] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    onClick={() => {
                      navigate('/netease-home')
                      setNeteaseDropdownOpen(false)
                    }}
                  >
                    <User className="w-4 h-4" />
                    个人主页
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-[var(--text-secondary)] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    onClick={() => {
                      navigate('/daily-recommend')
                      setNeteaseDropdownOpen(false)
                    }}
                  >
                    <Calendar className="w-4 h-4" />
                    每日推荐
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    onClick={() => {
                      neteaseLogout()
                      setNeteaseDropdownOpen(false)
                    }}
                  >
                    <LogOut className="w-4 h-4" />
                    注销登录
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowAuthModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors group"
            title="小芸音乐登录"
          >
            <svg className="w-6 h-6" viewBox="0 0 48 48">
              <circle cx="24" cy="24" r="22" fill="#E83C3C" />
              <path
                d="M32 14v14.5a5.5 5.5 0 1 1-3-4.9V18.5l-10 2.5v10.5a5.5 5.5 0 1 1-3-4.9V16l16-4v2z"
                fill="white"
              />
            </svg>
            <span className="text-sm font-medium text-red-500 dark:text-red-400">小芸账号登录</span>
          </button>
        )}

        {/* Recently Played Button */}
        <button
          onClick={() => navigate('/recent')}
          className="p-2 rounded-full hover:bg-gray-100/80 dark:hover:bg-gray-800/60 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title="最近播放"
        >
          <Clock className="w-5 h-5" />
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-200/60 dark:bg-gray-700/60 mx-1" />

        {/* Download Button */}
        <button
          onClick={() => navigate('/downloads')}
          className="relative p-2 rounded-full hover:bg-gray-100/80 dark:hover:bg-gray-800/60 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title="下载管理"
        >
          <Download className="w-5 h-5" />
          {activeDownloads > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {activeDownloads > 9 ? '9+' : activeDownloads}
            </span>
          )}
        </button>

        {/* Source Switcher */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="p-2 rounded-full hover:bg-gray-100/80 dark:hover:bg-gray-800/60 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="切换音源 / 音质"
            >
              <Radio className="w-5 h-5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <SourceSwitcherContent />
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Theme Toggle */}
        <ThemeToggleButton />

        {/* Settings Button */}
        <button
          onClick={() => setShowSettingsModal(true)}
          className="p-2 rounded-full hover:bg-gray-100/80 dark:hover:bg-gray-800/60 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title="设置"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
