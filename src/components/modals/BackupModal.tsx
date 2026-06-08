import { useEffect, useState } from 'react'
import {
  X,
  Cloud,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  AlertCircle,
  Save,
  Folder,
  Server,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUIStore } from '@/stores/uiStore'
import { useUserStore } from '@/stores/userStore'
import { useAuthStore } from '@/stores/authStore'
import type { WebDavBackupConfig, WebDavRemoteFile } from '@/types/backup'
import {
  DEFAULT_WEBDAV_REMOTE_DIRECTORY,
  deleteWebDavBackup,
  downloadWebDavBackup,
  getStoredWebDavConfig,
  listWebDavBackups,
  normalizeWebDavConfig,
  saveWebDavConfig,
  testWebDavConnection,
  uploadWebDavBackup,
} from '@/services/webdavBackup'
import {
  buildWebDavBackupData,
  createWebDavBackupFileName,
  parseWebDavBackupData,
  restoreWebDavBackupData,
  stringifyWebDavBackupData,
} from '@/services/backupStrategy'

interface BackupModalProps {
  isOpen: boolean
  onClose: () => void
}

const formatDate = (value: string | null) => {
  if (!value) return '未知时间'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '未知时间'
    : date.toLocaleString('zh-CN', { hour12: false })
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const isConfigReady = (config: WebDavBackupConfig) => {
  return Boolean(config.serverUrl.trim() && config.username.trim() && config.password.trim())
}

export default function BackupModal({ isOpen, onClose }: BackupModalProps) {
  const [config, setConfig] = useState<WebDavBackupConfig>(() => getStoredWebDavConfig())
  const [backups, setBackups] = useState<WebDavRemoteFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [activeRestoreName, setActiveRestoreName] = useState<string | null>(null)
  const [activeDeleteName, setActiveDeleteName] = useState<string | null>(null)

  const { addToast } = useUIStore()
  const onlinePlaylistCount = useUserStore((state) => state.onlinePlaylists.length)
  const likeSongCount = useAuthStore((state) => state.likeSongIds.length)
  const hasNeteaseCookie = Boolean(useAuthStore((state) => state.cookie)?.trim())

  const persistConfig = () => {
    const normalized = normalizeWebDavConfig(config)
    saveWebDavConfig(normalized)
    setConfig(normalized)
    return normalized
  }

  const loadBackups = async(nextConfig?: WebDavBackupConfig) => {
    const targetConfig = nextConfig || config
    if (!isConfigReady(targetConfig)) {
      setBackups([])
      return
    }

    setIsLoading(true)
    try {
      const normalized = normalizeWebDavConfig(targetConfig)
      const items = await listWebDavBackups(normalized)
      setBackups(items)
    } catch (error: any) {
      console.error('Load WebDAV backups failed:', error)
      addToast({ type: 'error', message: error.message || '读取 WebDAV 备份失败' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const stored = getStoredWebDavConfig()
    setConfig(stored)
    if (isConfigReady(stored)) {
      void loadBackups(stored)
    } else {
      setBackups([])
    }
  }, [isOpen])

  const handleConfigChange = (field: keyof WebDavBackupConfig, value: string) => {
    setConfig((current) => ({ ...current, [field]: value }))
  }

  const handleSave = async() => {
    setIsSaving(true)
    try {
      const normalized = persistConfig()
      addToast({ type: 'success', message: 'WebDAV 配置已保存' })
      await loadBackups(normalized)
    } catch (error: any) {
      addToast({ type: 'error', message: error.message || '保存配置失败' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async() => {
    setIsTesting(true)
    try {
      const normalized = await testWebDavConnection(config)
      saveWebDavConfig(normalized)
      setConfig(normalized)
      addToast({ type: 'success', message: 'WebDAV 连接正常' })
      await loadBackups(normalized)
    } catch (error: any) {
      addToast({ type: 'error', message: error.message || '连接测试失败' })
    } finally {
      setIsTesting(false)
    }
  }

  const handleUpload = async() => {
    setIsUploading(true)
    try {
      const normalized = persistConfig()
      const backupData = await buildWebDavBackupData()
      const fileName = createWebDavBackupFileName(new Date(backupData.createdAt))
      await uploadWebDavBackup(normalized, fileName, stringifyWebDavBackupData(backupData))
      addToast({ type: 'success', message: `备份已上传：${fileName}` })
      await loadBackups(normalized)
    } catch (error: any) {
      addToast({ type: 'error', message: error.message || '上传备份失败' })
    } finally {
      setIsUploading(false)
    }
  }

  const handleRestore = async(file: WebDavRemoteFile) => {
    if (!confirm('恢复将覆盖当前在线同步数据和 LX 音源，不会恢复设置。确定继续吗？')) return

    setActiveRestoreName(file.name)
    try {
      const normalized = persistConfig()
      const text = await downloadWebDavBackup(normalized, file)
      const backupData = parseWebDavBackupData(JSON.parse(text))
      const result = await restoreWebDavBackupData(backupData)

      if (result.warnings.length) {
        addToast({ type: 'warning', message: result.warnings[0] })
      }

      addToast({
        type: 'success',
        message: `恢复完成：${result.onlineFavoritesCount} 条在线喜欢，${result.onlinePlaylistsCount} 个导入歌单，${result.lxSourceCount} 个 LX 音源`,
      })
    } catch (error: any) {
      addToast({ type: 'error', message: error.message || '恢复备份失败' })
    } finally {
      setActiveRestoreName(null)
    }
  }

  const handleDelete = async(file: WebDavRemoteFile) => {
    if (!confirm(`确定删除备份 ${file.name} 吗？此操作不可恢复。`)) return

    setActiveDeleteName(file.name)
    try {
      const normalized = persistConfig()
      await deleteWebDavBackup(normalized, file)
      addToast({ type: 'success', message: '备份已删除' })
      await loadBackups(normalized)
    } catch (error: any) {
      addToast({ type: 'error', message: error.message || '删除备份失败' })
    } finally {
      setActiveDeleteName(null)
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-4xl bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-2xl overflow-hidden"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative p-6 pb-4 border-b border-gray-100 dark:border-gray-800">
            <button
              onClick={onClose}
              className="absolute right-4 top-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center">
                <Cloud className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold">WebDAV 备份</h2>
                <p className="text-[var(--text-muted)] text-sm">与移动端使用同一套备份 JSON 结构</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-0">
            <div className="p-5 border-b lg:border-b-0 lg:border-r border-gray-100 dark:border-gray-800 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="md:col-span-2 space-y-1.5">
                  <span className="text-sm text-[var(--text-muted)] flex items-center gap-1.5">
                    <Server className="w-4 h-4" />
                    WebDAV 地址
                  </span>
                  <input
                    value={config.serverUrl}
                    onChange={(event) => handleConfigChange('serverUrl', event.target.value)}
                    placeholder="https://example.com/remote.php/dav/files/username"
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm text-[var(--text-muted)]">账号</span>
                  <input
                    value={config.username}
                    onChange={(event) => handleConfigChange('username', event.target.value)}
                    placeholder="username"
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm text-[var(--text-muted)]">密码 / 应用专用密码</span>
                  <input
                    type="password"
                    value={config.password}
                    onChange={(event) => handleConfigChange('password', event.target.value)}
                    placeholder="password"
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </label>

                <label className="md:col-span-2 space-y-1.5">
                  <span className="text-sm text-[var(--text-muted)] flex items-center gap-1.5">
                    <Folder className="w-4 h-4" />
                    远端目录
                  </span>
                  <input
                    value={config.remoteDirectory}
                    onChange={(event) => handleConfigChange('remoteDirectory', event.target.value)}
                    placeholder={DEFAULT_WEBDAV_REMOTE_DIRECTORY}
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  保存配置
                </button>
                <button
                  onClick={handleTest}
                  disabled={isTesting}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  {isTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
                  测试连接
                </button>
                <button
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50"
                >
                  {isUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  创建备份
                </button>
              </div>

              <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/50 p-4 space-y-2 text-sm">
                <p className="font-medium">当前可同步内容</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[var(--text-muted)]">
                  <p>在线喜欢：{likeSongCount} 条</p>
                  <p>导入歌单：{onlinePlaylistCount} 个</p>
                  <p>小芸 Cookie：{hasNeteaseCookie ? '已保存' : '未保存'}</p>
                </div>
                <p className="text-xs text-[var(--text-muted)]">恢复时会同步在线喜欢、导入歌单、小芸 Cookie 和 LX 音源；不会恢复设置。</p>
              </div>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-[var(--text-muted)]">远端备份列表</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">仅显示 `.json` 文件，按修改时间倒序</p>
                </div>
                <button
                  onClick={() => loadBackups()}
                  disabled={isLoading}
                  className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  title="刷新列表"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {!isConfigReady(config) ? (
                <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center text-sm text-[var(--text-muted)]">
                  请先填写并保存 WebDAV 配置。
                </div>
              ) : isLoading && backups.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
                </div>
              ) : backups.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center text-sm text-[var(--text-muted)]">
                  远端目录里还没有备份文件。
                </div>
              ) : (
                <div className="space-y-3">
                  {backups.map((file) => (
                    <div
                      key={file.url}
                      className="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium break-all">{file.name}</p>
                          <p className="text-sm text-[var(--text-muted)] mt-1">{formatDate(file.modifiedAt)} · {formatSize(file.size)}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleRestore(file)}
                            disabled={activeRestoreName === file.name}
                            className="p-2 text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors disabled:opacity-50"
                            title="恢复此备份"
                          >
                            {activeRestoreName === file.name ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(file)}
                            disabled={activeDeleteName === file.name}
                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                            title="删除备份"
                          >
                            {activeDeleteName === file.name ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="p-4 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>
                备份文件名遵循 `sollin_backup_YYYYMMDD_HHMMSS.json`。当前实现会兼容移动端 WebDAV 备份格式，忽略 `localFavoriteSongIds`、`localPlaylists` 和设置恢复。
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
