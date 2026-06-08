import type { BackupOnlinePlaylist, BackupSongRef } from '@/types/backup'

const STORAGE_KEYS = {
  onlineFavorites: 'sollin-backup-bridge-online-favorites-v1',
  onlinePlaylists: 'sollin-backup-bridge-online-playlists-v1',
} as const

const canUseStorage = () => typeof window !== 'undefined' && !!window.localStorage

const readJson = <T>(key: string, fallback: T): T => {
  if (!canUseStorage()) return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const writeJson = (key: string, value: unknown) => {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota / serialization errors
  }
}

export const backupBridge = {
  getOnlineFavorites(): BackupSongRef[] {
    const value = readJson<unknown[]>(STORAGE_KEYS.onlineFavorites, [])
    return Array.isArray(value) ? value as BackupSongRef[] : []
  },

  setOnlineFavorites(items: BackupSongRef[]) {
    writeJson(STORAGE_KEYS.onlineFavorites, items)
  },

  getOnlinePlaylists(): BackupOnlinePlaylist[] {
    const value = readJson<unknown[]>(STORAGE_KEYS.onlinePlaylists, [])
    return Array.isArray(value) ? value as BackupOnlinePlaylist[] : []
  },

  setOnlinePlaylists(items: BackupOnlinePlaylist[]) {
    writeJson(STORAGE_KEYS.onlinePlaylists, items)
  },

  clear() {
    if (!canUseStorage()) return
    try {
      window.localStorage.removeItem(STORAGE_KEYS.onlineFavorites)
      window.localStorage.removeItem(STORAGE_KEYS.onlinePlaylists)
    } catch {
      // ignore storage cleanup errors
    }
  },
}

export default backupBridge
