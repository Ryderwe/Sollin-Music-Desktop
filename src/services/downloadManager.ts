import api from '@/services/api'
import { resolveSongForLibrary } from '@/services/officialCoverApi'
import { useDownloadStore, type DownloadFileNamePart, type DownloadTask } from '@/stores/downloadStore'
import { usePlayerStore } from '@/stores/playerStore'
import type { LyricData, Song } from '@/types'

type DownloadEventPayload = {
  taskId: string
  status: DownloadTask['status']
  progress: number
  filePath?: string
  error?: string
  warning?: string
}

type StartSongDownloadPayload = {
  taskId: string
  source: string
  sourceType: 'local' | 'remote'
  targetDirectory: string
  song: {
    title: string
    artist: string
    album: string
    songId: string
    quality?: string
  }
  lyricData?: LyricData | null
  lyrics?: string | null
  coverUrl?: string | null
  fileNameRule?: {
    enabled: boolean
    parts: DownloadFileNamePart[]
    separator: string
  }
  saveExternalMetadataFiles?: boolean
}

type StartSongDownloadResult = {
  taskId: string
  filePath: string
  warning?: string
  metadataEmbedded: boolean
}

const createTaskId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `download-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const getNow = () => new Date().toISOString()

class DownloadManagerService {
  private initialized = false
  private unsubscribe: (() => void) | null = null

  private ensureElectronApi() {
    const electronApi = window.electronAPI
    if (!electronApi?.startSongDownload) {
      throw new Error('当前环境不支持下载功能，请在桌面端使用')
    }
    return electronApi
  }

  private resolveTaskDirectory() {
    const { downloadDirectory, defaultDownloadDirectory } = useDownloadStore.getState()
    return downloadDirectory || defaultDownloadDirectory
  }

  private upsertTaskFromEvent(payload: DownloadEventPayload) {
    const store = useDownloadStore.getState()
    const task = store.tasks.find((item) => item.id === payload.taskId)
    if (!task) return

    store.updateTask(payload.taskId, {
      status: payload.status,
      progress: payload.progress,
      filePath: payload.filePath,
      error: payload.error,
      warning: payload.warning,
      updatedAt: getNow(),
    })
  }

  async ensureInitialized() {
    if (this.initialized) return

    const electronApi = window.electronAPI
    if (!electronApi) return

    if (electronApi.getDownloadDefaultDirectory) {
      try {
        const defaultDirectory = await electronApi.getDownloadDefaultDirectory()
        if (defaultDirectory) {
          useDownloadStore.getState().setDefaultDownloadDirectory(defaultDirectory)
        }
      } catch (error) {
        console.warn('Load default download directory failed:', error)
      }
    }

    if (electronApi.onDownloadEvent) {
      this.unsubscribe = electronApi.onDownloadEvent((payload) => {
        this.upsertTaskFromEvent(payload)
      })
    }

    this.initialized = true
  }

  dispose() {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.initialized = false
  }

  async chooseDownloadDirectory() {
    const electronApi = this.ensureElectronApi()
    const nextPath = await electronApi.pickDownloadDirectory?.()
    if (!nextPath) return null
    useDownloadStore.getState().setDownloadDirectory(nextPath)
    return nextPath
  }

  async openDownloadDirectory() {
    const electronApi = this.ensureElectronApi()
    const directory = this.resolveTaskDirectory()
    if (!directory) {
      throw new Error('下载目录尚未初始化')
    }
    await electronApi.openDownloadDirectory?.(directory)
  }

  async showItemInFolder(filePath: string) {
    const electronApi = this.ensureElectronApi()
    await electronApi.showItemInFolder?.(filePath)
  }

  async cancelDownload(taskId: string) {
    const electronApi = this.ensureElectronApi()
    try {
      await electronApi.cancelDownload?.(taskId)
    } catch {
      // ignore - download may have already finished
    }
  }

  async removeTask(taskId: string) {
    const store = useDownloadStore.getState()
    const task = store.tasks.find((t) => t.id === taskId)

    if (task && (task.status === 'pending' || task.status === 'downloading')) {
      await this.cancelDownload(taskId)
    }

    // Clean up temp file
    const directory = task?.targetDirectory || this.resolveTaskDirectory()
    if (directory) {
      try {
        await window.electronAPI?.deleteDownloadTempFile?.(directory, taskId)
      } catch {}
    }

    store.removeTask(taskId)
  }

  async clearAllDownloading() {
    const store = useDownloadStore.getState()
    const downloadingTasks = store.tasks.filter(
      (t) => t.status === 'pending' || t.status === 'downloading',
    )

    for (const task of downloadingTasks) {
      await this.cancelDownload(task.id)
      try {
        await window.electronAPI?.deleteDownloadTempFile?.(task.targetDirectory, task.id)
      } catch {}
    }

    store.clearDownloading()
  }

  async downloadSong(song: Song) {
    await this.ensureInitialized()

    const electronApi = this.ensureElectronApi()
    const { quality, autoTemporarySourceSwitch } = usePlayerStore.getState()
    const downloadState = useDownloadStore.getState()
    const targetDirectory = this.resolveTaskDirectory()

    if (!targetDirectory) {
      throw new Error('下载目录尚未初始化，请稍后重试')
    }

    let source = ''
    let sourceType: StartSongDownloadPayload['sourceType'] = 'remote'
    let lyricData: LyricData | null = song.lrc ? { lyric: song.lrc } : null
    let lyrics = song.lrc || null
    let coverUrl = song.cover || null
    let actualQuality = song.quality || quality

    if (song.platform === 'local') {
      source = song.localPath || song.url || ''
      sourceType = 'local'
    } else {
      const result = await api.getSongUrl(song.platform, song.id, quality, {
        song,
        allowTempSourceFallback: autoTemporarySourceSwitch,
      })

      if (!result?.url || result.error) {
        throw new Error(result?.error?.message || '无法获取下载链接')
      }

      source = result.url
      actualQuality = result.quality

      lyricData = await api.getLyricData(song)
      lyrics = lyricData?.lyric || lyrics

      if (!coverUrl) {
        try {
          const resolved = await resolveSongForLibrary(song)
          coverUrl = resolved.cover || null
        } catch (error) {
          console.warn('Resolve song cover for download failed:', error)
        }
      }
    }

    if (!source) {
      throw new Error(song.platform === 'local' ? '本地歌曲缺少文件路径' : '下载链接为空')
    }

    const taskId = createTaskId()
    const createdAt = getNow()

    useDownloadStore.getState().upsertTask({
      id: taskId,
      songId: song.id,
      songName: song.name,
      artist: song.artist,
      album: song.album,
      quality: actualQuality,
      status: 'pending',
      progress: 0,
      targetDirectory,
      createdAt,
      updatedAt: createdAt,
    })

    try {
      const result = await electronApi.startSongDownload({
        taskId,
        source,
        sourceType,
        targetDirectory,
        song: {
          title: song.name,
          artist: song.artist,
          album: song.album,
          songId: song.id,
          quality: actualQuality,
        },
        lyricData,
        lyrics,
        coverUrl,
        fileNameRule: {
          enabled: downloadState.downloadFileNameRuleEnabled,
          parts: downloadState.downloadFileNameParts,
          separator: downloadState.downloadFileNameSeparator,
        },
        saveExternalMetadataFiles: downloadState.saveExternalMetadataFiles,
      }) as StartSongDownloadResult

      useDownloadStore.getState().updateTask(taskId, {
        status: 'completed',
        progress: 100,
        filePath: result.filePath,
        warning: result.warning,
        error: undefined,
      })

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载失败'
      useDownloadStore.getState().updateTask(taskId, {
        status: 'failed',
        error: message,
        progress: 0,
      })
      throw error
    }
  }
}

export const downloadManager = new DownloadManagerService()
export default downloadManager
