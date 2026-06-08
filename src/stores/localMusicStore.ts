import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import localforage from 'localforage'
import type { Song } from '@/types'
import { useUIStore } from '@/stores/uiStore'

const localMusicStorage = localforage.createInstance({
  name: 'Sollin',
  storeName: 'Sollin_local_music_store',
  description: 'Sollin local music library',
})

export type LocalMusicTagPriority = 'embedded-first' | 'external-first'

type LocalMusicStore = {
  folders: string[]
  songs: Song[]
  isScanning: boolean
  lastScannedAt: string | null
  scanError: string | null
  tagPriority: LocalMusicTagPriority
  setTagPriority: (priority: LocalMusicTagPriority) => void
  pickFolders: () => Promise<void>
  rescanFolders: () => Promise<void>
  removeFolder: (folderPath: string) => Promise<void>
  clearFolders: () => void
  replaceSong: (song: Song) => void
}

const normalizeFolders = (folders: string[]) => (
  Array.from(new Set(
    folders
      .map((folder) => folder.trim())
      .filter(Boolean),
  ))
)

const sortFolders = (folders: string[]) => [...folders].sort((left, right) => left.localeCompare(right, 'zh-CN'))

export const useLocalMusicStore = create<LocalMusicStore>()(
  persist(
    (set, get) => {
      const scanFolders = async(folders: string[]) => {
        const nextFolders = sortFolders(normalizeFolders(folders))

        if (!nextFolders.length) {
          set({
            folders: [],
            songs: [],
            lastScannedAt: null,
            scanError: null,
            isScanning: false,
          })
          return
        }

        if (!window.electronAPI?.scanLocalMusicFolders) {
          const message = '当前环境不支持本地音乐扫描'
          set({ isScanning: false, scanError: message })
          useUIStore.getState().addToast({ type: 'error', message })
          return
        }

        set({ isScanning: true, scanError: null })

        try {
          const result = await window.electronAPI.scanLocalMusicFolders(nextFolders)
          set({
            folders: sortFolders(result.folders),
            songs: result.songs,
            lastScannedAt: result.scannedAt,
            scanError: null,
            isScanning: false,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : '扫描本地音乐失败'
          set({
            isScanning: false,
            scanError: message,
          })
          useUIStore.getState().addToast({ type: 'error', message })
        }
      }

      return {
        folders: [],
        songs: [],
        isScanning: false,
        lastScannedAt: null,
        scanError: null,
        tagPriority: 'embedded-first' as LocalMusicTagPriority,

        setTagPriority: (priority) => {
          set({ tagPriority: priority })
          window.electronAPI?.setLocalMusicTagPriority?.(priority)
        },

        pickFolders: async() => {
          if (!window.electronAPI?.pickLocalMusicFolders) {
            useUIStore.getState().addToast({ type: 'error', message: '当前环境不支持选择本地文件夹' })
            return
          }

          const pickedFolders = await window.electronAPI.pickLocalMusicFolders()
          if (!pickedFolders.length) return

          const nextFolders = normalizeFolders([...get().folders, ...pickedFolders])
          await scanFolders(nextFolders)
          useUIStore.getState().addToast({
            type: 'success',
            message: `已扫描 ${nextFolders.length} 个文件夹，共 ${useLocalMusicStore.getState().songs.length} 首歌曲`,
          })
        },

        rescanFolders: async() => {
          if (!get().folders.length) return
          await scanFolders(get().folders)
          const { songs } = useLocalMusicStore.getState()
          useUIStore.getState().addToast({
            type: 'success',
            message: `扫描完成，共发现 ${songs.length} 首本地歌曲`,
          })
        },

        removeFolder: async(folderPath) => {
          const nextFolders = get().folders.filter((folder) => folder !== folderPath)
          if (!nextFolders.length) {
            set({
              folders: [],
              songs: [],
              lastScannedAt: null,
              scanError: null,
              isScanning: false,
            })
            useUIStore.getState().addToast({ type: 'info', message: '已移除本地扫描目录' })
            return
          }

          await scanFolders(nextFolders)
          useUIStore.getState().addToast({ type: 'info', message: '已更新本地扫描目录' })
        },

        clearFolders: () => {
          set({
            folders: [],
            songs: [],
            isScanning: false,
            lastScannedAt: null,
            scanError: null,
          })
        },

        replaceSong: (song) => {
          if (song.platform !== 'local' || !song.localPath) return

          set((state) => {
            let changed = false
            const songs = state.songs.map((item) => {
              if (item.platform !== 'local' || item.localPath !== song.localPath) return item
              changed = true
              return {
                ...item,
                ...song,
                url: item.url || song.url,
              }
            })

            if (!changed) return state
            return { songs }
          })
        },
      }
    },
    {
      name: 'local-music-storage',
      storage: createJSONStorage(() => ({
        getItem: async(name) => {
          const value = await localMusicStorage.getItem<string>(name)
          return value ?? null
        },
        setItem: async(name, value) => {
          await localMusicStorage.setItem(name, value)
        },
        removeItem: async(name) => {
          await localMusicStorage.removeItem(name)
        },
      })),
      partialize: (state) => ({
        folders: state.folders,
        songs: state.songs,
        lastScannedAt: state.lastScannedAt,
        tagPriority: state.tagPriority,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.tagPriority) {
          window.electronAPI?.setLocalMusicTagPriority?.(state.tagPriority)
        }
      },
    },
  ),
)
