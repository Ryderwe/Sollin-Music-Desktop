import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type DownloadTaskStatus = 'pending' | 'downloading' | 'completed' | 'failed'
export type DownloadFileNamePart = 'artist' | 'album' | 'title'

export const DOWNLOAD_FILE_NAME_PARTS: DownloadFileNamePart[] = ['artist', 'album', 'title']
export const DEFAULT_DOWNLOAD_FILE_NAME_PARTS: DownloadFileNamePart[] = ['artist', 'title']
export const DEFAULT_DOWNLOAD_FILE_NAME_SEPARATOR = '-'

export interface DownloadTask {
  id: string
  songId: string
  songName: string
  artist: string
  album: string
  quality?: string
  status: DownloadTaskStatus
  progress: number
  targetDirectory: string
  filePath?: string
  error?: string
  warning?: string
  createdAt: string
  updatedAt: string
}

interface DownloadStore {
  defaultDownloadDirectory: string
  downloadDirectory: string
  downloadFileNameRuleEnabled: boolean
  downloadFileNameParts: DownloadFileNamePart[]
  downloadFileNameSeparator: string
  saveExternalMetadataFiles: boolean
  tasks: DownloadTask[]
  setDefaultDownloadDirectory: (path: string) => void
  setDownloadDirectory: (path: string) => void
  setDownloadFileNameRuleEnabled: (enabled: boolean) => void
  setDownloadFileNameParts: (parts: DownloadFileNamePart[]) => void
  setDownloadFileNameSeparator: (separator: string) => void
  setSaveExternalMetadataFiles: (enabled: boolean) => void
  resetDownloadFileNameRule: () => void
  upsertTask: (task: DownloadTask) => void
  updateTask: (taskId: string, patch: Partial<DownloadTask>) => void
  removeTask: (taskId: string) => void
  clearCompleted: () => void
  clearFailed: () => void
  clearDownloading: () => void
}

const MAX_TASK_HISTORY = 100
const MAX_SEPARATOR_LENGTH = 12

export const normalizeDownloadFileNameParts = (parts: unknown): DownloadFileNamePart[] => {
  if (!Array.isArray(parts)) return [...DEFAULT_DOWNLOAD_FILE_NAME_PARTS]

  const normalized: DownloadFileNamePart[] = []
  for (const part of parts) {
    if (!DOWNLOAD_FILE_NAME_PARTS.includes(part) || normalized.includes(part)) continue
    normalized.push(part)
  }

  return normalized.length ? normalized : [...DEFAULT_DOWNLOAD_FILE_NAME_PARTS]
}

export const normalizeDownloadFileNameSeparator = (separator: unknown): string => {
  if (typeof separator !== 'string') return DEFAULT_DOWNLOAD_FILE_NAME_SEPARATOR

  const normalized = separator
    .replace(/[<>:"/\\?*\u0000-\u001F]/g, '')
    .replace(/\|/g, '｜')
    .slice(0, MAX_SEPARATOR_LENGTH)

  return normalized || DEFAULT_DOWNLOAD_FILE_NAME_SEPARATOR
}

const sortTasks = (tasks: DownloadTask[]) => tasks
  .slice()
  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  .slice(0, MAX_TASK_HISTORY)

export const useDownloadStore = create<DownloadStore>()(
  persist(
    (set) => ({
      defaultDownloadDirectory: '',
      downloadDirectory: '',
      downloadFileNameRuleEnabled: false,
      downloadFileNameParts: [...DEFAULT_DOWNLOAD_FILE_NAME_PARTS],
      downloadFileNameSeparator: DEFAULT_DOWNLOAD_FILE_NAME_SEPARATOR,
      saveExternalMetadataFiles: false,
      tasks: [],

      setDefaultDownloadDirectory: (path) => set((state) => ({
        defaultDownloadDirectory: path,
        downloadDirectory: state.downloadDirectory || path,
      })),

      setDownloadDirectory: (path) => set({ downloadDirectory: path }),

      setDownloadFileNameRuleEnabled: (enabled) => set({ downloadFileNameRuleEnabled: enabled }),

      setDownloadFileNameParts: (parts) => set({
        downloadFileNameParts: normalizeDownloadFileNameParts(parts),
      }),

      setDownloadFileNameSeparator: (separator) => set({
        downloadFileNameSeparator: normalizeDownloadFileNameSeparator(separator),
      }),

      setSaveExternalMetadataFiles: (enabled) => set({ saveExternalMetadataFiles: enabled }),

      resetDownloadFileNameRule: () => set({
        downloadFileNameParts: [...DEFAULT_DOWNLOAD_FILE_NAME_PARTS],
        downloadFileNameSeparator: DEFAULT_DOWNLOAD_FILE_NAME_SEPARATOR,
      }),

      upsertTask: (task) => set((state) => {
        const existingIndex = state.tasks.findIndex((item) => item.id === task.id)
        if (existingIndex >= 0) {
          const nextTasks = state.tasks.slice()
          nextTasks[existingIndex] = task
          return { tasks: sortTasks(nextTasks) }
        }

        return { tasks: sortTasks([task, ...state.tasks]) }
      }),

      updateTask: (taskId, patch) => set((state) => ({
        tasks: sortTasks(state.tasks.map((task) => task.id === taskId
          ? {
            ...task,
            ...patch,
            updatedAt: patch.updatedAt || new Date().toISOString(),
          }
          : task)),
      })),

      clearCompleted: () => set((state) => ({
        tasks: state.tasks.filter((task) => task.status !== 'completed'),
      })),

      clearFailed: () => set((state) => ({
        tasks: state.tasks.filter((task) => task.status !== 'failed'),
      })),

      removeTask: (taskId) => set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== taskId),
      })),

      clearDownloading: () => set((state) => ({
        tasks: state.tasks.filter((task) => task.status !== 'pending' && task.status !== 'downloading'),
      })),
    }),
    {
      name: 'download-storage',
      partialize: (state) => ({
        defaultDownloadDirectory: state.defaultDownloadDirectory,
        downloadDirectory: state.downloadDirectory,
        downloadFileNameRuleEnabled: state.downloadFileNameRuleEnabled,
        downloadFileNameParts: state.downloadFileNameParts,
        downloadFileNameSeparator: state.downloadFileNameSeparator,
        saveExternalMetadataFiles: state.saveExternalMetadataFiles,
        tasks: state.tasks,
      }),
      merge: (persisted, current) => {
        const state = {
          ...current,
          ...(persisted as Partial<DownloadStore>),
        }

        return {
          ...state,
          downloadFileNameParts: normalizeDownloadFileNameParts(state.downloadFileNameParts),
          downloadFileNameSeparator: normalizeDownloadFileNameSeparator(state.downloadFileNameSeparator),
          downloadFileNameRuleEnabled: Boolean(state.downloadFileNameRuleEnabled),
          saveExternalMetadataFiles: Boolean(state.saveExternalMetadataFiles),
        }
      },
    },
  ),
)
