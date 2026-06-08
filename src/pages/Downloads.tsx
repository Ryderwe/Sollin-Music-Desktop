import { useEffect } from 'react'
import {
  AlertTriangle,
  FolderOpen,
  Trash2,
} from 'lucide-react'
import { useDownloadStore } from '@/stores/downloadStore'
import { useUIStore } from '@/stores/uiStore'
import { downloadManager } from '@/services/downloadManager'
import { cn } from '@/utils/cn'

export default function Downloads() {
  const { addToast } = useUIStore()
  const {
    defaultDownloadDirectory,
    downloadDirectory,
    tasks: downloadTasks,
    setDefaultDownloadDirectory,
    setDownloadDirectory,
    clearCompleted,
    clearFailed,
  } = useDownloadStore()

  const electronApi = typeof window !== 'undefined' ? window.electronAPI : undefined
  const hasDownloadApi = typeof electronApi?.startSongDownload === 'function'
  const resolvedDownloadDirectory = downloadDirectory || defaultDownloadDirectory
  const downloadingTaskCount = downloadTasks.filter((task) => task.status === 'pending' || task.status === 'downloading').length
  const completedDownloadCount = downloadTasks.filter((task) => task.status === 'completed').length
  const failedDownloadCount = downloadTasks.filter((task) => task.status === 'failed').length

  useEffect(() => {
    void downloadManager.ensureInitialized()
  }, [])

  const handlePickDownloadDirectory = async() => {
    try {
      const nextPath = await downloadManager.chooseDownloadDirectory()
      if (!nextPath) return
      setDownloadDirectory(nextPath)
      addToast({ type: 'success', message: '下载目录已更新' })
    } catch (error) {
      console.error('Pick download directory failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '选择下载目录失败' })
    }
  }

  const handleResetDownloadDirectory = async() => {
    try {
      await downloadManager.ensureInitialized()
      const fallbackDirectory = defaultDownloadDirectory || await electronApi?.getDownloadDefaultDirectory?.() || ''
      if (!fallbackDirectory) {
        throw new Error('默认下载目录不可用')
      }
      setDefaultDownloadDirectory(fallbackDirectory)
      setDownloadDirectory(fallbackDirectory)
      addToast({ type: 'success', message: '已恢复默认下载目录' })
    } catch (error) {
      console.error('Reset download directory failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '恢复默认下载目录失败' })
    }
  }

  const handleOpenDownloadDirectory = async() => {
    try {
      await downloadManager.openDownloadDirectory()
    } catch (error) {
      console.error('Open download directory failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '打开下载目录失败' })
    }
  }

  const handleShowDownloadedFile = async(filePath: string) => {
    try {
      await downloadManager.showItemInFolder(filePath)
    } catch (error) {
      console.error('Show downloaded file failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '无法定位下载文件' })
    }
  }

  const handleRemoveTask = async(taskId: string) => {
    try {
      await downloadManager.removeTask(taskId)
    } catch (error) {
      console.error('Remove download task failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '删除任务失败' })
    }
  }

  const handleClearAllDownloading = async() => {
    try {
      await downloadManager.clearAllDownloading()
      addToast({ type: 'success', message: '已清除所有正在下载的任务' })
    } catch (error) {
      console.error('Clear downloading tasks failed:', error)
      addToast({ type: 'error', message: error instanceof Error ? error.message : '清除下载任务失败' })
    }
  }

  return (
    <div className="space-y-6 pb-32">
      <div>
        <h1 className="text-3xl font-bold">下载管理</h1>
        <p className="text-sm text-[var(--text-muted)] mt-2">管理歌曲下载目录，并查看每首歌曲的下载与元数据写入状态</p>
      </div>

      {!hasDownloadApi ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-900/20 p-5 text-sm text-amber-700 dark:text-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">当前环境不支持下载管理</p>
            <p className="mt-1 text-xs">
              请在 Electron 桌面端中使用下载功能，默认目录会创建在家目录下的 `Downloads/sollin`。
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="card p-4">
              <p className="text-xs text-[var(--text-muted)] mb-2">进行中</p>
              <p className="text-2xl font-semibold text-primary-500">{downloadingTaskCount}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-[var(--text-muted)] mb-2">已完成</p>
              <p className="text-2xl font-semibold text-green-500">{completedDownloadCount}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-[var(--text-muted)] mb-2">失败</p>
              <p className="text-2xl font-semibold text-red-500">{failedDownloadCount}</p>
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">下载目录</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">默认目录：{defaultDownloadDirectory || '加载中...'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void handlePickDownloadDirectory()}
                  className="px-3 py-2 rounded-xl bg-primary-500 text-white text-sm hover:bg-primary-600 transition-colors"
                >
                  选择目录
                </button>
                <button
                  onClick={() => void handleResetDownloadDirectory()}
                  className="px-3 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  恢复默认
                </button>
                <button
                  onClick={() => void handleOpenDownloadDirectory()}
                  className="px-3 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
                >
                  <FolderOpen className="w-4 h-4" />
                  打开目录
                </button>
              </div>
            </div>
            <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-4 py-3 text-sm break-all">
              {resolvedDownloadDirectory || '正在初始化下载目录...'}
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">下载任务</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">从歌曲更多菜单点击“下载”后，任务会出现在这里</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleClearAllDownloading()}
                  disabled={downloadingTaskCount === 0}
                  className="px-3 py-2 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm disabled:opacity-50 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                >
                  停止全部下载
                </button>
                <button
                  onClick={clearCompleted}
                  disabled={completedDownloadCount === 0}
                  className="px-3 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-sm disabled:opacity-50"
                >
                  清除已完成
                </button>
                <button
                  onClick={clearFailed}
                  disabled={failedDownloadCount === 0}
                  className="px-3 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-sm disabled:opacity-50"
                >
                  清除失败
                </button>
              </div>
            </div>

            {downloadTasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 px-6 py-10 text-center text-sm text-[var(--text-muted)]">
                还没有下载任务，去歌曲列表的更多菜单试试“下载”吧。
              </div>
            ) : (
              <div className="space-y-2">
                {downloadTasks.map((task) => (
                  <div key={task.id} className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900/60 px-3 py-2.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{task.songName}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">{task.artist}{task.album ? ` · ${task.album}` : ''}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {task.quality ? `音质 ${task.quality} · ` : ''}{new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false })}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0',
                          (task.status === 'pending' || task.status === 'downloading') && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                          task.status === 'completed' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                          task.status === 'failed' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                        )}
                      >
                        {task.status === 'pending'
                          ? '等待中'
                          : task.status === 'downloading'
                            ? '下载中'
                            : task.status === 'completed'
                              ? '已完成'
                              : '失败'}
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-1">
                        <span>进度</span>
                        <span>{task.progress}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            task.status === 'failed' ? 'bg-red-500' : task.status === 'completed' ? 'bg-green-500' : 'bg-primary-500',
                          )}
                          style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }}
                        />
                      </div>
                    </div>

                    {task.warning && (
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-200 text-[11px] px-2.5 py-1.5">
                        {task.warning}
                      </div>
                    )}

                    {task.error && (
                      <div className="rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-200 text-[11px] px-2.5 py-1.5">
                        {task.error}
                      </div>
                    )}

                    <div className="text-[11px] text-[var(--text-muted)] break-all">
                      保存目录：{task.filePath || task.targetDirectory}
                    </div>

                    <div className="flex justify-end gap-2">
                      {task.filePath && (
                        <button
                          onClick={() => void handleShowDownloadedFile(task.filePath as string)}
                          className="px-2.5 py-1 rounded-lg bg-gray-200 dark:bg-gray-700 text-xs hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                        >
                          在文件夹中显示
                        </button>
                      )}
                      <button
                        onClick={() => void handleRemoveTask(task.id)}
                        className="p-1 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="删除任务"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
