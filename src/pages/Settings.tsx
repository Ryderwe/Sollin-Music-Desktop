import { useRef, useState, useEffect, useMemo } from 'react'
import {
  Moon,
  Sun,
  Monitor,
  Volume2,
  Download,
  Upload,
  Trash2,
  Check,
  Database,
  HardDrive,
  RefreshCw,
  ExternalLink,
  Sparkles,
  Speaker,
  Power,
  AlertTriangle,
  Keyboard,
  Cloud,
  Music,
  FolderOpen,
  FileCode2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Ban,
  Plus,
  ArrowUp,
  ArrowDown,
  Play,
  Sliders,
  Settings as SettingsIcon,
  Image,
} from 'lucide-react'
import { useUserStore } from '@/stores/userStore'
import { useUIStore } from '@/stores/uiStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useFeatureStore } from '@/stores/featureStore'
import {
  DOWNLOAD_FILE_NAME_PARTS,
  type DownloadFileNamePart,
  useDownloadStore,
} from '@/stores/downloadStore'
import { useLocalMusicStore, type LocalMusicTagPriority } from '@/stores/localMusicStore'
import { cache } from '@/services/cache'
import { audioCache } from '@/services/audioCache'
import { analytics } from '@/services/analytics'
import { lxSourceApi, type LxManagedSource, type LxSourceStatus } from '@/services/lxSource'
import SourceSwitchSettingsPanel from '@/components/settings/SourceSwitchSettingsPanel'
import { useSourceSwitchSettingsStore } from '@/stores/sourceSwitchSettingsStore'
import { cn } from '@/utils/cn'
import ImageCropModal from '@/components/modals/ImageCropModal'
import { QUALITY_NAMES, QUALITY_OPTIONS } from '@/constants/audio'
import { APP_VERSION } from '@/config'
import { checkGithubUpdate } from '@/services/githubUpdate'
import {
  buildWebDavBackupData,
  createWebDavBackupFileName,
  getWebDavBackupIncludedSelection,
  parseLegacyBackupData,
  parseWebDavBackupData,
  restoreWebDavBackupData,
  stringifyWebDavBackupData,
} from '@/services/backupStrategy'
import { BACKUP_ITEM_ORDER, createBackupSelection, hasSelectedBackupItems } from '@/constants/backup'
import { PLAYER_MODE_OPTIONS } from '@/constants/playerModes'
import type { BackupSelection } from '@/types/backup'
import BackupModal from '@/components/modals/BackupModal'
import BackupItemChecklist from '@/components/backup/BackupItemChecklist'
import { EQ_FREQUENCIES, EQ_PRESETS, REVERB_PRESETS, playAudioOutputTestTone } from '@/utils/audioEffects'
import {
  DEFAULT_GLOBAL_SHORTCUTS,
  GLOBAL_SHORTCUT_ITEMS,
  createEmptyGlobalShortcutStatus,
  formatGlobalShortcut,
  keyboardEventToAccelerator,
  type GlobalShortcutAction,
  type GlobalShortcutConfig,
  type GlobalShortcutState,
  type GlobalShortcutStatusMap,
} from '@/utils/globalShortcuts'
import { parseDislikeRules } from '@/services/dislikeRules'
import dataSyncService from '@/services/dataSync'
import type { DataSyncStatus } from '@/types/dataSync'

const THEMES = [
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Monitor },
] as const

const LX_SOURCE_LABELS: Record<string, string> = {
  wy: '小芸音乐',
  tx: '小秋音乐',
  kg: '小枸音乐',
  kw: '小蜗音乐',
  mg: '小蜜音乐',
}

const LX_SOURCE_TYPE_LABELS: Record<LxManagedSource['type'], string> = {
  local: '本地脚本',
  url: 'URL 导入',
}

const DOWNLOAD_FILE_NAME_PART_LABELS: Record<DownloadFileNamePart, string> = {
  artist: '歌手',
  album: '专辑',
  title: '歌名',
}

const DOWNLOAD_FILE_NAME_SEPARATOR_PRESETS = ['-', ' - ', '｜', '_', '·'] as const

const formatLxSourceImportedAt = (timestamp: number) => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未知'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

const buildDownloadFileNamePreview = (enabled: boolean, parts: DownloadFileNamePart[], separator: string) => {
  if (!enabled) return '歌手 - 歌名'

  const visibleParts = parts.length ? parts : ['artist', 'title'] as DownloadFileNamePart[]
  const visibleSeparator = separator || '-'
  return visibleParts.map((part) => DOWNLOAD_FILE_NAME_PART_LABELS[part]).join(visibleSeparator)
}

const SETTINGS_NAV_GROUPS = [
  {
    id: 'group-sources',
    label: '音源',
    icon: FileCode2,
    items: [
      { id: 'source', label: '音源管理', icon: FileCode2 },
      { id: 'source-switch', label: '智能换源', icon: RefreshCw },
      { id: 'dislike', label: '屏蔽规则', icon: Ban },
    ],
  },
  {
    id: 'group-data',
    label: '数据',
    icon: Database,
    items: [
      { id: 'data', label: '数据管理', icon: Database },
      { id: 'data-sync', label: '数据同步', icon: RefreshCw },
      { id: 'cache', label: '缓存管理', icon: HardDrive },
    ],
  },
  {
    id: 'group-download',
    label: '下载与本地',
    icon: Download,
    items: [
      { id: 'download', label: '下载设置', icon: Download },
      { id: 'local-music', label: '本地音乐', icon: FolderOpen },
    ],
  },
  {
    id: 'group-system',
    label: '系统',
    icon: SettingsIcon,
    items: [
      { id: 'stats', label: '使用统计', icon: Database },
      { id: 'appearance', label: '外观', icon: Sun },
      { id: 'background', label: '背景自定义', icon: Image },
      { id: 'close', label: '关闭行为', icon: Power },
      { id: 'shortcut', label: 'Global Shortcuts', icon: Keyboard },
      { id: 'update', label: '软件更新', icon: Sparkles },
      { id: 'about', label: '关于', icon: Music },
    ],
  },
  {
    id: 'group-audio',
    label: '音效',
    icon: Volume2,
    items: [
      { id: 'audio-quality', label: '音质选择', icon: Volume2 },
      { id: 'audio-effects', label: '音效处理', icon: Sliders },
      { id: 'device', label: '音频设备', icon: Speaker },
    ],
  },
]

const SYSTEM_FONTS = [
  { id: '', label: '系统默认' },
  { id: 'PingFang SC, sans-serif', label: '苹方 (PingFang SC)' },
  { id: '"Hiragino Sans GB", sans-serif', label: '冬青黑体' },
  { id: '"Microsoft YaHei", sans-serif', label: '微软雅黑' },
  { id: '"Source Han Sans SC", sans-serif', label: '思源黑体' },
  { id: '"Noto Sans SC", sans-serif', label: 'Noto Sans SC' },
  { id: '"SF Pro Display", sans-serif', label: 'SF Pro Display' },
  { id: '"Helvetica Neue", sans-serif', label: 'Helvetica Neue' },
  { id: 'Georgia, serif', label: 'Georgia' },
  { id: '"Times New Roman", serif', label: 'Times New Roman' },
  { id: '"Courier New", monospace', label: 'Courier New' },
]

function FontSettings() {
  const fontFamily = useUIStore((s) => s.fontFamily)
  const customFontDataUrl = useUIStore((s) => s.customFontDataUrl)
  const setFontFamily = useUIStore((s) => s.setFontFamily)
  const setCustomFontDataUrl = useUIStore((s) => s.setCustomFontDataUrl)
  const addToast = useUIStore((s) => s.addToast)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isCustomFont = fontFamily === 'CustomImportedFont, sans-serif'

  // Apply custom font face on mount if we have a data URL
  useEffect(() => {
    if (customFontDataUrl && isCustomFont) {
      applyCustomFontFace(customFontDataUrl)
    }
  }, [])

  // Apply persisted font on mount
  useEffect(() => {
    if (fontFamily) {
      document.documentElement.style.setProperty('--app-font-family', fontFamily)
    }
  }, [])

  const applyCustomFontFace = (dataUrl: string) => {
    // Remove existing custom font style if any
    const existing = document.getElementById('custom-font-face')
    if (existing) existing.remove()

    const style = document.createElement('style')
    style.id = 'custom-font-face'
    style.textContent = `
      @font-face {
        font-family: 'CustomImportedFont';
        src: url('${dataUrl}');
        font-weight: normal;
        font-style: normal;
      }
    `
    document.head.appendChild(style)
  }

  const handleImportFont = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validExtensions = ['.ttf', '.otf', '.woff', '.woff2']
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
    if (!validExtensions.includes(ext)) {
      addToast({ type: 'error', message: '不支持的字体格式，请使用 TTF/OTF/WOFF/WOFF2' })
      return
    }

    if (file.size > 20 * 1024 * 1024) {
      addToast({ type: 'error', message: '字体文件过大（最大 20MB）' })
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      applyCustomFontFace(dataUrl)
      setCustomFontDataUrl(dataUrl)
      setFontFamily('CustomImportedFont, sans-serif')
      addToast({ type: 'success', message: `已导入字体: ${file.name}` })
    }
    reader.onerror = () => {
      addToast({ type: 'error', message: '读取字体文件失败' })
    }
    reader.readAsDataURL(file)

    // Reset input
    e.target.value = ''
  }

  const handleSelectSystemFont = (font: string) => {
    setFontFamily(font)
    document.documentElement.style.setProperty('--app-font-family', font)
  }

  const handleReset = () => {
    setFontFamily('')
    setCustomFontDataUrl('')
    document.documentElement.style.setProperty('--app-font-family', '')
    const existing = document.getElementById('custom-font-face')
    if (existing) existing.remove()
    addToast({ type: 'info', message: '已恢复默认字体' })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">全局字体</h3>
        {fontFamily && (
          <button
            onClick={handleReset}
            className="text-xs text-primary-500 hover:text-primary-600 transition-colors"
          >
            恢复默认
          </button>
        )}
      </div>

      {/* System font presets */}
      <div className="grid grid-cols-2 gap-2">
        {SYSTEM_FONTS.map((font) => (
          <button
            key={font.id}
            onClick={() => handleSelectSystemFont(font.id)}
            className={cn(
              'px-3 py-2 text-sm rounded-lg border transition-all text-left truncate',
              fontFamily === font.id
                ? 'border-primary-500 bg-primary-500/5 text-primary-600 dark:text-primary-400'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-[var(--text-secondary)]'
            )}
            style={{ fontFamily: font.id || undefined }}
          >
            {font.label}
          </button>
        ))}
      </div>

      {/* Import custom font */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex-1 px-3 py-2 text-sm rounded-lg border border-dashed transition-all text-center',
            isCustomFont
              ? 'border-primary-500 bg-primary-500/5 text-primary-600 dark:text-primary-400'
              : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          )}
        >
          {isCustomFont ? '✓ 已导入自定义字体' : '导入字体文件 (TTF/OTF/WOFF/WOFF2)'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          onChange={handleImportFont}
          className="hidden"
        />
      </div>

      {/* Preview */}
      <div
        className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-sm text-[var(--text-secondary)]"
        style={{ fontFamily: fontFamily || undefined }}
      >
        字体预览：The quick brown fox jumps over the lazy dog. 你好世界 1234567890
      </div>
    </div>
  )
}

export default function Settings() {
  const { playlists, localPlaylists, onlinePlaylists, favorites, localFavorites, playHistory, clearAllData } = useUserStore()
  const { theme, setTheme, addToast, closeBehavior, setCloseBehavior, backgroundSettings, setBackgroundSettings, resetBackgroundSettings, lyricsPlayerMode, setLyricsPlayerMode } = useUIStore()
  const { dislikeRules, setDislikeRules, clearDislikeRules, searchHistory, clearSearchHistory } = useFeatureStore()
  const {
    quality,
    setQuality,
    setAutoTemporarySourceSwitch,
    audioOutputDeviceId,
    availableAudioDevices,
    isSwitchingAudioOutputDevice,
    loadAudioDevices,
    setAudioOutputDevice,
    audioEffects,
    setAudioVisualizationEnabled,
    setEqEnabled,
    setEqPreset,
    setEqGain,
    resetEq,
    setReverbEnabled,
    setReverbPreset,
    setReverbMainGain,
    setReverbSendGain,
    setSpatialAudioEnabled,
    setSpatialAudioRadius,
    setSpatialAudioSpeed,
    setPlaybackRate,
  } = usePlayerStore()
  const downloadFileNameRuleEnabled = useDownloadStore((state) => state.downloadFileNameRuleEnabled)
  const downloadFileNameParts = useDownloadStore((state) => state.downloadFileNameParts)
  const downloadFileNameSeparator = useDownloadStore((state) => state.downloadFileNameSeparator)
  const saveExternalMetadataFiles = useDownloadStore((state) => state.saveExternalMetadataFiles)
  const setDownloadFileNameRuleEnabled = useDownloadStore((state) => state.setDownloadFileNameRuleEnabled)
  const setDownloadFileNameParts = useDownloadStore((state) => state.setDownloadFileNameParts)
  const setDownloadFileNameSeparator = useDownloadStore((state) => state.setDownloadFileNameSeparator)
  const setSaveExternalMetadataFiles = useDownloadStore((state) => state.setSaveExternalMetadataFiles)
  const resetDownloadFileNameRule = useDownloadStore((state) => state.resetDownloadFileNameRule)
  const localMusicTagPriority = useLocalMusicStore((state) => state.tagPriority)
  const setLocalMusicTagPriority = useLocalMusicStore((state) => state.setTagPriority)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeSection, setActiveSection] = useState('source')
  const [activeGroup, setActiveGroup] = useState('group-sources')
  const activeGroupSectionIds = useMemo(() => {
    const group = SETTINGS_NAV_GROUPS.find((g) => g.id === activeGroup)
    return group ? group.items.map((item) => item.id) : []
  }, [activeGroup])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(SETTINGS_NAV_GROUPS.map((g) => g.id))
  )
  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }
  const [dataCacheEnabled, setDataCacheEnabled] = useState(cache.getSettings().enabled)
  const [dataCacheLimitMB, setDataCacheLimitMB] = useState(cache.getSettings().maxSizeMB)
  const [cacheSize, setCacheSize] = useState(cache.getCacheSize())
  const [audioCacheEnabled, setAudioCacheEnabled] = useState(audioCache.getSettings().enabled)
  const [audioCacheLimitMB, setAudioCacheLimitMB] = useState(audioCache.getSettings().maxSizeMB)
  const [audioCacheStats, setAudioCacheStats] = useState<{ count: number; totalSize: number }>({ count: 0, totalSize: 0 })
  const [dataSyncStatus, setDataSyncStatus] = useState<DataSyncStatus>(() => dataSyncService.getStatus())
  const [dataSyncClientHost, setDataSyncClientHost] = useState('')
  const [dataSyncConnectionCodeInput, setDataSyncConnectionCodeInput] = useState('')
  const [isSavingDataSync, setIsSavingDataSync] = useState(false)
  const [dislikeRulesDraft, setDislikeRulesDraft] = useState(dislikeRules)
  const [isClearingAudioCache, setIsClearingAudioCache] = useState(false)
  const [stats, setStats] = useState(analytics.getStats())
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{
    hasUpdate: boolean
    latestVersion: string
    changelog: string[]
    downloadUrl: string
  } | null>(null)
  const [lxSourceStatus, setLxSourceStatus] = useState<LxSourceStatus | null>(null)
  const [lxScriptPathInput, setLxScriptPathInput] = useState('')
  const [lxScriptUrlInput, setLxScriptUrlInput] = useState('')
  const [isLoadingLxSourceStatus, setIsLoadingLxSourceStatus] = useState(false)
  const [isSavingLxSourcePath, setIsSavingLxSourcePath] = useState(false)
  const [isImportingLxSourceUrl, setIsImportingLxSourceUrl] = useState(false)
  const [isSavingLxSourceUpdateAlert, setIsSavingLxSourceUpdateAlert] = useState(false)
  const [activeLxSourceActionId, setActiveLxSourceActionId] = useState<string | null>(null)
  const [removeLxSourceActionId, setRemoveLxSourceActionId] = useState<string | null>(null)
  const [updateLxSourceAlertActionId, setUpdateLxSourceAlertActionId] = useState<string | null>(null)
  const [expandedLxSourceIds, setExpandedLxSourceIds] = useState<string[]>([])
  const [isLxSourceExpanded, setIsLxSourceExpanded] = useState(false)
  const [isPickingLxSourcePath, setIsPickingLxSourcePath] = useState(false)

  const electronApi = typeof window !== 'undefined' ? window.electronAPI : undefined
  const hasElectronApi = Boolean(electronApi)
  const hasLxSourceStatusMethod = typeof electronApi?.getLxSourceStatus === 'function'
  const hasGlobalShortcutApi = typeof electronApi?.getGlobalShortcutState === 'function' && typeof electronApi?.setGlobalShortcutConfig === 'function'
  const electronApiMethods = electronApi ? Object.keys(electronApi).join(', ') : ''

  // Modal states
  const [showBackupModal, setShowBackupModal] = useState(false)
  const [showExportSelectionModal, setShowExportSelectionModal] = useState(false)
  const [cropModalOpen, setCropModalOpen] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [offlineExportSelection, setOfflineExportSelection] = useState<BackupSelection>(() => createBackupSelection())
  const [webDavImportSelection, setWebDavImportSelection] = useState<BackupSelection>(() => createBackupSelection())
  const [isExportingBackup, setIsExportingBackup] = useState(false)
  const [shortcutPlatform, setShortcutPlatform] = useState<string>(() => navigator.userAgent.includes('Mac') ? 'darwin' : 'win32')
  const [globalShortcutConfig, setGlobalShortcutConfig] = useState<GlobalShortcutConfig>(DEFAULT_GLOBAL_SHORTCUTS)
  const [globalShortcutStatus, setGlobalShortcutStatus] = useState<GlobalShortcutStatusMap>(
    createEmptyGlobalShortcutStatus(DEFAULT_GLOBAL_SHORTCUTS)
  )
  const [isLoadingGlobalShortcuts, setIsLoadingGlobalShortcuts] = useState(false)
  const [recordingShortcutAction, setRecordingShortcutAction] = useState<GlobalShortcutAction | null>(null)
  const [testingAudioDeviceId, setTestingAudioDeviceId] = useState<string | null>(null)
  const dislikeRuleStats = parseDislikeRules(dislikeRulesDraft)
  const savedDislikeRuleCount = parseDislikeRules(dislikeRules).count
  const downloadFileNamePreview = buildDownloadFileNamePreview(
    downloadFileNameRuleEnabled,
    downloadFileNameParts,
    downloadFileNameSeparator,
  )
  const availableDownloadFileNameParts = DOWNLOAD_FILE_NAME_PARTS.filter((part) => !downloadFileNameParts.includes(part))

  const updateDownloadFileNamePart = (index: number, part: DownloadFileNamePart) => {
    const nextParts = downloadFileNameParts.slice()
    nextParts[index] = part
    setDownloadFileNameParts(nextParts)
  }

  const moveDownloadFileNamePart = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= downloadFileNameParts.length) return

    const nextParts = downloadFileNameParts.slice()
    const current = nextParts[index]
    nextParts[index] = nextParts[targetIndex]
    nextParts[targetIndex] = current
    setDownloadFileNameParts(nextParts)
  }

  const removeDownloadFileNamePart = (index: number) => {
    if (downloadFileNameParts.length <= 1) return
    setDownloadFileNameParts(downloadFileNameParts.filter((_, itemIndex) => itemIndex !== index))
  }

  const addDownloadFileNamePart = (part: DownloadFileNamePart) => {
    setDownloadFileNameParts([...downloadFileNameParts, part])
  }

  const applyLxSourceStatus = (status: LxSourceStatus) => {
    setLxSourceStatus(status)
    setLxScriptPathInput(status.configuredPath || status.scriptPath || '')
    setLxScriptUrlInput(status.scriptUrl || '')
    // Keep the cross-script ordering section of the source-switch settings panel in sync with
    // the latest list of imported scripts.
    try {
      const ids = (status.managedSources || []).map((item) => item.id)
      useSourceSwitchSettingsStore.getState().syncScriptList(ids)
    } catch (error) {
      console.warn('[Settings] sync source-switch script list failed:', error)
    }
  }

  const applyGlobalShortcutState = (state: GlobalShortcutState) => {
    setGlobalShortcutConfig(state.config)
    setGlobalShortcutStatus(state.status)
  }

  /*
  const saveGlobalShortcutConfig = async(nextConfig: GlobalShortcutConfig, successMessage?: string) => {
    if (!electronApi?.setGlobalShortcutConfig) {
      addToast({ type: 'error', message: '当前环境不支持全局快捷键设置' })
      return
    }

    setIsLoadingGlobalShortcuts(true)
    try {
      const state = await electronApi.setGlobalShortcutConfig(nextConfig)
      applyGlobalShortcutState(state)

      const failedItems = GLOBAL_SHORTCUT_ITEMS.filter(({ action }) => {
        const itemStatus = state.status[action]
        return itemStatus.accelerator && !itemStatus.registered
      })

      if (failedItems.length > 0) {
        addToast({
          type: 'warning',
          message: `${failedItems.map((item) => item.label).join('、')} 未注册成功，可能已被系统或其他应用占用`,
        })
        return
      }

      if (successMessage) {
        addToast({ type: 'success', message: successMessage })
      }
    } catch (error) {
      console.error('Save global shortcut config failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '保存全局快捷键失败' })
    } finally {
      setIsLoadingGlobalShortcuts(false)
    }
  }
  */

  const saveGlobalShortcutConfig = async (nextConfig: GlobalShortcutConfig, successMessage?: string) => {
    if (!electronApi?.setGlobalShortcutConfig) {
      addToast({ type: 'error', message: 'Global shortcuts are not available in this environment.' })
      return
    }

    setIsLoadingGlobalShortcuts(true)
    try {
      const state = await electronApi.setGlobalShortcutConfig(nextConfig)
      applyGlobalShortcutState(state)

      const failedItems = GLOBAL_SHORTCUT_ITEMS.filter(({ action }) => {
        const itemStatus = state.status[action]
        return itemStatus.accelerator && !itemStatus.registered
      })

      if (failedItems.length > 0) {
        addToast({
          type: 'warning',
          message: `Failed to register: ${failedItems.map((item) => item.label).join(', ')}`,
        })
        return
      }

      if (successMessage) {
        addToast({ type: 'success', message: successMessage })
      }
    } catch (error) {
      console.error('Save global shortcut config failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to save global shortcuts.' })
    } finally {
      setIsLoadingGlobalShortcuts(false)
    }
  }

  const refreshLxSourceStatus = async (silent = false) => {
    setIsLoadingLxSourceStatus(true)
    try {
      const status = await lxSourceApi.getStatus()
      applyLxSourceStatus(status)

      if (!silent) {
        if (status.available) {
          addToast({ type: 'success', message: '音源状态已刷新' })
        } else {
          addToast({ type: 'error', message: '当前环境不支持 LX 音源管理' })
        }
      }
    } catch (error) {
      console.error('Refresh LX source status failed:', error)
      if (!silent) {
        addToast({ type: 'error', message: '获取音源状态失败' })
      }
    } finally {
      setIsLoadingLxSourceStatus(false)
    }
  }

  const handlePickLxSourceScript = async () => {
    setIsPickingLxSourcePath(true)
    try {
      const nextPath = await lxSourceApi.pickScriptPath()
      if (!nextPath) return
      setLxScriptPathInput(nextPath)
      addToast({ type: 'success', message: '已选择音源脚本，请点击应用' })
    } catch (error) {
      console.error('Pick LX source script failed:', error)
      addToast({ type: 'error', message: '选择音源脚本失败' })
    } finally {
      setIsPickingLxSourcePath(false)
    }
  }

  const handleApplyLxSourceScript = async () => {
    const nextPath = lxScriptPathInput.trim()
    if (!nextPath) {
      addToast({ type: 'error', message: '请输入脚本路径或恢复自动检测' })
      return
    }

    setIsSavingLxSourcePath(true)
    try {
      const status = await lxSourceApi.setScriptPath(nextPath)
      applyLxSourceStatus(status)

      if (status.scriptLoaded) {
        addToast({ type: 'success', message: '音源脚本已切换并完成加载' })
      } else {
        addToast({ type: 'error', message: status.lastError || '音源脚本加载失败' })
      }
    } catch (error) {
      console.error('Apply LX source script failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '切换音源脚本失败' })
    } finally {
      setIsSavingLxSourcePath(false)
    }
  }

  const handleResetLxSourceScript = async () => {
    setIsSavingLxSourcePath(true)
    try {
      const status = await lxSourceApi.clearScriptPath()
      applyLxSourceStatus(status)

      if (status.scriptLoaded) {
        addToast({ type: 'success', message: '已恢复自动检测音源脚本' })
      } else if (status.scriptPath) {
        addToast({ type: 'info', message: status.lastError || '已恢复自动检测，但脚本尚未成功加载' })
      } else {
        addToast({ type: 'info', message: '已清除手动配置，请放置或重新选择音源脚本' })
      }
    } catch (error) {
      console.error('Reset LX source script failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '恢复自动检测失败' })
    } finally {
      setIsSavingLxSourcePath(false)
    }
  }

  const handleImportLxSourceFromUrl = async () => {
    const url = lxScriptUrlInput.trim()
    if (!url) {
      addToast({ type: 'error', message: '请输入音源 URL' })
      return
    }

    setIsImportingLxSourceUrl(true)
    try {
      const status = await lxSourceApi.importScriptUrl(url)
      applyLxSourceStatus(status)

      if (status.scriptLoaded) {
        addToast({ type: 'success', message: '已通过 URL 导入并切换音源脚本' })
      } else {
        addToast({ type: 'error', message: status.lastError || '音源脚本导入成功，但加载失败' })
      }
    } catch (error) {
      console.error('Import LX source script from url failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : 'URL 导入失败' })
    } finally {
      setIsImportingLxSourceUrl(false)
    }
  }

  const handleToggleLxSourceUpdateAlert = async (sourceId?: string) => {
    if (!lxSourceStatus) return

    const targetSource = (sourceId
      ? lxSourceStatus.managedSources.find((item) => item.id === sourceId)
      : lxSourceStatus.managedSources.find((item) => item.id === lxSourceStatus.activeSourceId)) || null
    const nextEnabled = targetSource ? !targetSource.allowShowUpdateAlert : !lxSourceStatus.allowShowUpdateAlert

    setIsSavingLxSourceUpdateAlert(true)
    setUpdateLxSourceAlertActionId(targetSource?.id || '__active__')
    try {
      const status = targetSource
        ? await lxSourceApi.setSourceAllowUpdateAlert(targetSource.id, nextEnabled)
        : await lxSourceApi.setAllowShowUpdateAlert(nextEnabled)
      applyLxSourceStatus(status)
      addToast({
        type: 'success',
        message: targetSource
          ? `${nextEnabled ? '已开启' : '已关闭'}「${targetSource.scriptInfo.name || '未命名音源'}」的更新提醒`
          : nextEnabled ? '已开启音源更新弹窗' : '已关闭音源更新弹窗',
      })
    } catch (error) {
      console.error('Toggle LX source update alert failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '更新弹窗设置失败' })
    } finally {
      setIsSavingLxSourceUpdateAlert(false)
      setUpdateLxSourceAlertActionId(null)
    }
  }

  const handleSetActiveLxSource = async (source: LxManagedSource) => {
    if (source.isActive || !source.exists) return

    setActiveLxSourceActionId(source.id)
    try {
      const status = await lxSourceApi.setActiveSource(source.id)
      applyLxSourceStatus(status)
      addToast({
        type: status.scriptLoaded ? 'success' : 'info',
        message: status.scriptLoaded
          ? `已切换到「${source.scriptInfo.name || '未命名音源'}」`
          : status.lastError || `已切换到「${source.scriptInfo.name || '未命名音源'}」，但脚本尚未成功加载`,
      })
    } catch (error) {
      console.error('Set active LX source failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '切换音源失败' })
    } finally {
      setActiveLxSourceActionId(null)
    }
  }

  const handleRemoveLxSource = async (source: LxManagedSource) => {
    const sourceName = source.scriptInfo.name || '未命名音源'
    if (!window.confirm(`确定删除音源「${sourceName}」吗？${source.isActive ? '当前正在使用的音源删除后将恢复自动检测。' : ''}`)) {
      return
    }

    setRemoveLxSourceActionId(source.id)
    try {
      const status = await lxSourceApi.removeSource(source.id)
      applyLxSourceStatus(status)
      setExpandedLxSourceIds((current) => current.filter((id) => id !== source.id))
      addToast({ type: 'success', message: `已删除音源「${sourceName}」` })
    } catch (error) {
      console.error('Remove LX source failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '删除音源失败' })
    } finally {
      setRemoveLxSourceActionId(null)
    }
  }


  const handleToggleLxSourceDetails = (sourceId: string) => {
    setExpandedLxSourceIds((current) => current.includes(sourceId)
      ? current.filter((id) => id !== sourceId)
      : [...current, sourceId])
  }

  useEffect(() => {
    void refreshLxSourceStatus(true)
  }, [])

  useEffect(() => {
    setDislikeRulesDraft(dislikeRules)
  }, [dislikeRules])

  useEffect(() => {
    const unsubscribe = dataSyncService.onStatus((status) => {
      setDataSyncStatus(status)
      setDataSyncClientHost((current) => current || status.clientHost || '')
    })

    void dataSyncService.refreshStatus().then((status) => {
      setDataSyncStatus(status)
      setDataSyncClientHost(status.clientHost || '')
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadGlobalShortcuts = async() => {
      if (!electronApi?.getGlobalShortcutState) return

      setIsLoadingGlobalShortcuts(true)
      try {
        const [platform, state] = await Promise.all([
          electronApi.getPlatform?.().catch(() => navigator.userAgent.includes('Mac') ? 'darwin' : 'win32'),
          electronApi.getGlobalShortcutState(),
        ])

        if (cancelled) return
        if (typeof platform === 'string') {
          setShortcutPlatform(platform)
        }
        setGlobalShortcutConfig(state.config)
        setGlobalShortcutStatus(state.status)
      } catch (error) {
        console.error('Load global shortcut config failed:', error)
      } finally {
        if (!cancelled) {
          setIsLoadingGlobalShortcuts(false)
        }
      }
    }

    void loadGlobalShortcuts()

    return () => {
      cancelled = true
    }
  }, [electronApi])

  useEffect(() => {
    if (!recordingShortcutAction) return

    const handleShortcutRecording = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecordingShortcutAction(null)
        return
      }

      const accelerator = keyboardEventToAccelerator(event)
      if (!accelerator) {
        addToast({
          type: 'warning',
          message: '请使用带 Ctrl / Cmd、Alt、Shift 的组合键，或使用功能键 / 媒体键',
        })
        return
      }

      const actionItem = GLOBAL_SHORTCUT_ITEMS.find((item) => item.action === recordingShortcutAction)
      void saveGlobalShortcutConfig(
        {
          ...globalShortcutConfig,
          [recordingShortcutAction]: accelerator,
        },
        `${actionItem?.label || '快捷键'}已更新为 ${formatGlobalShortcut(accelerator, shortcutPlatform)}`,
      )
      setRecordingShortcutAction(null)
    }

    window.addEventListener('keydown', handleShortcutRecording, true)
    return () => {
      window.removeEventListener('keydown', handleShortcutRecording, true)
    }
  }, [recordingShortcutAction, addToast, globalShortcutConfig, shortcutPlatform, saveGlobalShortcutConfig])

  useEffect(() => {
    if (activeSection !== 'device') return

    loadAudioDevices()

    const handleDeviceChange = () => {
      loadAudioDevices()
    }
    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange)

    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [activeSection, loadAudioDevices])


  // Update cache size and stats periodically
  useEffect(() => {
    setCacheSize(cache.getCacheSize())
    setStats(analytics.getStats())

    // Load audio cache stats
    const loadAudioCacheStats = async () => {
      const stats = await audioCache.getStats()
      setAudioCacheStats({ count: stats.count, totalSize: stats.totalSize })
    }
    loadAudioCacheStats()

    const interval = setInterval(() => {
      setStats(analytics.getStats())
    }, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [])

  // Scroll to section
  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId)
    const parentGroup = SETTINGS_NAV_GROUPS.find((g) => g.items.some((item) => item.id === sectionId))
    if (parentGroup) {
      setExpandedGroups((prev) => new Set(prev).add(parentGroup.id))
      setActiveGroup(parentGroup.id)
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const element = document.getElementById(`section-${sectionId}`)
        element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  // Observe sections for active state
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace('section-', '')
            setActiveSection(id)
          }
        })
      },
      { threshold: 0.5, rootMargin: '-100px 0px -50% 0px' }
    )

    activeGroupSectionIds.forEach((id) => {
      const element = document.getElementById(`section-${id}`)
      if (element) observer.observe(element)
    })

    return () => observer.disconnect()
  }, [activeGroupSectionIds])

  // Check for updates
  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true)
    setUpdateInfo(null)

    try {
      const data = await checkGithubUpdate(APP_VERSION)
      const mapped = {
        hasUpdate: data.hasUpdate,
        latestVersion: data.latestVersion,
        changelog: data.releaseNotes,
        downloadUrl: data.downloadUrl,
      }

      setUpdateInfo(mapped)

      if (mapped.hasUpdate) {
        addToast({ type: 'info', message: `发现新版本 ${mapped.latestVersion}` })
      } else {
        addToast({ type: 'success', message: '已是最新版本' })
      }
    } catch (error) {
      console.error('Check update failed:', error)
      addToast({ type: 'error', message: '检查更新失败，请稍后重试' })
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  // Open download URL
  const handleDownload = () => {
    if (updateInfo?.downloadUrl) {
      window.open(updateInfo.downloadUrl, '_blank')
    }
  }

  // Clear cache
  const handleClearCache = () => {
    cache.clearAll()
    setCacheSize(cache.getCacheSize())
    addToast({ type: 'success', message: '缓存已清除' })
  }

  // Play a short beep through the selected device to confirm the output is actually routed
  // there.  Runs on its own throwaway <audio> element so the current song keeps playing.
  const handleTestAudioDevice = async (deviceId: string, deviceLabel: string) => {
    if (testingAudioDeviceId) return
    setTestingAudioDeviceId(deviceId)
    try {
      const result = await playAudioOutputTestTone(deviceId)
      if (result.success) {
        addToast({ type: 'success', message: `已在 ${deviceLabel} 播放测试音` })
      } else {
        addToast({ type: 'error', message: result.message || '测试音频设备失败' })
      }
    } finally {
      setTestingAudioDeviceId(null)
    }
  }

  const handleToggleDataCache = () => {
    const next = !dataCacheEnabled
    const settings = cache.updateSettings({ enabled: next })
    setDataCacheEnabled(settings.enabled)
    setDataCacheLimitMB(settings.maxSizeMB)
    setCacheSize(cache.getCacheSize())
    addToast({ type: 'success', message: next ? '已开启数据缓存' : '已关闭数据缓存' })
  }

  const handleApplyDataCacheLimit = () => {
    const nextLimit = Math.min(256, Math.max(1, Math.round(dataCacheLimitMB)))
    const settings = cache.updateSettings({ maxSizeMB: nextLimit })
    setDataCacheEnabled(settings.enabled)
    setDataCacheLimitMB(settings.maxSizeMB)
    setCacheSize(cache.getCacheSize())
    addToast({ type: 'success', message: `数据缓存上限已设置为 ${settings.maxSizeMB} MB` })
  }

  // Clear audio cache
  const handleClearAudioCache = async () => {
    setIsClearingAudioCache(true)
    try {
      await audioCache.clearAll()
      setAudioCacheStats({ count: 0, totalSize: 0 })
      addToast({ type: 'success', message: '音频缓存已清除' })
    } catch (error) {
      addToast({ type: 'error', message: '清除音频缓存失败' })
    } finally {
      setIsClearingAudioCache(false)
    }
  }

  const handleToggleAudioCache = async () => {
    const next = !audioCacheEnabled
    const settings = await audioCache.updateSettings({ enabled: next })
    setAudioCacheEnabled(settings.enabled)
    setAudioCacheLimitMB(settings.maxSizeMB)
    const stats = await audioCache.getStats()
    setAudioCacheStats({ count: stats.count, totalSize: stats.totalSize })
    addToast({ type: 'success', message: next ? '已开启音频缓存' : '已关闭音频缓存' })
  }

  const handleApplyAudioCacheLimit = async () => {
    const nextLimit = Math.min(4096, Math.max(32, Math.round(audioCacheLimitMB)))
    const settings = await audioCache.updateSettings({ maxSizeMB: nextLimit })
    setAudioCacheEnabled(settings.enabled)
    setAudioCacheLimitMB(settings.maxSizeMB)
    const stats = await audioCache.getStats()
    setAudioCacheStats({ count: stats.count, totalSize: stats.totalSize })
    addToast({ type: 'success', message: `音频缓存上限已设置为 ${settings.maxSizeMB} MB` })
  }

  // Export all user data
  const handleExport = async() => {
    if (!hasSelectedBackupItems(offlineExportSelection)) {
      addToast({ type: 'warning', message: '请至少选择一个备份项目' })
      return
    }

    setIsExportingBackup(true)
    try {
      const data = await buildWebDavBackupData({ selection: offlineExportSelection })
      const blob = new Blob([stringifyWebDavBackupData(data)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = createWebDavBackupFileName(new Date(data.createdAt))
      a.click()
      URL.revokeObjectURL(url)

      addToast({ type: 'success', message: '离线备份文件已导出' })
      setShowExportSelectionModal(false)
      setOfflineExportSelection(createBackupSelection())
    } catch (error: any) {
      addToast({ type: 'error', message: error.message || '导出备份失败' })
    } finally {
      setIsExportingBackup(false)
    }
  }

  // Import user data
  const [showImportConfirm, setShowImportConfirm] = useState(false)
  const [importData, setImportData] = useState<any>(null)

  // Conflict resolution state
  const [conflicts, setConflicts] = useState<any[]>([])
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0)
  const [resolutionAction, setResolutionAction] = useState<'rename' | 'replace'>('rename')
  const [renameValue, setRenameValue] = useState('')
  const [finalImportPlaylists, setFinalImportPlaylists] = useState<any[]>([])

  const getDisabledBackupSelection = (selection: BackupSelection) => {
    return BACKUP_ITEM_ORDER.reduce((result, key) => {
      result[key] = !selection[key]
      return result
    }, createBackupSelection(false))
  }

  const getWebDavImportExtraText = (data: any) => {
    const summary = data?.summary
    return {
      onlineFavorites: `${summary?.onlineFavoritesCount || 0} 条在线喜欢`,
      onlinePlaylists: `${summary?.onlinePlaylistsCount || 0} 个导入歌单`,
      neteaseCookie: summary?.hasNeteaseCookie ? '包含云音乐 Cookie' : '未包含 Cookie',
      lxSources: `${summary?.lxSourceCount || 0} 个 LX 音源`,
    }
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string)
        const looksLikeWebDav = Boolean(
          data?.schemaVersion != null ||
          data?.createdAt != null ||
          data?.data?.onlineFavorites != null ||
          data?.data?.onlinePlaylists != null ||
          data?.data?.lxSources != null ||
          data?.data?.neteaseCookie !== undefined
        )

        if (looksLikeWebDav) {
          const parsedBackup = parseWebDavBackupData(data)
          setImportData({ kind: 'webdav', data: parsedBackup })
          setWebDavImportSelection(getWebDavBackupIncludedSelection(parsedBackup))
        } else if (parseLegacyBackupData(data)) {
          setImportData({ kind: 'legacy', data })
        } else {
          throw new Error('无效的备份文件')
        }
        setShowImportConfirm(true)
        // Reset conflict state
        setConflicts([])
        setCurrentConflictIndex(0)
        setFinalImportPlaylists([])
      } catch (error) {
        addToast({ type: 'error', message: '导入失败：文件格式错误' })
      }
    }
    reader.readAsText(file)
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const executeMerge = (playlistsToMerge: any[], favoritesToMerge: any[], historyToMerge: any[]) => {
    const { playlists: currentPlaylists, favorites: currentFavorites, playHistory: currentHistory, updatePlaylist } = useUserStore.getState()

    let addedPlaylists = 0
    let updatedPlaylists = 0

    const newPlaylists = [...currentPlaylists]

    playlistsToMerge.forEach(pl => {
      // Check if this playlist is meant to replace a local one (by ID reuse or explicit logic)
      // But here we constructed `playlistsToMerge` such that:
      // - Renamed ones have new IDs (or same ID but unique name if we generated valid ID? No, usually keep ID if unique)
      // - Replaced ones: We actually update the LOCAL playlist in place and DO NOT add to newPlaylists

      if (pl._isReplacement) {
        // Update existing playlist
        updatePlaylist(pl.targetId, {
          songs: pl.songs,
          cover: pl.cover,
          description: pl.description
        })
        updatedPlaylists++
      } else {
        // Append new playlist
        // Ensure unique ID just in case
        if (!newPlaylists.some(p => p.id === pl.id)) {
          newPlaylists.push(pl)
          addedPlaylists++
        } else {
          // ID collision but not checking name? (Edge case). 
          // If ID exists and we didn't flag it as replacement, we probably shouldn't overwrite blindly.
          // For now assume strictly unique IDs from imports for new items.
          // Generate new ID if needed?
          const newPl = { ...pl, id: `imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` }
          newPlaylists.push(newPl)
          addedPlaylists++
        }
      }
    })

    useUserStore.setState({ playlists: newPlaylists })

    // Merge Favorites
    const newFavorites = [...currentFavorites]
    let addedFavorites = 0
    if (favoritesToMerge && Array.isArray(favoritesToMerge)) {
      favoritesToMerge.forEach((song: any) => {
        if (!newFavorites.some(s => s.id === song.id)) {
          newFavorites.push(song)
          addedFavorites++
        }
      })
      useUserStore.setState({ favorites: newFavorites })
    }

    // Merge History
    const newHistory = [...currentHistory]
    if (historyToMerge && Array.isArray(historyToMerge)) {
      historyToMerge.forEach((song: any) => {
        if (!newHistory.some(s => s.id === song.id)) {
          newHistory.push(song)
        }
      })
      useUserStore.setState({ playHistory: newHistory })
    }

    void useUserStore.getState().refreshLibraryCovers()
    addToast({ type: 'success', message: `数据导入成功：新增 ${addedPlaylists} 个歌单，替换 ${updatedPlaylists} 个，新增 ${addedFavorites} 首收藏` })
    setShowImportConfirm(false)
    setImportData(null)
  }

  const handleConfirmImport = async(method: 'merge' | 'replace') => {
    if (!importData) return

    try {
      if (importData.kind === 'webdav') {
        const result = await restoreWebDavBackupData(importData.data, {
          selection: webDavImportSelection,
        })
        if (result.warnings.length) {
          addToast({ type: 'warning', message: result.warnings[0] })
        }
        addToast({
          type: 'success',
          message: `跨端备份已恢复：${result.onlineFavoritesCount} 条在线喜欢，${result.onlinePlaylistsCount} 个导入歌单，${result.lxSourceCount} 个 LX 音源`,
        })
        setShowImportConfirm(false)
        setImportData(null)
        setWebDavImportSelection(createBackupSelection())
        return
      }

      const data = importData.data

      if (method === 'replace') {
        // ... existing replace logic ...
        if (data.playlists) useUserStore.setState({ playlists: data.playlists })
        if (data.favorites) useUserStore.setState({ favorites: data.favorites })
        if (data.playHistory) useUserStore.setState({ playHistory: data.playHistory })
        void useUserStore.getState().refreshLibraryCovers()
        if (data.settings?.theme) setTheme(data.settings.theme)
        if (data.settings?.quality) setQuality(data.settings.quality)
        if (typeof data.settings?.autoTemporarySourceSwitch === 'boolean') setAutoTemporarySourceSwitch(data.settings.autoTemporarySourceSwitch)
        addToast({ type: 'success', message: '数据已恢复（覆盖模式）' })
        setShowImportConfirm(false)
        setImportData(null)
      } else {
        // Merge mode - Check for conflicts
        const { playlists: currentPlaylists } = useUserStore.getState()
        const importedPlaylists = data.playlists || []

        // Find conflicts: same name, different content (assume different ID or same ID)
        // Actually, if same ID, it's technically a collision too, but "Merge" usually implies keeping/merging.
        // Let's focus on Name Collision as requested.

        const potentialConflicts: any[] = []
        const safePlaylists: any[] = []

        importedPlaylists.forEach((impPl: any) => {
          const conflict = currentPlaylists.find(curr => curr.name === impPl.name)
          if (conflict) {
            potentialConflicts.push({ imported: impPl, existing: conflict })
          } else {
            safePlaylists.push(impPl)
          }
        })

        if (potentialConflicts.length > 0) {
          setConflicts(potentialConflicts)
          setFinalImportPlaylists(safePlaylists)
          setCurrentConflictIndex(0)
          setRenameValue(`${potentialConflicts[0].imported.name} (导入)`)
          setResolutionAction('rename')
          // UI stays open, switches to conflict view
        } else {
          executeMerge(importedPlaylists, data.favorites, data.playHistory)
        }
      }
    } catch (e) {
      console.error(e)
      addToast({ type: 'error', message: '导入过程中发生错误' })
      setShowImportConfirm(false)
      setImportData(null)
    }
  }

  const handleResolveConflict = () => {
    const currentConflict = conflicts[currentConflictIndex]
    const nextIndex = currentConflictIndex + 1
    const isLast = nextIndex >= conflicts.length

    const processedPlaylist = { ...currentConflict.imported }

    let newFinalList = [...finalImportPlaylists]
    if (resolutionAction === 'rename') {
      if (!renameValue.trim()) {
        addToast({ type: 'error', message: '请输入新的歌单名称' })
        return
      }
      processedPlaylist.name = renameValue
      // Ensure ID is unique if we are renaming (treat as new)
      // But processedPlaylist already has an ID. If we push it, we check ID later.
      // Better to regenerate ID to be safe if it collided with existing ID too, 
      // but mainly we just want a "new" playlist.
      // Let's rely on executeMerge to handle ID collision if any, or generate new ID here.
      processedPlaylist.id = `imported_${Date.now()}_${currentConflictIndex}`
      newFinalList.push(processedPlaylist)
      setFinalImportPlaylists(newFinalList)
    } else {
      // Replace
      // Mark as replacement for executeMerge
      processedPlaylist._isReplacement = true
      processedPlaylist.targetId = currentConflict.existing.id
      newFinalList.push(processedPlaylist)
      setFinalImportPlaylists(newFinalList)
    }

    if (isLast) {
      executeMerge(newFinalList, importData.data.favorites, importData.data.playHistory)
      // executeMerge handles closing the modal
    } else {
      setCurrentConflictIndex(nextIndex)
      setRenameValue(`${conflicts[nextIndex].imported.name} (导入)`)
      setResolutionAction('rename')
    }
  }

  // Clear all data
  const handleClearData = () => {
    if (confirm('确定要清除所有本地数据吗？此操作不可恢复！')) {
      clearAllData()
      addToast({ type: 'success', message: '数据已清除' })
    }
  }

  const handleToggleDataSyncEnabled = async() => {
    setIsSavingDataSync(true)
    try {
      const status = await dataSyncService.updateConfig({
        enabled: !dataSyncStatus.enabled,
      })
      setDataSyncStatus(status)
      addToast({ type: 'success', message: status.enabled ? '已启用数据同步' : '已关闭数据同步' })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : '切换数据同步失败' })
    } finally {
      setIsSavingDataSync(false)
    }
  }

  const handleSwitchDataSyncMode = async(mode: 'server' | 'client') => {
    setIsSavingDataSync(true)
    try {
      const status = await dataSyncService.updateConfig({ mode })
      setDataSyncStatus(status)
      addToast({ type: 'success', message: mode === 'server' ? '已切换到主机模式' : '已切换到连接模式' })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : '切换同步模式失败' })
    } finally {
      setIsSavingDataSync(false)
    }
  }

  const handleApplyDataSyncClientHost = async() => {
    setIsSavingDataSync(true)
    try {
      const status = await dataSyncService.updateConfig({ clientHost: dataSyncClientHost.trim() })
      setDataSyncStatus(status)
      addToast({ type: 'success', message: '同步服务地址已更新' })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : '更新同步服务地址失败' })
    } finally {
      setIsSavingDataSync(false)
    }
  }

  const handleConnectDataSyncClient = async() => {
    if (!dataSyncConnectionCodeInput.trim()) {
      addToast({ type: 'warning', message: '请输入连接码' })
      return
    }

    setIsSavingDataSync(true)
    try {
      const status = await dataSyncService.connectClient(dataSyncConnectionCodeInput.trim())
      setDataSyncStatus(status)
      addToast({ type: 'success', message: '已发起同步连接' })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : '连接同步服务失败' })
    } finally {
      setIsSavingDataSync(false)
    }
  }

  const handleRefreshDataSyncCode = async() => {
    setIsSavingDataSync(true)
    try {
      const status = await dataSyncService.refreshCode()
      setDataSyncStatus(status)
      addToast({ type: 'success', message: '连接码已刷新' })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : '刷新连接码失败' })
    } finally {
      setIsSavingDataSync(false)
    }
  }

  const handleDisconnectDataSync = async() => {
    setIsSavingDataSync(true)
    try {
      const status = await dataSyncService.disconnect()
      setDataSyncStatus(status)
      addToast({ type: 'success', message: '已断开数据同步' })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : '断开同步失败' })
    } finally {
      setIsSavingDataSync(false)
    }
  }

  const handleRemoveDataSyncDevice = async(deviceId: string, deviceName: string) => {
    if (!window.confirm(`确定移除设备「${deviceName}」吗？移除后该设备再次连接需要重新输入连接码。`)) {
      return
    }

    setIsSavingDataSync(true)
    try {
      const status = await dataSyncService.removeDevice(deviceId)
      setDataSyncStatus(status)
      addToast({ type: 'success', message: `已移除设备「${deviceName}」` })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : '移除设备失败' })
    } finally {
      setIsSavingDataSync(false)
    }
  }
  // Hitokoto love quote
  const [hitokoto, setHitokoto] = useState<string>('')

  useEffect(() => {
    const fetchHitokoto = async () => {
      try {
        // c=d 小说, c=e 原创, c=f 网络 - 这些分类更可能有爱情语录
        const res = await fetch('https://v1.hitokoto.cn/?c=d&c=e&c=f&encode=json')
        const data = await res.json()
        setHitokoto(data.hitokoto || '')
      } catch (e) {
        console.debug('Failed to fetch hitokoto:', e)
      }
    }
    fetchHitokoto()
  }, [])

  const managedLxSources = lxSourceStatus?.managedSources || []
  const activeManagedLxSource = managedLxSources.find((source) => source.id === lxSourceStatus?.activeSourceId) || null
  const lxSourceCollapsedSummary = activeManagedLxSource
    ? `当前音源：${activeManagedLxSource.scriptInfo.name || '未命名音源'}${activeManagedLxSource.scriptInfo.version ? ` · ${activeManagedLxSource.scriptInfo.version}` : ''} · 已导入 ${managedLxSources.length} 个`
    : managedLxSources.length > 0
      ? `已导入 ${managedLxSources.length} 个音源，当前使用自动检测脚本`
      : lxSourceStatus?.scriptPath
        ? `当前脚本：${lxSourceStatus.scriptPath}`
        : '点击展开查看当前 LX 音源脚本、运行状态与手动切换入口'

  return (
    <div className="flex gap-6 h-full">
      {/* Navigation Sidebar */}
      <aside className="w-48 flex-shrink-0 self-start pt-2 max-h-full overflow-y-auto">
        <div className="card p-2 space-y-1">
          {SETTINGS_NAV_GROUPS.map((group) => {
            const GroupIcon = group.icon
            return (
            <div key={group.id}>
              <button
                onClick={() => {
                  setActiveGroup(group.id)
                  toggleGroup(group.id)
                  const firstItem = group.items[0]
                  if (firstItem) {
                    setActiveSection(firstItem.id)
                    requestAnimationFrame(() => {
                      const el = document.getElementById(`section-${firstItem.id}`)
                      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    })
                  }
                }}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium transition-colors',
                  activeGroup === group.id
                    ? 'text-primary-500 font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                )}
              >
                <span className="flex items-center gap-1.5">
                  <GroupIcon className="w-3.5 h-3.5" />
                  {group.label}
                </span>
                {expandedGroups.has(group.id) ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>
              {expandedGroups.has(group.id) && (
                <div className="space-y-0.5 mt-0.5">
                  {group.items.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => scrollToSection(id)}
                      className={cn(
                        'w-full flex items-center gap-3 pl-5 pr-3 py-1.5 rounded-lg text-sm transition-colors text-left',
                        activeSection === id
                          ? 'bg-primary-500 text-white'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )})}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 space-y-6 overflow-y-auto pb-32">
      {/* Sollin Branding at Top */}
      <div className="text-center py-8">
        <h1
          className="text-6xl font-bold bg-gradient-to-r from-primary-500 via-pink-500 to-orange-400 bg-clip-text text-transparent animate-pulse drop-shadow-lg"
          style={{
            animation: 'shimmer 3s ease-in-out infinite, float 4s ease-in-out infinite',
            textShadow: '0 0 40px rgba(250, 45, 72, 0.3)',
          }}
        >
          Sollin
        </h1>
        {hitokoto && (
          <p
            className="text-sm text-[var(--text-muted)] mt-4 max-w-md mx-auto italic"
            style={{ animation: 'fadeIn 1s ease-in-out' }}
          >
            「{hitokoto}」
          </p>
        )}
        <style>{`
          @keyframes shimmer {
            0%, 100% { filter: brightness(1) hue-rotate(0deg); }
            50% { filter: brightness(1.2) hue-rotate(10deg); }
          }
          @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-5px); }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>

      <h1 className="text-3xl font-bold">设置</h1>

      {/* LX Source Management */}
      <section id="section-source" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('source')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <FileCode2 className="w-4 h-4" />
              音源管理
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-1">管理 LX JS 音源脚本，歌曲播放链接将通过该脚本解析</p>
          </div>
          <button
            onClick={() => setIsLxSourceExpanded((value) => !value)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
          >
            {isLxSourceExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {isLxSourceExpanded ? '收起' : '展开'}
          </button>
        </div>
        {!isLxSourceExpanded && (
          <div className="p-4 flex items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
            <div className="min-w-0">
              <p className="font-medium text-[var(--text-secondary)]">音源管理已收起</p>
              <p className="text-xs mt-1 truncate">
                {lxSourceCollapsedSummary}
              </p>
            </div>
            <button
              onClick={() => setIsLxSourceExpanded(true)}
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-xs flex-shrink-0"
            >
              展开查看
            </button>
          </div>
        )}
        {isLxSourceExpanded && (
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void refreshLxSourceStatus()}
              disabled={isLoadingLxSourceStatus}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm flex items-center gap-2 disabled:opacity-60"
            >
              {isLoadingLxSourceStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              刷新状态
            </button>
            <button
              onClick={() => void handlePickLxSourceScript()}
              disabled={isPickingLxSourcePath || !lxSourceStatus?.available}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm flex items-center gap-2 disabled:opacity-60"
            >
              {isPickingLxSourcePath ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
              选择脚本
            </button>
            <button
              onClick={() => void handleResetLxSourceScript()}
              disabled={isSavingLxSourcePath || !lxSourceStatus?.available}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm disabled:opacity-60"
            >
              {isSavingLxSourcePath ? '处理中...' : '恢复自动检测'}
            </button>
          </div>

          {!lxSourceStatus ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-6 text-sm text-[var(--text-muted)] flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在读取音源状态...
            </div>
          ) : !lxSourceStatus.available ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-900/20 p-4 text-sm text-amber-700 dark:text-amber-200 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <div>
                  <p className="font-medium">当前环境不支持 LX 音源管理</p>
                  <p className="mt-1 text-xs">
                    {!hasElectronApi
                      ? '主窗口未注入 electronAPI，请确认当前打开的是 Electron 应用窗口。'
                      : !hasLxSourceStatusMethod
                        ? '当前 Electron 主窗口使用的是旧版 preload，请彻底退出后重启 Electron 进程。'
                        : '请在 Electron 桌面端中使用该功能。'}
                  </p>
                </div>
                <div className="text-[11px] leading-5 bg-black/5 dark:bg-white/5 rounded-lg px-3 py-2 break-all">
                  <p><span className="font-medium">electronAPI:</span> {hasElectronApi ? '已注入' : '未注入'}</p>
                  <p><span className="font-medium">getLxSourceStatus:</span> {hasLxSourceStatusMethod ? '可用' : '不可用'}</p>
                  <p><span className="font-medium">methods:</span> {electronApiMethods || '无'}</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-2">运行时</p>
                  <span className={cn(
                    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
                    lxSourceStatus.runtimeReady
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-gray-200 text-[var(--text-secondary)] dark:bg-gray-700 dark:text-[var(--text-secondary)]'
                  )}>
                    {lxSourceStatus.runtimeReady ? '已就绪' : '未就绪'}
                  </span>
                </div>
                <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-2">脚本加载</p>
                  <span className={cn(
                    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
                    lxSourceStatus.scriptLoaded
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  )}>
                    {lxSourceStatus.scriptLoaded ? '已加载' : '未加载'}
                  </span>
                </div>
                <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-2">脚本来源</p>
                  <span className={cn(
                    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
                    lxSourceStatus.scriptUrl
                      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                      : lxSourceStatus.configuredPath
                        ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : lxSourceStatus.autoDetectedPath
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-gray-200 text-[var(--text-secondary)] dark:bg-gray-700 dark:text-[var(--text-secondary)]'
                  )}>
                    {lxSourceStatus.scriptUrl ? 'URL 导入' : lxSourceStatus.configuredPath ? '手动配置' : lxSourceStatus.autoDetectedPath ? '自动检测' : '未找到'}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
                <div>
                  <p className="font-medium">导入音源</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    先导入本地脚本或 URL 音源，再在下方已导入列表里切换当前生效音源。
                  </p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">通过 URL 导入脚本</label>
                    <div className="flex flex-col gap-2">
                      <input
                        type="url"
                        value={lxScriptUrlInput}
                        onChange={(event) => setLxScriptUrlInput(event.target.value)}
                        placeholder="输入音源 JS URL，例如 https://example.com/lx-source.js"
                        className="input flex-1 font-mono text-xs"
                      />
                      <button
                        onClick={() => void handleImportLxSourceFromUrl()}
                        disabled={isImportingLxSourceUrl || !lxScriptUrlInput.trim()}
                        className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors text-sm disabled:opacity-60 inline-flex items-center justify-center gap-2"
                      >
                        {isImportingLxSourceUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {isImportingLxSourceUrl ? '导入中...' : 'URL 导入'}
                      </button>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      会先下载脚本到本地用户目录，加入音源列表，并自动切换为当前生效音源。
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">导入本地脚本</label>
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        value={lxScriptPathInput}
                        onChange={(event) => setLxScriptPathInput(event.target.value)}
                        placeholder="输入 LX JS 音源文件路径，例如 ./sources/example-source.js"
                        className="input flex-1 font-mono text-xs"
                      />
                      <button
                        onClick={() => void handleApplyLxSourceScript()}
                        disabled={isSavingLxSourcePath || !lxScriptPathInput.trim()}
                        className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors text-sm disabled:opacity-60"
                      >
                        {isSavingLxSourcePath ? '导入中...' : '导入并切换'}
                      </button>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      支持手动输入路径或点击“选择脚本”；导入后会保留在音源列表中，可随时切换。
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">已导入音源</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {activeManagedLxSource
                        ? `当前生效：${activeManagedLxSource.scriptInfo.name || '未命名音源'}`
                        : '每个音源默认收起详情，点击展开后查看作者、时间和更新提醒。'}
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-[var(--text-secondary)] w-fit">
                    {managedLxSources.length} 个音源
                  </span>
                </div>

                {managedLxSources.length > 0 ? (
                  <div className="space-y-3">
                    {managedLxSources.map((source) => {
                      const isSwitching = activeLxSourceActionId === source.id
                      const isRemoving = removeLxSourceActionId === source.id
                      const isUpdatingAlert = updateLxSourceAlertActionId === source.id && isSavingLxSourceUpdateAlert
                      const isDetailExpanded = expandedLxSourceIds.includes(source.id)
                      const isBusy = isSwitching || isRemoving || isUpdatingAlert

                      return (
                        <div
                          key={source.id}
                          className={cn(
                            'rounded-xl border p-4 transition-colors',
                            source.isActive
                              ? 'border-primary-200 bg-primary-50/60 dark:border-primary-800/60 dark:bg-primary-900/10'
                              : 'border-gray-200 dark:border-gray-700'
                          )}
                        >
                          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-[var(--text-primary)]">{source.scriptInfo.name || '未命名音源'}</p>
                                {source.scriptInfo.version && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-gray-800 text-[var(--text-secondary)]">
                                    {source.scriptInfo.version}
                                  </span>
                                )}
                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-[var(--text-secondary)]">
                                  {LX_SOURCE_TYPE_LABELS[source.type]}
                                </span>
                                {source.isActive && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary-500 text-white">当前生效</span>
                                )}
                                <span className={cn(
                                  'text-xs px-2 py-0.5 rounded-full',
                                  source.exists
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                )}>
                                  {source.exists ? '文件可用' : '文件缺失'}
                                </span>
                              </div>
                              <p className="text-xs text-[var(--text-muted)] mt-2">
                                {isDetailExpanded
                                  ? (source.scriptInfo.description || '暂无脚本描述')
                                  : '点击展开查看脚本详情'}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => void handleSetActiveLxSource(source)}
                                disabled={source.isActive || !source.exists || isBusy}
                                className={cn(
                                  'px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-60',
                                  source.isActive
                                    ? 'bg-primary-500 text-white cursor-default'
                                    : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                                )}
                              >
                                {isSwitching ? '切换中...' : source.isActive ? '当前音源' : '切换到此音源'}
                              </button>
                              <button
                                onClick={() => void handleRemoveLxSource(source)}
                                disabled={isBusy}
                                className="px-3 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
                              >
                                <Trash2 className="w-4 h-4" />
                                {isRemoving ? '删除中...' : '删除'}
                              </button>
                              <button
                                onClick={() => handleToggleLxSourceDetails(source.id)}
                                className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors inline-flex items-center gap-1.5"
                              >
                                {isDetailExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                {isDetailExpanded ? '收起详情' : '展开详情'}
                              </button>
                            </div>
                          </div>

                          {isDetailExpanded && (
                            <>
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
                                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3">
                                  <p className="text-xs text-[var(--text-muted)] mb-1">脚本路径</p>
                                  <p className="text-xs font-mono break-all text-[var(--text-secondary)]">{source.path}</p>
                                </div>
                                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3">
                                  <p className="text-xs text-[var(--text-muted)] mb-1">导入地址</p>
                                  <p className="text-xs font-mono break-all text-[var(--text-secondary)]">{source.url || '本地脚本导入'}</p>
                                </div>
                                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3">
                                  <p className="text-xs text-[var(--text-muted)] mb-1">作者</p>
                                  <p className="text-sm break-all text-[var(--text-secondary)]">{source.scriptInfo.author || '未知'}</p>
                                </div>
                                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3">
                                  <p className="text-xs text-[var(--text-muted)] mb-1">导入时间</p>
                                  <p className="text-sm text-[var(--text-secondary)]">{formatLxSourceImportedAt(source.importedAt)}</p>
                                </div>
                              </div>

                              <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-2 flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium">更新提醒</p>
                                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                    仅当该音源处于当前生效状态并上报更新时提示。
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={source.allowShowUpdateAlert}
                                  onClick={() => void handleToggleLxSourceUpdateAlert(source.id)}
                                  disabled={isBusy}
                                  className={cn(
                                    'relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-60',
                                    source.allowShowUpdateAlert ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                                      source.allowShowUpdateAlert ? 'translate-x-6' : 'translate-x-1'
                                    )}
                                  />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-4 text-sm text-[var(--text-muted)]">
                    暂无已导入音源。你可以先在上方导入本地脚本，或通过 URL 导入多个 LX 音源。
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">当前音源更新弹窗</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {activeManagedLxSource
                      ? `「${activeManagedLxSource.scriptInfo.name || '未命名音源'}」主动上报更新时显示提醒弹窗；列表中也支持逐个开关。`
                      : '参照 LX Music 行为，在当前脚本主动上报更新时显示提醒弹窗。'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={lxSourceStatus.allowShowUpdateAlert}
                  onClick={() => void handleToggleLxSourceUpdateAlert()}
                  disabled={isSavingLxSourceUpdateAlert}
                  className={cn(
                    'relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-60',
                    lxSourceStatus.allowShowUpdateAlert ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                      lxSourceStatus.allowShowUpdateAlert ? 'translate-x-6' : 'translate-x-1'
                    )}
                  />
                </button>
              </div>

              {lxSourceStatus.lastError && (
                <div className="rounded-xl border border-red-200 bg-red-50/80 dark:border-red-900/40 dark:bg-red-900/20 p-4 text-sm text-red-600 dark:text-red-300 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">最近一次加载错误</p>
                    <p className="mt-1 break-all">{lxSourceStatus.lastError}</p>
                  </div>
                </div>
              )}

              {lxSourceStatus.scriptInfo && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{lxSourceStatus.scriptInfo.name || '未知脚本'}</p>
                      <p className="text-sm text-[var(--text-muted)] mt-1">{lxSourceStatus.scriptInfo.description || '暂无描述'}</p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-[var(--text-secondary)]">
                      {lxSourceStatus.scriptInfo.version || '未标注版本'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-[var(--text-muted)] mb-1">作者</p>
                      <p className="break-all">{lxSourceStatus.scriptInfo.author || '未知'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)] mb-1">主页</p>
                      {lxSourceStatus.scriptInfo.homepage ? (
                        <button
                          onClick={() => window.open(lxSourceStatus.scriptInfo?.homepage || '', '_blank')}
                          className="text-primary-500 hover:underline inline-flex items-center gap-1 break-all text-left"
                        >
                          {lxSourceStatus.scriptInfo.homepage}
                          <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                        </button>
                      ) : (
                        <p>未提供</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="font-medium">脚本支持的平台</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">展示当前 LX 脚本上报的解析能力</p>
                  </div>
                </div>

                {Object.keys(lxSourceStatus.supportedSources).length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {Object.entries(lxSourceStatus.supportedSources).map(([source, info]) => (
                      <div key={source} className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{LX_SOURCE_LABELS[source] || source}</p>
                          <span className="text-xs px-2 py-1 rounded-full bg-white dark:bg-gray-700 text-[var(--text-muted)]">
                            {info.type}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--text-muted)] mb-1">支持音质</p>
                          <div className="flex flex-wrap gap-1">
                            {info.qualitys.length > 0 ? info.qualitys.map((qualityName) => (
                              <span
                                key={qualityName}
                                className="px-2 py-0.5 rounded bg-primary-500/10 text-primary-600 dark:text-primary-300 text-xs"
                              >
                                {qualityName}
                              </span>
                            )) : <span className="text-xs text-[var(--text-muted)]">未声明</span>}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--text-muted)] mb-1">支持动作</p>
                          <div className="flex flex-wrap gap-1">
                            {info.actions.length > 0 ? info.actions.map((action) => (
                              <span
                                key={action}
                                className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[var(--text-secondary)] text-xs"
                              >
                                {action}
                              </span>
                            )) : <span className="text-xs text-[var(--text-muted)]">未声明</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">当前脚本尚未上报支持的平台信息。</p>
                )}
              </div>
            </>
          )}
        </div>
        )}
      </section>

      {/* Source switch section */}
      <section id="section-source-switch" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('source-switch')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            智能换源
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">当歌曲无法播放时，自动切换到其他可用音源</p>
        </div>
        <div className="p-4">
          <SourceSwitchSettingsPanel />
        </div>
      </section>

      {/* Dislike rules section */}
      <section id="section-dislike" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('dislike')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Ban className="w-4 h-4" />
            屏蔽规则
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">按 LX Music 的规则格式过滤播放队列、搜索结果和列表播放</p>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
              <p className="text-xs text-[var(--text-muted)]">已保存规则</p>
              <p className="mt-1 text-2xl font-semibold">{savedDislikeRuleCount}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
              <p className="text-xs text-[var(--text-muted)]">草稿有效规则</p>
              <p className="mt-1 text-2xl font-semibold">{dislikeRuleStats.count}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
              <p className="text-xs text-[var(--text-muted)]">搜索历史</p>
              <p className="mt-1 text-2xl font-semibold">{searchHistory.length}</p>
            </div>
          </div>

          <textarea
            value={dislikeRulesDraft}
            onChange={(event) => setDislikeRulesDraft(event.target.value)}
            spellCheck={false}
            placeholder={'歌曲名\n@歌手名\n歌曲名@歌手名'}
            className="h-48 w-full resize-y rounded-xl border border-gray-200 bg-white/70 p-3 font-mono text-sm outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900/50 dark:focus:border-primary-500"
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setDislikeRules(dislikeRulesDraft)
                addToast({ type: 'success', message: '屏蔽规则已保存' })
              }}
              className="btn-primary"
            >
              保存规则
            </button>
            <button
              onClick={() => {
                const normalizedRules = parseDislikeRules(dislikeRulesDraft).rules
                setDislikeRulesDraft(normalizedRules)
                addToast({ type: 'info', message: '已整理屏蔽规则' })
              }}
              className="btn-secondary"
            >
              整理去重
            </button>
            <button
              onClick={() => {
                clearDislikeRules()
                setDislikeRulesDraft('')
                addToast({ type: 'success', message: '屏蔽规则已清空' })
              }}
              className="rounded-lg px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              清空规则
            </button>
            <button
              onClick={() => {
                clearSearchHistory()
                addToast({ type: 'success', message: '搜索历史已清空' })
              }}
              disabled={searchHistory.length === 0}
              className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
            >
              清空搜索历史
            </button>
          </div>
        </div>
      </section>

      {/* Data management section */}
      <section id="section-data" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('data')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Database className="w-4 h-4" />
            数据管理
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">支持离线导出导入、WebDAV 备份和局域网数据同步</p>
        </div>

        <div className="p-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <p className="text-2xl font-bold text-primary-500">{playlists.length + onlinePlaylists.length + localPlaylists.length}</p>
              <p className="text-xs text-[var(--text-muted)]">歌单</p>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <p className="text-2xl font-bold text-primary-500">{favorites.length + localFavorites.length}</p>
              <p className="text-xs text-[var(--text-muted)]">收藏</p>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <p className="text-2xl font-bold text-primary-500">{playHistory.length}</p>
              <p className="text-xs text-[var(--text-muted)]">播放记录</p>
            </div>
          </div>

          {/* Backup methods */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-500 flex items-center justify-center">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">离线数据导出导入</p>
                  <p className="text-xs text-[var(--text-muted)]">本地 JSON 文件，可自定义备份项目</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    setOfflineExportSelection(createBackupSelection())
                    setShowExportSelectionModal(true)
                  }}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  导出
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  导入
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">WebDAV 备份</p>
                  <p className="text-xs text-[var(--text-muted)]">跨端同步与恢复</p>
                </div>
              </div>
              <button
                onClick={() => setShowBackupModal(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <Cloud className="w-4 h-4" />
                打开 WebDAV
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>

          {/* Clear data */}
          <button
            onClick={handleClearData}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            清除所有数据
          </button>
        </div>
      </section>

      <section id="section-data-sync" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('data-sync')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            数据同步
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">参考 lx-music-desktop，可启动 Web 服务并与其它设备实时同步资料库与设置</p>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-gray-200 dark:border-gray-700 p-4 bg-gray-50/70 dark:bg-gray-800/40">
            <div>
              <p className="font-medium">启用数据同步</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {dataSyncStatus.enabled
                  ? `当前已启用，模式：${dataSyncStatus.mode === 'server' ? '主机' : '连接'}`
                  : '关闭后不会启动同步服务，也不会主动连接其它设备'}
              </p>
            </div>
            <button
              onClick={() => void handleToggleDataSyncEnabled()}
              disabled={isSavingDataSync}
              className={cn(
                'px-4 py-2 rounded-xl text-sm transition-colors disabled:opacity-60',
                dataSyncStatus.enabled
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-[var(--text-secondary)]'
              )}
            >
              {dataSyncStatus.enabled ? '已开启' : '已关闭'}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <button
              onClick={() => void handleSwitchDataSyncMode('server')}
              disabled={isSavingDataSync}
              className={cn(
                'rounded-2xl border p-4 text-left transition-colors disabled:opacity-60',
                dataSyncStatus.mode === 'server'
                  ? 'border-primary-500 bg-primary-500/5'
                  : 'border-gray-200 dark:border-gray-700 hover:border-primary-300'
              )}
            >
              <p className="font-medium">主机模式</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">当前设备启动同步服务，其他端输入地址和连接码后接入。</p>
            </button>

            <button
              onClick={() => void handleSwitchDataSyncMode('client')}
              disabled={isSavingDataSync}
              className={cn(
                'rounded-2xl border p-4 text-left transition-colors disabled:opacity-60',
                dataSyncStatus.mode === 'client'
                  ? 'border-primary-500 bg-primary-500/5'
                  : 'border-gray-200 dark:border-gray-700 hover:border-primary-300'
              )}
            >
              <p className="font-medium">连接模式</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">连接另一台设备的同步服务，接入后同步远端快照和实时更新。</p>
            </button>
          </div>

          {dataSyncStatus.mode === 'server' ? (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
                  <p className="text-xs text-[var(--text-muted)]">服务状态</p>
                  <p className="mt-2 font-medium">{dataSyncStatus.serverRunning ? '运行中' : '未运行'}</p>
                </div>
                <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
                  <p className="text-xs text-[var(--text-muted)]">连接码</p>
                  <p className="mt-2 font-mono text-lg font-semibold tracking-widest">{dataSyncStatus.connectionCode || '------'}</p>
                </div>
                <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
                  <p className="text-xs text-[var(--text-muted)]">已认证设备</p>
                  <p className="mt-2 font-medium">{dataSyncStatus.trustedDevices.length} 台</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">同步服务地址</p>
                <div className="space-y-2">
                  {dataSyncStatus.serverAddresses.length > 0 ? dataSyncStatus.serverAddresses.map((address) => (
                    <div key={address} className="rounded-xl bg-gray-50 dark:bg-gray-800/50 px-3 py-2 font-mono text-xs break-all">
                      {address}
                    </div>
                  )) : (
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-sm text-[var(--text-muted)]">
                      启用同步后会显示当前设备可访问地址
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => void handleRefreshDataSyncCode()}
                  disabled={isSavingDataSync || !dataSyncStatus.enabled}
                  className="px-4 py-2 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-60"
                >
                  刷新连接码
                </button>
                <button
                  onClick={() => void handleDisconnectDataSync()}
                  disabled={isSavingDataSync || !dataSyncStatus.serverRunning}
                  className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-60"
                >
                  停止服务
                </button>
              </div>

              {dataSyncStatus.trustedDevices.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">已认证设备</p>
                  <div className="space-y-2">
                    {dataSyncStatus.trustedDevices.map((device) => (
                      <div key={device.deviceId} className="rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{device.deviceName}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            {device.platform} · v{device.version}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                            {new Date(device.lastSeenAt).toLocaleString('zh-CN', { hour12: false })}
                          </p>
                          <button
                            onClick={() => void handleRemoveDataSyncDevice(device.deviceId, device.deviceName)}
                            disabled={isSavingDataSync}
                            className="px-3 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-60"
                          >
                            移除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">同步服务地址</label>
                <div className="flex flex-col md:flex-row gap-3">
                  <input
                    type="text"
                    value={dataSyncClientHost}
                    onChange={(event) => setDataSyncClientHost(event.target.value)}
                    placeholder="http://192.168.1.10:9527"
                    className="input flex-1 font-mono text-sm"
                  />
                  <button
                    onClick={() => void handleApplyDataSyncClientHost()}
                    disabled={isSavingDataSync || !dataSyncClientHost.trim()}
                    className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-60"
                  >
                    保存地址
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">连接码</label>
                <div className="flex flex-col md:flex-row gap-3">
                  <input
                    type="text"
                    value={dataSyncConnectionCodeInput}
                    onChange={(event) => setDataSyncConnectionCodeInput(event.target.value)}
                    placeholder="输入主机设备显示的连接码"
                    className="input flex-1 font-mono text-sm tracking-widest"
                  />
                  <button
                    onClick={() => void handleConnectDataSyncClient()}
                    disabled={isSavingDataSync || !dataSyncConnectionCodeInput.trim()}
                    className="px-4 py-2 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-60"
                  >
                    连接
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 px-3 py-3">
                <p className="text-sm font-medium">连接状态</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {dataSyncStatus.clientConnected ? '已连接，正在接收实时同步' : '未连接'}
                  {dataSyncStatus.lastError ? ` · ${dataSyncStatus.lastError}` : ''}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => void handleDisconnectDataSync()}
                  disabled={isSavingDataSync && !dataSyncStatus.clientConnected}
                  className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-60"
                >
                  断开连接
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-900/20 p-4 text-sm text-amber-700 dark:text-amber-200">
            数据通过局域网 Web 服务明文传输，请仅在受信任网络中使用。当前版本优先同步资料库、屏蔽规则、下载规则和部分界面设置。
          </div>
        </div>
      </section>

      {/* Cache section */}
      <section id="section-cache" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('cache')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <HardDrive className="w-4 h-4" />
            缓存管理
          </h2>
        </div>
        <div className="p-4 space-y-4">
          {/* Audio Cache */}
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
            <div className="flex items-center gap-3">
              <Music className="w-5 h-5 text-primary-500" />
              <div>
                <p className="font-medium">音频缓存</p>
                <p className="text-sm text-[var(--text-muted)]">已缓存 {audioCacheStats.count} 首歌曲</p>
              </div>
            </div>
            <span className="text-lg font-semibold text-primary-500">
              {audioCache.formatSize(audioCacheStats.totalSize)}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
            <div>
              <p className="font-medium">启用音频缓存</p>
              <p className="text-sm text-[var(--text-muted)]">关闭后不再缓存已播放歌曲，并清空现有音频缓存</p>
            </div>
            <button
              onClick={() => void handleToggleAudioCache()}
              className={cn(
                'px-3 py-2 rounded-xl text-sm transition-colors',
                audioCacheEnabled ? 'bg-primary-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-[var(--text-secondary)]'
              )}
            >
              {audioCacheEnabled ? '已开启' : '已关闭'}
            </button>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={32}
                max={4096}
                step={32}
                value={audioCacheLimitMB}
                onChange={(e) => setAudioCacheLimitMB(Number(e.target.value || 0))}
                className="w-24 px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
              />
              <span className="text-sm text-[var(--text-muted)]">MB</span>
              <button
                onClick={() => void handleApplyAudioCacheLimit()}
                disabled={!audioCacheEnabled}
                className="px-3 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-sm disabled:opacity-50"
              >
                应用
              </button>
            </div>
          </div>
          <button
            onClick={handleClearAudioCache}
            disabled={isClearingAudioCache || audioCacheStats.count === 0}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isClearingAudioCache ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            清除音频缓存
          </button>
          <p className="text-xs text-[var(--text-muted)] text-center">
            当前上限 {audioCacheLimitMB} MB；超过上限时会自动删除最旧的音频缓存
          </p>

          <div className="border-t border-gray-100 dark:border-gray-800 my-4" />

          {/* Data Cache */}
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
            <div>
              <p className="font-medium">数据缓存</p>
              <p className="text-sm text-[var(--text-muted)]">歌曲信息、歌词、排行榜等数据</p>
            </div>
            <span className="text-lg font-semibold text-primary-500">{cacheSize}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
            <div>
              <p className="font-medium">启用数据缓存</p>
              <p className="text-sm text-[var(--text-muted)]">关闭后将不再缓存歌词、排行榜和搜索数据，并清空现有数据缓存</p>
            </div>
            <button
              onClick={handleToggleDataCache}
              className={cn(
                'px-3 py-2 rounded-xl text-sm transition-colors',
                dataCacheEnabled ? 'bg-primary-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-[var(--text-secondary)]'
              )}
            >
              {dataCacheEnabled ? '已开启' : '已关闭'}
            </button>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={256}
                step={1}
                value={dataCacheLimitMB}
                onChange={(e) => setDataCacheLimitMB(Number(e.target.value || 0))}
                className="w-24 px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
              />
              <span className="text-sm text-[var(--text-muted)]">MB</span>
              <button
                onClick={handleApplyDataCacheLimit}
                disabled={!dataCacheEnabled}
                className="px-3 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-sm disabled:opacity-50"
              >
                应用
              </button>
            </div>
          </div>
          <button
            onClick={handleClearCache}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            清除数据缓存
          </button>
          <p className="text-xs text-[var(--text-muted)] text-center">
            当前上限 {dataCacheLimitMB} MB；超过上限时会自动删除最旧的数据缓存
          </p>
        </div>
      </section>

      {/* Download section */}
      <section id="section-download" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('download')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Download className="w-4 h-4" />
            下载设置
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">设置新下载歌曲的文件命名和外挂文件保存方式</p>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3">
            <div>
              <p className="font-medium">自定义文件命名</p>
              <p className="text-sm text-[var(--text-muted)]">关闭时使用默认格式：歌手 - 歌名</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={downloadFileNameRuleEnabled}
              onClick={() => setDownloadFileNameRuleEnabled(!downloadFileNameRuleEnabled)}
              className={cn(
                'relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors',
                downloadFileNameRuleEnabled ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                  downloadFileNameRuleEnabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          <div className={cn('space-y-4 rounded-xl border border-gray-200 dark:border-gray-700 p-4 transition-opacity', !downloadFileNameRuleEnabled && 'opacity-60')}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">命名规则</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">字段会按下方顺序拼接</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetDownloadFileNameRule()
                  addToast({ type: 'success', message: '下载命名规则已恢复默认' })
                }}
                className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                恢复默认
              </button>
            </div>

            <div className="space-y-2">
              {downloadFileNameParts.map((part, index) => (
                <div key={`${part}-${index}`} className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
                  <span className="text-xs text-[var(--text-muted)] w-10">第 {index + 1} 段</span>
                  <select
                    value={part}
                    disabled={!downloadFileNameRuleEnabled}
                    onChange={(event) => updateDownloadFileNamePart(index, event.target.value as DownloadFileNamePart)}
                    className="input h-10"
                  >
                    {DOWNLOAD_FILE_NAME_PARTS.map((option) => (
                      <option
                        key={option}
                        value={option}
                        disabled={option !== part && downloadFileNameParts.includes(option)}
                      >
                        {DOWNLOAD_FILE_NAME_PART_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!downloadFileNameRuleEnabled || index === 0}
                      onClick={() => moveDownloadFileNamePart(index, -1)}
                      className="w-9 h-9 inline-flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                      title="上移"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!downloadFileNameRuleEnabled || index === downloadFileNameParts.length - 1}
                      onClick={() => moveDownloadFileNamePart(index, 1)}
                      className="w-9 h-9 inline-flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                      title="下移"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!downloadFileNameRuleEnabled || downloadFileNameParts.length <= 1}
                      onClick={() => removeDownloadFileNamePart(index)}
                      className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 transition-colors"
                      title="移除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {availableDownloadFileNameParts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {availableDownloadFileNameParts.map((part) => (
                  <button
                    key={part}
                    type="button"
                    disabled={!downloadFileNameRuleEnabled}
                    onClick={() => addDownloadFileNamePart(part)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    {DOWNLOAD_FILE_NAME_PART_LABELS[part]}
                  </button>
                ))}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2">
                <label className="text-sm font-medium">分隔符</label>
                <input
                  type="text"
                  value={downloadFileNameSeparator}
                  disabled={!downloadFileNameRuleEnabled}
                  onChange={(event) => setDownloadFileNameSeparator(event.target.value)}
                  maxLength={12}
                  className="input"
                  placeholder="-"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {DOWNLOAD_FILE_NAME_SEPARATOR_PRESETS.map((separator) => (
                  <button
                    key={separator}
                    type="button"
                    disabled={!downloadFileNameRuleEnabled}
                    onClick={() => setDownloadFileNameSeparator(separator)}
                    className={cn(
                      'px-3 py-2 rounded-lg text-sm border transition-colors disabled:opacity-50',
                      downloadFileNameSeparator === separator
                        ? 'border-primary-500 bg-primary-500 text-white'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                    )}
                  >
                    {separator === ' - ' ? '空格-空格' : separator}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-sm">
              <span className="text-[var(--text-muted)]">预览：</span>
              <span className="font-mono break-all">{downloadFileNamePreview}.mp3</span>
              <span className="text-[var(--text-muted)] mx-2">/</span>
              <span className="font-mono break-all">{downloadFileNamePreview}.lrc</span>
              <span className="text-[var(--text-muted)] mx-2">/</span>
              <span className="font-mono break-all">{downloadFileNamePreview}.jpg</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3">
            <div>
              <p className="font-medium">同时保存外挂歌词和封面</p>
              <p className="text-sm text-[var(--text-muted)]">下载完成后在同目录生成同名 .lrc 和封面图片</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={saveExternalMetadataFiles}
              onClick={() => setSaveExternalMetadataFiles(!saveExternalMetadataFiles)}
              className={cn(
                'relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors',
                saveExternalMetadataFiles ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                  saveExternalMetadataFiles ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Local Music section */}
      <section id="section-local-music" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('local-music')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <FolderOpen className="w-4 h-4" />
            本地音乐
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">设置本地歌曲的标签读取优先级</p>
        </div>
        <div className="p-4 space-y-4">
          <div className="space-y-3">
            <p className="font-medium">标签读取优先级</p>
            <p className="text-sm text-[var(--text-muted)]">当歌曲同时存在内嵌标签和同名外挂文件（.lrc 歌词、封面图）时，优先使用哪一方</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'embedded-first' as LocalMusicTagPriority, label: '内嵌优先', desc: '优先读取音频文件内嵌的歌词和封面' },
                { value: 'external-first' as LocalMusicTagPriority, label: '外挂优先', desc: '优先使用同目录下的 .lrc 和封面图片文件' },
              ]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setLocalMusicTagPriority(option.value)}
                  className={cn(
                    'rounded-xl border-2 p-3 text-left transition-colors',
                    localMusicTagPriority === option.value
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  )}
                >
                  <p className="font-medium text-sm">{option.label}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{option.desc}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-gray-50 dark:bg-gray-900/40 p-4 text-xs text-[var(--text-muted)] space-y-1">
            <p>外挂歌词文件：与歌曲同名的 .lrc 文件，如 123.flac 对应 123.lrc</p>
            <p>外挂封面文件：与歌曲同名的 .jpg/.png/.webp 等图片文件</p>
            <p>修改后需重新扫描本地音乐文件夹才能生效</p>
          </div>
        </div>
      </section>

      {/* Usage Stats section */}
      <section id="section-stats" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('stats')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Database className="w-4 h-4" />
            使用统计
          </h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-center">
              <p className="text-2xl font-bold text-primary-500">{stats.totalLaunches}</p>
              <p className="text-xs text-[var(--text-muted)]">启动次数</p>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-center">
              <p className="text-2xl font-bold text-primary-500">{stats.songsPlayed}</p>
              <p className="text-xs text-[var(--text-muted)]">播放歌曲</p>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-center">
              <p className="text-lg font-bold text-primary-500">{stats.totalUsageTime}</p>
              <p className="text-xs text-[var(--text-muted)]">使用时长</p>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-center">
              <p className="text-lg font-bold text-primary-500">{stats.totalPlayTime}</p>
              <p className="text-xs text-[var(--text-muted)]">播放时长</p>
            </div>
          </div>
        </div>
      </section>

      {/* Theme section */}
      <section id="section-appearance" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('appearance')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold">外观</h2>
        </div>
        <div className="p-4 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            {THEMES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                className={cn(
                  'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                  theme === id
                    ? 'border-primary-500 bg-primary-500/5'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                )}
              >
                <Icon className={cn('w-6 h-6', theme === id && 'text-primary-500')} />
                <span className={cn('text-sm', theme === id && 'text-primary-500 font-medium')}>
                  {label}
                </span>
              </button>
            ))}
          </div>

          {/* Player UI mode */}
          <div>
            <label className="text-sm font-medium mb-2 block">播放界面</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {PLAYER_MODE_OPTIONS.map(({ id, label, description, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setLyricsPlayerMode(id)}
                  className={cn(
                    'flex min-h-[6.5rem] flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all',
                    lyricsPlayerMode === id
                      ? 'border-primary-500 bg-primary-500/5'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  )}
                >
                  <Icon className={cn('w-5 h-5', lyricsPlayerMode === id && 'text-primary-500')} />
                  <span className={cn('text-sm font-medium', lyricsPlayerMode === id && 'text-primary-500')}>
                    {label}
                  </span>
                  <span className="text-xs leading-relaxed text-[var(--text-muted)]">{description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Font settings */}
          <FontSettings />
        </div>
      </section>

      {/* Background customization section */}
      {hasElectronApi && (
        <section id="section-background" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('background')}>
          <div className="p-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold flex items-center gap-2">
              <Image className="w-4 h-4" />
              背景自定义
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-1">自定义播放页和歌词页的背景效果</p>
          </div>
          <div className="p-4 space-y-5">
            {/* Mode selector */}
            <div className="grid grid-cols-4 gap-3">
              {([
                { id: 'album', label: '专辑封面' },
                { id: 'solid', label: '纯色' },
                { id: 'gradient', label: '渐变' },
                { id: 'image', label: '自定义图片' },
              ] as const).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setBackgroundSettings({ mode: id })}
                  className={cn(
                    'flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all text-sm',
                    backgroundSettings.mode === id
                      ? 'border-primary-500 bg-primary-500/5'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  )}
                >
                  <span className={cn(backgroundSettings.mode === id && 'text-primary-500 font-medium')}>
                    {label}
                  </span>
                </button>
              ))}
            </div>

            {/* Solid color controls */}
            {backgroundSettings.mode === 'solid' && (
              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
                <label className="flex items-center justify-between">
                  <span className="text-sm font-medium">背景颜色</span>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-5 w-5 rounded-full border shadow-sm border-gray-200 dark:border-gray-600"
                      style={{ backgroundColor: backgroundSettings.solidColor }}
                    />
                    <input
                      type="color"
                      value={backgroundSettings.solidColor}
                      onChange={(e) => setBackgroundSettings({ solidColor: e.target.value })}
                      className="h-7 w-9 cursor-pointer rounded-md border-0 bg-transparent p-0"
                    />
                  </span>
                </label>
              </div>
            )}

            {/* Gradient controls */}
            {backgroundSettings.mode === 'gradient' && (
              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">起始颜色</span>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-5 w-5 rounded-full border shadow-sm border-gray-200 dark:border-gray-600"
                      style={{ backgroundColor: backgroundSettings.gradientColor1 }}
                    />
                    <input
                      type="color"
                      value={backgroundSettings.gradientColor1}
                      onChange={(e) => setBackgroundSettings({ gradientColor1: e.target.value })}
                      className="h-7 w-9 cursor-pointer rounded-md border-0 bg-transparent p-0"
                    />
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">结束颜色</span>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-5 w-5 rounded-full border shadow-sm border-gray-200 dark:border-gray-600"
                      style={{ backgroundColor: backgroundSettings.gradientColor2 }}
                    />
                    <input
                      type="color"
                      value={backgroundSettings.gradientColor2}
                      onChange={(e) => setBackgroundSettings({ gradientColor2: e.target.value })}
                      className="h-7 w-9 cursor-pointer rounded-md border-0 bg-transparent p-0"
                    />
                  </span>
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="font-medium">角度</span>
                    <span className="text-[var(--text-muted)]">{backgroundSettings.gradientAngle}°</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={backgroundSettings.gradientAngle}
                    onChange={(e) => setBackgroundSettings({ gradientAngle: Number(e.target.value) })}
                    className="w-full accent-primary-500"
                  />
                </div>
                {/* Gradient preview */}
                <div
                  className="h-10 rounded-lg border border-gray-200 dark:border-gray-700"
                  style={{
                    background: `linear-gradient(${backgroundSettings.gradientAngle}deg, ${backgroundSettings.gradientColor1}, ${backgroundSettings.gradientColor2})`,
                  }}
                />
              </div>
            )}

            {/* Custom image controls */}
            {backgroundSettings.mode === 'image' && (
              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                {backgroundSettings.customImagePath ? (
                  <>
                    <div className="flex items-center gap-3">
                      <img
                        src={backgroundSettings.customImagePath}
                        alt=""
                        className="h-16 w-16 rounded-lg object-cover border border-gray-200 dark:border-gray-700"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">已选择自定义图片</p>
                        <p className="text-xs text-[var(--text-muted)] truncate mt-1">
                          {backgroundSettings.customImagePath.startsWith('data:')
                            ? '已裁剪的图片'
                            : backgroundSettings.customImagePath.replace('file://', '')}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          const path = await window.electronAPI!.pickBackgroundImage()
                          if (path) {
                            setCropImageSrc(path)
                            setCropModalOpen(true)
                          }
                        }}
                        className="flex-1 rounded-xl bg-gray-100 px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-[var(--text-secondary)] dark:hover:bg-gray-700"
                      >
                        更换图片
                      </button>
                      <button
                        onClick={() => setBackgroundSettings({ customImagePath: '' })}
                        className="flex-1 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                      >
                        清除
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={async () => {
                      const path = await window.electronAPI!.pickBackgroundImage()
                      if (path) {
                        setCropImageSrc(path)
                        setCropModalOpen(true)
                      }
                    }}
                    className="w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-6 text-center text-sm text-[var(--text-muted)] hover:border-primary-500 hover:text-primary-500 transition-colors"
                  >
                    点击选择背景图片
                  </button>
                )}
              </div>
            )}

            {/* Overlay controls */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <p className="text-sm font-medium">颜色遮罩</p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-muted)]">遮罩颜色</span>
                <span className="flex items-center gap-2">
                  <span
                    className="h-5 w-5 rounded-full border shadow-sm border-gray-200 dark:border-gray-600"
                    style={{ backgroundColor: backgroundSettings.overlayColor }}
                  />
                  <input
                    type="color"
                    value={backgroundSettings.overlayColor}
                    onChange={(e) => setBackgroundSettings({ overlayColor: e.target.value })}
                    className="h-7 w-9 cursor-pointer rounded-md border-0 bg-transparent p-0"
                  />
                </span>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-[var(--text-muted)]">遮罩不透明度</span>
                  <span className="text-[var(--text-muted)]">{Math.round(backgroundSettings.overlayOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(backgroundSettings.overlayOpacity * 100)}
                  onChange={(e) => setBackgroundSettings({ overlayOpacity: Number(e.target.value) / 100 })}
                  className="w-full accent-primary-500"
                />
              </div>
            </div>

            {/* Blur slider */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-medium">模糊强度</span>
                <span className="text-[var(--text-muted)]">{backgroundSettings.blurIntensity}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={backgroundSettings.blurIntensity}
                onChange={(e) => setBackgroundSettings({ blurIntensity: Number(e.target.value) })}
                className="w-full accent-primary-500"
              />
            </div>

            {/* Reset button */}
            <button
              onClick={resetBackgroundSettings}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              恢复默认背景设置
            </button>
          </div>
        </section>
      )}

      {/* Close behavior section */}
      <section id="section-close" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('close')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Power className="w-4 h-4" />
            关闭行为
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">设置点击关闭时的默认动作（Windows / macOS）</p>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setCloseBehavior('background')}
              className={cn(
                'p-4 rounded-xl border-2 text-left transition-all flex flex-col gap-1',
                closeBehavior === 'background'
                  ? 'border-primary-500 bg-primary-500/5'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              )}
            >
              <span className="font-medium">后台播放</span>
              <span className="text-xs text-[var(--text-muted)]">隐藏到托盘，继续播放</span>
            </button>

            <button
              onClick={() => setCloseBehavior('quit')}
              className={cn(
                'p-4 rounded-xl border-2 text-left transition-all flex flex-col gap-1',
                closeBehavior === 'quit'
                  ? 'border-primary-500 bg-primary-500/5'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              )}
            >
              <span className="font-medium">退出应用</span>
              <span className="text-xs text-[var(--text-muted)]">直接关闭，不再后台驻留</span>
            </button>
          </div>

          <button
            onClick={() => setCloseBehavior('ask')}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            恢复为每次询问
          </button>
        </div>
      </section>

      {/* <section id="section-shortcut" className="card overflow-hidden scroll-mt-6">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Keyboard className="w-4 h-4" />
                快捷键
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">设置全局快捷键，在 Windows 和 macOS 后台也能控制播放</p>
            </div>
            <button
              onClick={() => {
                setRecordingShortcutAction(null)
                void saveGlobalShortcutConfig(DEFAULT_GLOBAL_SHORTCUTS, '已恢复默认快捷键')
              }}
              disabled={!hasGlobalShortcutApi || isLoadingGlobalShortcuts}
              className={cn(
                'px-3 py-2 rounded-xl text-sm transition-colors',
                !hasGlobalShortcutApi || isLoadingGlobalShortcuts
                  ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                  : 'bg-primary-500/10 text-primary-600 hover:bg-primary-500/15 dark:text-primary-300'
              )}
            >
              恢复默认
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {!hasGlobalShortcutApi ? (
            <div className="rounded-2xl border border-yellow-200 bg-yellow-50/80 dark:border-yellow-900/40 dark:bg-yellow-900/10 p-4">
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">当前环境不支持全局快捷键设置</p>
              <p className="text-xs text-yellow-600/90 dark:text-yellow-200/80 mt-1">
                只有桌面端 Electron 环境可以注册系统级快捷键。
              </p>
            </div>
          ) : (
            GLOBAL_SHORTCUT_ITEMS.map(({ action, label, description }) => {
              const currentValue = globalShortcutConfig[action]
              const currentStatus = globalShortcutStatus[action]
              const isRecording = recordingShortcutAction === action

              return (
                <div
                  key={action}
                  className={cn(
                    'rounded-2xl border p-4 transition-colors',
                    isRecording
                      ? 'border-primary-500 bg-primary-500/5'
                      : 'border-gray-200 dark:border-gray-700'
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{label}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>
                    </div>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                      isRecording
                        ? 'bg-primary-500 text-white'
                        : currentStatus.registered
                          ? 'bg-green-500/10 text-green-600 dark:text-green-300'
                          : currentValue
                            ? 'bg-red-500/10 text-red-600 dark:text-red-300'
                            : 'bg-gray-100 text-[var(--text-muted)] dark:bg-gray-800 dark:text-[var(--text-secondary)]'
                    )}>
                      {isRecording ? '录制中' : currentStatus.registered ? '已启用' : currentValue ? '未注册' : '已禁用'}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <div className={cn(
                      'min-h-[44px] min-w-[240px] flex-1 rounded-xl border px-3 py-2 text-sm',
                      isRecording
                        ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
                        : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
                    )}>
                      <span className="font-mono">
                        {isRecording
                          ? '按下新的快捷键，Esc 取消'
                          : formatGlobalShortcut(currentValue, shortcutPlatform)}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        setRecordingShortcutAction((current) => current === action ? null : action)
                      }}
                      disabled={isLoadingGlobalShortcuts}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm transition-colors',
                        isLoadingGlobalShortcuts
                          ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                          : isRecording
                            ? 'bg-primary-500 text-white hover:bg-primary-600'
                            : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                    >
                      {isRecording ? '取消' : '录制'}
                    </button>

                    <button
                      onClick={() => {
                        setRecordingShortcutAction(null)
                        void saveGlobalShortcutConfig(
                          { ...globalShortcutConfig, [action]: DEFAULT_GLOBAL_SHORTCUTS[action] },
                          `${label}已恢复默认`,
                        )
                      }}
                      disabled={isLoadingGlobalShortcuts}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm transition-colors',
                        isLoadingGlobalShortcuts
                          ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                    >
                      默认
                    </button>

                    <button
                      onClick={() => {
                        setRecordingShortcutAction(null)
                        void saveGlobalShortcutConfig(
                          { ...globalShortcutConfig, [action]: null },
                          `${label}已禁用`,
                        )
                      }}
                      disabled={isLoadingGlobalShortcuts || currentValue == null}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm transition-colors',
                        isLoadingGlobalShortcuts || currentValue == null
                          ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                    >
                      禁用
                    </button>
                  </div>

                  <div className="mt-3 space-y-1">
                    {currentStatus.error && currentValue ? (
                      <p className="text-xs text-red-500">{currentStatus.error}</p>
                    ) : null}
                    <p className="text-xs text-[var(--text-muted)]">
                      默认：{formatGlobalShortcut(DEFAULT_GLOBAL_SHORTCUTS[action], shortcutPlatform)}
                    </p>
                  </div>
                </div>
              )
            })
          )}

          <div className="rounded-2xl bg-gray-50 dark:bg-gray-900/40 p-4 text-xs text-[var(--text-muted)] space-y-1">
            <p>录制时建议使用带修饰键的组合，例如 Ctrl / Cmd + Alt + 方向键，也可以恢复为系统媒体键。</p>
            <p>macOS 使用媒体键时，首次可能需要在“系统设置 - 隐私与安全性 - 辅助功能”中授权应用。</p>
          </div>
        </div>
      </section> */}

      {/* <section id="section-shortcut" className="card overflow-hidden scroll-mt-6">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Keyboard className="w-4 h-4" />
                快捷键
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">设置全局快捷键，在 Windows 和 macOS 后台也能控制播放</p>
            </div>
            <button
              onClick={() => {
                setRecordingShortcutAction(null)
                void saveGlobalShortcutConfig(DEFAULT_GLOBAL_SHORTCUTS, 'Restored default shortcuts')
              }}
              disabled={!hasGlobalShortcutApi || isLoadingGlobalShortcuts}
              className={cn(
                'px-3 py-2 rounded-xl text-sm transition-colors',
                !hasGlobalShortcutApi || isLoadingGlobalShortcuts
                  ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                  : 'bg-primary-500/10 text-primary-600 hover:bg-primary-500/15 dark:text-primary-300'
              )}
            >
              恢复默认
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {!hasGlobalShortcutApi ? (
            <div className="rounded-2xl border border-yellow-200 bg-yellow-50/80 dark:border-yellow-900/40 dark:bg-yellow-900/10 p-4">
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">当前环境不支持全局快捷键设置</p>
              <p className="text-xs text-yellow-600/90 dark:text-yellow-200/80 mt-1">
                只有桌面端 Electron 环境可以注册系统级快捷键。
              </p>
            </div>
          ) : (
            GLOBAL_SHORTCUT_ITEMS.map(({ action, label, description }) => {
              const currentValue = globalShortcutConfig[action]
              const currentStatus = globalShortcutStatus[action]
              const isRecording = recordingShortcutAction === action

              return (
                <div
                  key={action}
                  className={cn(
                    'rounded-2xl border p-4 transition-colors',
                    isRecording
                      ? 'border-primary-500 bg-primary-500/5'
                      : 'border-gray-200 dark:border-gray-700'
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{label}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>
                    </div>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                      isRecording
                        ? 'bg-primary-500 text-white'
                        : currentStatus.registered
                          ? 'bg-green-500/10 text-green-600 dark:text-green-300'
                          : currentValue
                            ? 'bg-red-500/10 text-red-600 dark:text-red-300'
                            : 'bg-gray-100 text-[var(--text-muted)] dark:bg-gray-800 dark:text-[var(--text-secondary)]'
                    )}>
                      {isRecording ? '录制中' : currentStatus.registered ? '已启用' : currentValue ? '未注册' : '已禁用'}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <div className={cn(
                      'min-h-[44px] min-w-[240px] flex-1 rounded-xl border px-3 py-2 text-sm',
                      isRecording
                        ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
                        : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
                    )}>
                      <span className="font-mono">
                        {isRecording
                          ? '按下新的快捷键，Esc 取消'
                          : formatGlobalShortcut(currentValue, shortcutPlatform)}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        setRecordingShortcutAction((current) => current === action ? null : action)
                      }}
                      disabled={isLoadingGlobalShortcuts}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm transition-colors',
                        isLoadingGlobalShortcuts
                          ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                          : isRecording
                            ? 'bg-primary-500 text-white hover:bg-primary-600'
                            : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                    >
                      {isRecording ? '取消' : '录制'}
                    </button>

                    <button
                      onClick={() => {
                        setRecordingShortcutAction(null)
                        void saveGlobalShortcutConfig(
                          { ...globalShortcutConfig, [action]: DEFAULT_GLOBAL_SHORTCUTS[action] },
                          `${label} shortcut reset`,
                        )
                      }}
                      disabled={isLoadingGlobalShortcuts}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm transition-colors',
                        isLoadingGlobalShortcuts
                          ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                    >
                      默认
                    </button>

                    <button
                      onClick={() => {
                        setRecordingShortcutAction(null)
                        void saveGlobalShortcutConfig(
                          { ...globalShortcutConfig, [action]: null },
                          `${label} shortcut disabled`,
                        )
                      }}
                      disabled={isLoadingGlobalShortcuts || currentValue == null}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm transition-colors',
                        isLoadingGlobalShortcuts || currentValue == null
                          ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                    >
                      禁用
                    </button>
                  </div>

                  <div className="mt-3 space-y-1">
                    {currentStatus.error && currentValue ? (
                      <p className="text-xs text-red-500">{currentStatus.error}</p>
                    ) : null}
                    <p className="text-xs text-[var(--text-muted)]">
                      默认：{formatGlobalShortcut(DEFAULT_GLOBAL_SHORTCUTS[action], shortcutPlatform)}
                    </p>
                  </div>
                </div>
              )
            })
          )}

          <div className="rounded-2xl bg-gray-50 dark:bg-gray-900/40 p-4 text-xs text-[var(--text-muted)] space-y-1">
            <p>录制时建议使用带修饰键的组合，例如 Ctrl / Cmd + Alt + 方向键，也可以恢复为系统媒体键。</p>
            <p>macOS 使用媒体键时，首次可能需要在“系统设置 - 隐私与安全性 - 辅助功能”中授权应用。</p>
          </div>
        </div>
      </section> */}

      <section id="section-shortcut" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('shortcut')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Keyboard className="w-4 h-4" />
                Global Shortcuts
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">Control playback from Windows or macOS even when the app is in the background.</p>
            </div>
            <button
              onClick={() => {
                setRecordingShortcutAction(null)
                void saveGlobalShortcutConfig(DEFAULT_GLOBAL_SHORTCUTS, 'Restored default shortcuts')
              }}
              disabled={!hasGlobalShortcutApi || isLoadingGlobalShortcuts}
              className={cn(
                'px-3 py-2 rounded-xl text-sm transition-colors',
                !hasGlobalShortcutApi || isLoadingGlobalShortcuts
                  ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                  : 'bg-primary-500/10 text-primary-600 hover:bg-primary-500/15 dark:text-primary-300'
              )}
            >
              Restore Defaults
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {!hasGlobalShortcutApi ? (
            <div className="rounded-2xl border border-yellow-200 bg-yellow-50/80 dark:border-yellow-900/40 dark:bg-yellow-900/10 p-4">
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">Global shortcuts are only available in the desktop app.</p>
              <p className="text-xs text-yellow-600/90 dark:text-yellow-200/80 mt-1">
                This feature requires Electron to register system-level shortcuts.
              </p>
            </div>
          ) : (
            GLOBAL_SHORTCUT_ITEMS.map(({ action, label, description }) => {
              const currentValue = globalShortcutConfig[action]
              const currentStatus = globalShortcutStatus[action]
              const isRecording = recordingShortcutAction === action

              return (
                <div
                  key={action}
                  className={cn(
                    'rounded-2xl border p-4 transition-colors',
                    isRecording
                      ? 'border-primary-500 bg-primary-500/5'
                      : 'border-gray-200 dark:border-gray-700'
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{label}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>
                    </div>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                      isRecording
                        ? 'bg-primary-500 text-white'
                        : currentStatus.registered
                          ? 'bg-green-500/10 text-green-600 dark:text-green-300'
                          : currentValue
                            ? 'bg-red-500/10 text-red-600 dark:text-red-300'
                            : 'bg-gray-100 text-[var(--text-muted)] dark:bg-gray-800 dark:text-[var(--text-secondary)]'
                    )}>
                      {isRecording ? 'Recording' : currentStatus.registered ? 'Active' : currentValue ? 'Not registered' : 'Disabled'}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <div className={cn(
                      'min-h-[44px] min-w-[240px] flex-1 rounded-xl border px-3 py-2 text-sm',
                      isRecording
                        ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
                        : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
                    )}>
                      <span className="font-mono">
                        {isRecording
                          ? 'Press a shortcut, Esc to cancel'
                          : formatGlobalShortcut(currentValue, shortcutPlatform)}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        setRecordingShortcutAction((current) => current === action ? null : action)
                      }}
                      disabled={isLoadingGlobalShortcuts}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm transition-colors',
                        isLoadingGlobalShortcuts
                          ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                          : isRecording
                            ? 'bg-primary-500 text-white hover:bg-primary-600'
                            : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                    >
                      {isRecording ? 'Cancel' : 'Record'}
                    </button>

                    <button
                      onClick={() => {
                        setRecordingShortcutAction(null)
                        void saveGlobalShortcutConfig(
                          { ...globalShortcutConfig, [action]: DEFAULT_GLOBAL_SHORTCUTS[action] },
                          `${label} shortcut reset`,
                        )
                      }}
                      disabled={isLoadingGlobalShortcuts}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm transition-colors',
                        isLoadingGlobalShortcuts
                          ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                    >
                      Default
                    </button>

                    <button
                      onClick={() => {
                        setRecordingShortcutAction(null)
                        void saveGlobalShortcutConfig(
                          { ...globalShortcutConfig, [action]: null },
                          `${label} shortcut disabled`,
                        )
                      }}
                      disabled={isLoadingGlobalShortcuts || currentValue == null}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm transition-colors',
                        isLoadingGlobalShortcuts || currentValue == null
                          ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                    >
                      Disable
                    </button>
                  </div>

                  <div className="mt-3 space-y-1">
                    {currentStatus.error && currentValue ? (
                      <p className="text-xs text-red-500">{currentStatus.error}</p>
                    ) : null}
                    <p className="text-xs text-[var(--text-muted)]">
                      Default: {formatGlobalShortcut(DEFAULT_GLOBAL_SHORTCUTS[action], shortcutPlatform)}
                    </p>
                  </div>
                </div>
              )
            })
          )}

          <div className="rounded-2xl bg-gray-50 dark:bg-gray-900/40 p-4 text-xs text-[var(--text-muted)] space-y-1">
            <p>Use modifiers for custom shortcuts, for example `Ctrl / Cmd + Alt + ArrowLeft`, or fall back to the media keys.</p>
            <p>On macOS, media-key shortcuts may require accessibility permission in System Settings.</p>
          </div>
        </div>
      </section>

      {/* Audio section */}
      <section id="section-audio-quality" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('audio-quality')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Volume2 className="w-4 h-4" />
            音质选择
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">设置后对新播放的歌曲生效</p>
        </div>
        <div className="p-2">
          {QUALITY_OPTIONS.map(({ id, label, desc }) => (
            <button
              key={id}
              onClick={() => {
                setQuality(id)
                addToast({ type: 'success', message: `已设置默认音质为${QUALITY_NAMES[id]}，新播放的歌曲将使用此音质` })
              }}
              className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center text-sm font-medium',
                  quality === id
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)]'
                )}>
                  {desc.split(' ')[0]}
                </div>
                <div className="text-left">
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-[var(--text-muted)]">{desc}</p>
                </div>
              </div>
              {quality === id && <Check className="w-5 h-5 text-primary-500" />}
            </button>
          ))}
        </div>
        <div className="px-4 pb-4">
          <p className="text-xs text-[var(--text-muted)]">
            提示：会先在当前音源内按音质从高到低自动降级；全部音质都不可播放时，会按「智能换源」的设置尝试替代方案。
          </p>
        </div>
      </section>

      <section id="section-audio-effects" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('audio-effects')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Sliders className="w-4 h-4" />
            音效处理
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">可视化、均衡器、混响、环绕声和播放速率</p>
        </div>
        <div className="p-4 space-y-5">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">音频可视化</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">在播放详情页显示频谱动画，风格和 LX Music 的可视化能力保持一致方向。</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={audioEffects.audioVisualizationEnabled}
                onClick={() => setAudioVisualizationEnabled(!audioEffects.audioVisualizationEnabled)}
                className={cn(
                  'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
                  audioEffects.audioVisualizationEnabled ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                    audioEffects.audioVisualizationEnabled ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">均衡器</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">提供 10 段 EQ 预设和手动调节，修改后会立即作用到当前播放音频。</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={resetEq}
                  className="rounded-xl bg-gray-100 px-3 py-2 text-xs text-[var(--text-secondary)] transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-[var(--text-secondary)] dark:hover:bg-gray-700"
                >
                  重置
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={audioEffects.eqEnabled}
                  onClick={() => setEqEnabled(!audioEffects.eqEnabled)}
                  className={cn(
                    'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
                    audioEffects.eqEnabled ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                      audioEffects.eqEnabled ? 'translate-x-6' : 'translate-x-1'
                    )}
                  />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {EQ_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setEqPreset(preset.id)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs transition-colors',
                    audioEffects.eqPresetId === preset.id
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-100 text-[var(--text-secondary)] hover:bg-gray-200 dark:bg-gray-800 dark:text-[var(--text-secondary)] dark:hover:bg-gray-700'
                  )}
                >
                  {preset.name}
                </button>
              ))}
              {audioEffects.eqPresetId === 'custom' && (
                <span className="rounded-full bg-primary-50 px-3 py-1.5 text-xs text-primary-600 dark:bg-primary-500/15 dark:text-primary-300">
                  自定义
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {EQ_FREQUENCIES.map((frequency) => (
                <label key={frequency} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                  <div className="flex items-center justify-between text-xs">
                    <span>{frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`}</span>
                    <span className={cn(audioEffects.eqGains[frequency] > 0 ? 'text-primary-500' : 'text-[var(--text-muted)]')}>
                      {audioEffects.eqGains[frequency] > 0 ? '+' : ''}{audioEffects.eqGains[frequency]}dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={audioEffects.eqGains[frequency]}
                    onChange={(event) => setEqGain(frequency, Number(event.target.value))}
                    className="mt-3 w-full accent-primary-500"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">环境混响</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">使用程序生成的脉冲响应模拟空间混响，方向上对齐 LX Music 的环境音效。</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={audioEffects.reverbEnabled}
                  onClick={() => setReverbEnabled(!audioEffects.reverbEnabled)}
                  className={cn(
                    'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
                    audioEffects.reverbEnabled ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                      audioEffects.reverbEnabled ? 'translate-x-6' : 'translate-x-1'
                    )}
                  />
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {REVERB_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setReverbPreset(preset.id)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs transition-colors',
                      audioEffects.reverbPresetId === preset.id
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-100 text-[var(--text-secondary)] hover:bg-gray-200 dark:bg-gray-800 dark:text-[var(--text-secondary)] dark:hover:bg-gray-700'
                    )}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>

              <label className="block rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                <div className="flex items-center justify-between text-xs">
                  <span>直达声增益</span>
                  <span>{audioEffects.reverbMainGain}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={140}
                  step={1}
                  value={audioEffects.reverbMainGain}
                  onChange={(event) => setReverbMainGain(Number(event.target.value))}
                  className="mt-3 w-full accent-primary-500"
                />
              </label>

              <label className="block rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                <div className="flex items-center justify-between text-xs">
                  <span>混响发送增益</span>
                  <span>{audioEffects.reverbSendGain}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={140}
                  step={1}
                  value={audioEffects.reverbSendGain}
                  onChange={(event) => setReverbSendGain(Number(event.target.value))}
                  className="mt-3 w-full accent-primary-500"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">3D 环绕与播放速率</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">提供环绕声移动效果和播放速率调节，属于 LX Music 音效体系里的高阶音频能力。</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={audioEffects.spatialAudioEnabled}
                  onClick={() => setSpatialAudioEnabled(!audioEffects.spatialAudioEnabled)}
                  className={cn(
                    'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
                    audioEffects.spatialAudioEnabled ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                      audioEffects.spatialAudioEnabled ? 'translate-x-6' : 'translate-x-1'
                    )}
                  />
                </button>
              </div>

              <label className="block rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                <div className="flex items-center justify-between text-xs">
                  <span>环绕半径</span>
                  <span>{audioEffects.spatialAudioRadius}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={audioEffects.spatialAudioRadius}
                  onChange={(event) => setSpatialAudioRadius(Number(event.target.value))}
                  className="mt-3 w-full accent-primary-500"
                />
              </label>

              <label className="block rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                <div className="flex items-center justify-between text-xs">
                  <span>环绕速度</span>
                  <span>{audioEffects.spatialAudioSpeed}%</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={audioEffects.spatialAudioSpeed}
                  onChange={(event) => setSpatialAudioSpeed(Number(event.target.value))}
                  className="mt-3 w-full accent-primary-500"
                />
              </label>

              <label className="block rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                <div className="flex items-center justify-between text-xs">
                  <span>播放速率</span>
                  <span>{audioEffects.playbackRate.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.01}
                  value={audioEffects.playbackRate}
                  onChange={(event) => setPlaybackRate(Number(event.target.value))}
                  className="mt-3 w-full accent-primary-500"
                />
              </label>
            </div>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            提示：高级音效会接管浏览器的 Web Audio 链路。某些系统下如果你同时切换自定义输出设备，可能需要暂停后再继续播放一次，效果会更稳定。
          </p>
        </div>
      </section>

      {/* Audio Output Device */}
      <section id="section-device" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('device')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Speaker className="w-4 h-4" />
            音频输出设备
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">选择音频输出设备（需要浏览器/应用支持）</p>
        </div>
        <div className="p-2">
          {availableAudioDevices.length === 0 ? (
            <div className="p-4 text-center text-[var(--text-muted)]">
              <p className="text-sm">未检测到可用的音频输出设备</p>
              <button
                onClick={loadAudioDevices}
                className="mt-2 text-primary-500 text-sm hover:underline flex items-center gap-1 mx-auto"
              >
                <RefreshCw className="w-3 h-3" />
                刷新设备列表
              </button>
            </div>
          ) : (
            <>
              {availableAudioDevices.map((device) => {
                const isSelected = audioOutputDeviceId === device.deviceId || (audioOutputDeviceId === 'default' && device.deviceId === 'default')
                const isTestingThis = testingAudioDeviceId === device.deviceId
                const hasAnotherTestRunning = testingAudioDeviceId != null && !isTestingThis

                return (
                  <div
                    key={device.deviceId}
                    className={cn(
                      'flex items-center gap-2 p-3 rounded-lg transition-colors',
                      isSwitchingAudioOutputDevice
                        ? 'opacity-60'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    )}
                  >
                    <button
                      type="button"
                      onClick={async () => {
                        const result = await setAudioOutputDevice(device.deviceId)
                        if (result.success) {
                          addToast({ type: 'success', message: `已切换到: ${device.label}` })
                        } else {
                          addToast({ type: 'error', message: result.message || '切换音频设备失败' })
                        }
                      }}
                      disabled={isSwitchingAudioOutputDevice}
                      className={cn(
                        'flex-1 flex items-center justify-between min-w-0',
                        isSwitchingAudioOutputDevice && 'cursor-not-allowed'
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                          isSelected
                            ? 'bg-primary-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)]'
                        )}>
                          <Speaker className="w-5 h-5" />
                        </div>
                        <div className="text-left min-w-0">
                          <p className="font-medium truncate">{device.label}</p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {device.deviceId === 'default' ? '系统默认' : '音频输出'}
                          </p>
                        </div>
                      </div>
                      {isSwitchingAudioOutputDevice ? (
                        <Loader2 className="w-5 h-5 text-[var(--text-muted)] animate-spin flex-shrink-0 ml-3" />
                      ) : isSelected ? (
                        <Check className="w-5 h-5 text-primary-500 flex-shrink-0 ml-3" />
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleTestAudioDevice(device.deviceId, device.label)}
                      disabled={hasAnotherTestRunning || isSwitchingAudioOutputDevice}
                      title="播放测试音"
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors flex-shrink-0',
                        isTestingThis
                          ? 'bg-primary-500/15 text-primary-600 dark:text-primary-300'
                          : 'bg-gray-100 dark:bg-gray-800 text-[var(--text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-700',
                        (hasAnotherTestRunning || isSwitchingAudioOutputDevice) && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {isTestingThis ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      {isTestingThis ? '播放中' : '测试'}
                    </button>
                  </div>
                )
              })}
              <div className="px-3 py-2">
                <button
                  onClick={loadAudioDevices}
                  className="text-primary-500 text-sm hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  刷新设备列表
                </button>
              </div>
            </>
          )}
        </div>
        <div className="px-4 pb-4">
          <p className="text-xs text-[var(--text-muted)]">
            提示：此功能需要浏览器或 Electron 支持 setSinkId API。部分系统可能不支持切换音频设备。
          </p>
        </div>
      </section>

      {/* Update Check */}
      <section id="section-update" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('update')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            软件更新
          </h2>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">当前版本</p>
              <p className="text-sm text-[var(--text-muted)]">v{APP_VERSION}</p>
            </div>
            <button
              onClick={handleCheckUpdate}
              disabled={isCheckingUpdate}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl transition-colors',
                isCheckingUpdate
                  ? 'bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)] cursor-not-allowed'
                  : 'bg-primary-500 text-white hover:bg-primary-600'
              )}
            >
              <RefreshCw className={cn('w-4 h-4', isCheckingUpdate && 'animate-spin')} />
              {isCheckingUpdate ? '检查中...' : '检查更新'}
            </button>
          </div>

          {/* Update Info */}
          {updateInfo && (
            <div className={cn(
              'p-4 rounded-xl',
              updateInfo.hasUpdate
                ? 'bg-primary-500/10 border border-primary-500/20'
                : 'bg-green-500/10 border border-green-500/20'
            )}>
              {updateInfo.hasUpdate ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold text-primary-500">
                        发现新版本 v{updateInfo.latestVersion}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">点击下载更新</p>
                    </div>
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-2 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-sm hover:bg-primary-600 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      下载
                    </button>
                  </div>
                  <div className="text-sm space-y-1">
                    <p className="text-[var(--text-muted)] text-xs mb-2">更新内容：</p>
                    {updateInfo.changelog.map((log, i) => (
                      <p key={i} className="text-[var(--text-muted)]">{log}</p>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Check className="w-5 h-5" />
                  <span>已是最新版本</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>


      {/* About */}
      <section id="section-about" className="card overflow-hidden scroll-mt-6" hidden={!activeGroupSectionIds.includes('about')}>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold">关于</h2>
        </div>
        <div className="p-4 text-center space-y-4">
          <div>
            <h3 className="text-2xl font-bold text-primary-500">Sollin</h3>
            <p className="text-sm text-[var(--text-muted)]">Sol（音阶）+ Lin</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">v{APP_VERSION}</p>
          </div>
          <div className="text-sm text-[var(--text-muted)] space-y-1">
            {/* <p>一款为爱而生的音乐播放器 💕</p> */}
            <p className="text-xs text-[var(--text-muted)]">XSL ❤️</p>
          </div>
          <div className="pt-4 border-t border-gray-100 dark:border-gray-800 text-sm">
            <p className="font-medium">开发者</p>
            <p className="text-[var(--text-muted)]">Leguan ❤️</p>
          </div>
          <p className="text-xs text-[var(--text-muted)] pt-2">© 2025 Sollin. 所有数据保存在本地。</p>
        </div>
      </section>

      {showExportSelectionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowExportSelectionModal(false)}
        >
          <div
            className="w-full max-w-2xl bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-xl p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold mb-2">选择离线导出项目</h3>
            <p className="text-[var(--text-muted)] mb-6">导出的 JSON 与 WebDAV 备份格式完全一致，可只导出单个项目。</p>

            <BackupItemChecklist
              selection={offlineExportSelection}
              onChange={(key, checked) => setOfflineExportSelection((current) => ({ ...current, [key]: checked }))}
            />

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setOfflineExportSelection(createBackupSelection())}
                className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                全选
              </button>
              <button
                onClick={() => setOfflineExportSelection(createBackupSelection(false))}
                className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                清空
              </button>
              <button
                onClick={() => setShowExportSelectionModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleExport}
                disabled={isExportingBackup}
                className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50"
              >
                {isExportingBackup ? '导出中...' : '开始导出'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Confirm Modal - Moved to root to avoid clipping */}
      {showImportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => {
          if (conflicts.length === 0) setShowImportConfirm(false)
        }}>
          <div className={`w-full ${importData?.kind === 'webdav' ? 'max-w-2xl' : 'max-w-md'} bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-xl p-6`} onClick={e => e.stopPropagation()}>

            {conflicts.length > 0 ? (
              <>
                <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl text-yellow-800 dark:text-yellow-200 mb-6">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-bold">歌单名称冲突 ({currentConflictIndex + 1}/{conflicts.length})</p>
                    <p className="mt-1">
                      导入的歌单「{conflicts[currentConflictIndex].imported.name}」与现有歌单名称相同。
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <input
                      type="radio"
                      name="resolution"
                      value="rename"
                      checked={resolutionAction === 'rename'}
                      onChange={() => setResolutionAction('rename')}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <span className="block font-medium">重命名新建</span>
                      <span className="block text-sm text-[var(--text-muted)] mt-1">保留原有歌单，创建新歌单：</span>
                      {resolutionAction === 'rename' && (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="input mt-2 text-sm py-1.5"
                          autoFocus
                        />
                      )}
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <input
                      type="radio"
                      name="resolution"
                      value="replace"
                      checked={resolutionAction === 'replace'}
                      onChange={() => setResolutionAction('replace')}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <span className="block font-medium">覆盖原有歌单</span>
                      <span className="block text-sm text-[var(--text-muted)] mt-1">使用导入的歌单内容替换原有歌单</span>
                    </div>
                  </label>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => {
                      setShowImportConfirm(false)
                      setImportData(null)
                      setConflicts([])
                    }}
                    className="btn-secondary flex-1"
                  >
                    取消导入
                  </button>
                  <button
                    onClick={handleResolveConflict}
                    className="btn-primary flex-1"
                  >
                    确认
                  </button>
                </div>
              </>
            ) : importData?.kind === 'webdav' ? (
              <>
                <h3 className="text-xl font-bold mb-2">恢复跨端备份</h3>
                <p className="text-[var(--text-muted)] mb-6">
                  检测到移动端 / WebDAV 备份。桌面端只会处理在线喜欢、导入歌单、云音乐 Cookie 和 LX 音源，不恢复设置项和连接配置。
                </p>

                <BackupItemChecklist
                  selection={webDavImportSelection}
                  onChange={(key, checked) => setWebDavImportSelection((current) => ({ ...current, [key]: checked }))}
                  extraText={getWebDavImportExtraText(importData.data)}
                  disabled={getDisabledBackupSelection(getWebDavBackupIncludedSelection(importData.data))}
                />

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setWebDavImportSelection(getWebDavBackupIncludedSelection(importData.data))}
                    className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    全选可恢复项
                  </button>
                  <button
                    onClick={() => {
                      setShowImportConfirm(false)
                      setImportData(null)
                      setWebDavImportSelection(createBackupSelection())
                    }}
                    className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleConfirmImport('replace')}
                    className="flex-1 py-3 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition-colors font-medium"
                  >
                    开始恢复
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-xl font-bold mb-2">导入数据</h3>
                <p className="text-[var(--text-muted)] mb-6">发现备份数据，请选择导入方式：</p>

                <div className="space-y-3">
                  <button
                    onClick={() => handleConfirmImport('merge')}
                    className="w-full p-4 rounded-xl border-2 border-primary-500 bg-primary-500/5 hover:bg-primary-500/10 transition-colors text-left"
                  >
                    <span className="block font-bold text-primary-500">合并数据 (推荐)</span>
                    <span className="block text-xs text-[var(--text-muted)] mt-1">保留现有数据，将备份中的新数据添加到当前库中</span>
                  </button>

                  <button
                    onClick={() => handleConfirmImport('replace')}
                    className="w-full p-4 rounded-xl border-2 border-red-500/20 hover:border-red-500/50 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors text-left"
                  >
                    <span className="block font-bold text-red-500">覆盖替换</span>
                    <span className="block text-xs text-[var(--text-muted)] mt-1">警告：清空当前所有数据，完全恢复为备份状态</span>
                  </button>
                </div>

                <button
                  onClick={() => {
                    setShowImportConfirm(false)
                    setImportData(null)
                  }}
                  className="w-full mt-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
                >
                  取消
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <BackupModal
        isOpen={showBackupModal}
        onClose={() => setShowBackupModal(false)}
      />
      <ImageCropModal
        isOpen={cropModalOpen}
        imageSrc={cropImageSrc || ''}
        aspectRatio={1400 / 900}
        onClose={() => {
          setCropModalOpen(false)
          setCropImageSrc(null)
        }}
        onCrop={(dataUrl) => {
          setBackgroundSettings({ customImagePath: dataUrl })
          setCropModalOpen(false)
          setCropImageSrc(null)
        }}
      />
      </div>
    </div>
  )
}
