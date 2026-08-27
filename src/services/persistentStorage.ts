/**
 * Desktop-first persistent storage for Zustand `persist`.
 *
 * Electron: main-process docs under ~/.sollin/store/<name>.json via IPC
 * Web / fallback: localStorage (same key names as before)
 *
 * Also migrates legacy localStorage / localforage payloads into the main store once.
 */

import type { PersistStorage, StorageValue } from 'zustand/middleware'

type StoreSetResult = { ok: boolean; error?: string }

type ElectronStoreApi = {
  storeGet: (name: string) => Promise<unknown | null>
  storeGetSync?: (name: string) => unknown | null
  storeSet: (name: string, value: unknown) => Promise<StoreSetResult>
  storeSetSync?: (name: string, value: unknown) => StoreSetResult
  storeRemove: (name: string) => Promise<StoreSetResult>
  storeRemoveSync?: (name: string) => StoreSetResult
  storeFlush: () => Promise<{ ok: boolean }>
}

export type PersistDocName =
  | 'ui'
  | 'feature'
  | 'source-switch'
  | 'download'
  | 'auth'
  | 'player'
  | 'user'
  | 'local-music'
  | 'toggle-source'
  | 'webdav'
  | 'cache-settings'
  | 'audio-cache-settings'
  | 'misc'

/** Legacy localStorage keys → new doc names (one-time migration). */
export const LEGACY_LOCAL_STORAGE_KEYS: Record<string, string> = {
  ui: 'ui-storage',
  feature: 'Sollin-feature-settings',
  'source-switch': 'sollin.sourceSwitchSettings',
  download: 'download-storage',
  auth: 'sollin-auth',
  player: 'player-storage',
  user: 'Sollin-user-data',
  'local-music': 'local-music-storage',
  'toggle-source': 'sollin.toggleSource.v1',
  'cache-settings': 'sollin-cache-settings-v1',
  'audio-cache-settings': 'sollin-audio-cache-settings-v1',
}

const DEFAULT_DEBOUNCE_MS = 250
const PLAYER_DEBOUNCE_MS = 400

const memoryCache = new Map<string, StorageValue<unknown>>()
const pendingWrites = new Map<string, { value: StorageValue<unknown>; timer: ReturnType<typeof setTimeout> | null }>()
const migratedDocs = new Set<string>()
let flushListenersBound = false

function getElectronStoreApi(): ElectronStoreApi | null {
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api?.storeGet || !api?.storeSet || !api?.storeRemove) return null
  return api as ElectronStoreApi
}

function isElectronStoreAvailable(): boolean {
  return Boolean(getElectronStoreApi())
}

function parseLegacyLocalStorage(raw: string | null): StorageValue<unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    // Zustand persist v4 shape: { state, version }
    if (parsed && typeof parsed === 'object' && 'state' in parsed) {
      return parsed as StorageValue<unknown>
    }
    // Raw values (non-zustand helpers) — wrap as state
    return { state: parsed, version: 0 }
  } catch (error) {
    console.error('[persistentStorage] failed to parse legacy localStorage payload:', error)
    return null
  }
}

function normalizeStorageValue(value: unknown): StorageValue<unknown> | null {
  if (value == null) return null
  if (typeof value === 'object' && value !== null && 'state' in (value as object)) {
    return value as StorageValue<unknown>
  }
  // Main process may have stored raw state only — wrap it.
  return { state: value, version: 0 }
}

async function migrateLegacyIfNeeded(docName: string): Promise<StorageValue<unknown> | null> {
  if (migratedDocs.has(docName)) return null
  migratedDocs.add(docName)

  const api = getElectronStoreApi()
  if (!api) return null

  // Prefer localStorage legacy key
  const legacyKey = LEGACY_LOCAL_STORAGE_KEYS[docName]
  if (legacyKey && typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(legacyKey)
      const legacy = parseLegacyLocalStorage(raw)
      if (legacy) {
        const result = await api.storeSet(docName, legacy)
        if (result?.ok) {
          try {
            window.localStorage.removeItem(legacyKey)
          } catch {
            // ignore
          }
          console.log(`[persistentStorage] migrated localStorage "${legacyKey}" → store/${docName}.json`)
          return legacy
        }
        console.error(`[persistentStorage] migrate set failed for ${docName}:`, result?.error)
      }
    } catch (error) {
      console.error(`[persistentStorage] localStorage migration failed for ${docName}:`, error)
    }
  }

  // local-music historically used localforage / IndexedDB
  if (docName === 'local-music') {
    try {
      const localforage = (await import('localforage')).default
      const instance = localforage.createInstance({
        name: 'Sollin',
        storeName: 'Sollin_local_music_store',
        description: 'Sollin local music library',
      })
      const raw = await instance.getItem<string>('local-music-storage')
      if (raw) {
        const legacy = typeof raw === 'string' ? parseLegacyLocalStorage(raw) : normalizeStorageValue(raw)
        if (legacy) {
          const result = await api.storeSet(docName, legacy)
          if (result?.ok) {
            try {
              await instance.removeItem('local-music-storage')
            } catch {
              // ignore
            }
            console.log('[persistentStorage] migrated localforage local-music → store/local-music.json')
            return legacy
          }
        }
      }
    } catch (error) {
      console.error('[persistentStorage] localforage migration failed:', error)
    }
  }

  return null
}

function scheduleWrite(docName: string, value: StorageValue<unknown>, debounceMs: number) {
  memoryCache.set(docName, value)
  const existing = pendingWrites.get(docName)
  if (existing?.timer) clearTimeout(existing.timer)

  const timer = setTimeout(() => {
    void flushDoc(docName)
  }, debounceMs)

  pendingWrites.set(docName, { value, timer })
}

async function flushDoc(docName: string): Promise<void> {
  const pending = pendingWrites.get(docName)
  if (pending?.timer) clearTimeout(pending.timer)
  pendingWrites.delete(docName)

  const value = pending?.value ?? memoryCache.get(docName)
  if (value === undefined) return

  const api = getElectronStoreApi()
  if (!api) {
    // Web fallback already written synchronously in setItem
    return
  }

  try {
    const result = await api.storeSet(docName, value)
    if (!result?.ok) {
      console.error(`[persistentStorage] storeSet failed for ${docName}:`, result?.error)
    }
  } catch (error) {
    console.error(`[persistentStorage] storeSet threw for ${docName}:`, error)
  }
}

export async function flushAllPersistentStorage(): Promise<void> {
  const names = Array.from(new Set([
    ...pendingWrites.keys(),
    ...memoryCache.keys(),
  ]))
  await Promise.all(names.map((name) => flushDoc(name)))

  const api = getElectronStoreApi()
  if (api?.storeFlush) {
    try {
      await api.storeFlush()
    } catch (error) {
      console.error('[persistentStorage] storeFlush failed:', error)
    }
  }
}

function bindFlushListeners() {
  if (flushListenersBound || typeof window === 'undefined') return
  flushListenersBound = true

  const flush = () => {
    void flushAllPersistentStorage()
  }

  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

export type CreatePersistStorageOptions = {
  /** Debounce writes (ms). Defaults: player 400, others 250. */
  debounceMs?: number
  /** Extra legacy key to try during migration. */
  legacyKey?: string
}

/**
 * Create a Zustand PersistStorage backed by ~/.sollin (Electron) or localStorage (web).
 * `name` passed to persist() should match `docName`.
 */
export function createAppPersistStorage<S>(
  docName: PersistDocName | string,
  options?: CreatePersistStorageOptions,
): PersistStorage<S> {
  bindFlushListeners()

  if (options?.legacyKey) {
    LEGACY_LOCAL_STORAGE_KEYS[docName] = options.legacyKey
  }

  const debounceMs = options?.debounceMs
    ?? (docName === 'player' ? PLAYER_DEBOUNCE_MS : DEFAULT_DEBOUNCE_MS)

  const useElectron = isElectronStoreAvailable()

  return {
    getItem: async (name): Promise<StorageValue<S> | null> => {
      // Zustand always passes the persist `name` option; prefer docName for disk file.
      const key = docName || name

      if (memoryCache.has(key)) {
        return memoryCache.get(key) as StorageValue<S>
      }

      if (useElectron) {
        const api = getElectronStoreApi()!
        try {
          let value = normalizeStorageValue(await api.storeGet(key))
          if (!value) {
            value = await migrateLegacyIfNeeded(key)
          }
          if (value) {
            memoryCache.set(key, value)
            return value as StorageValue<S>
          }
          return null
        } catch (error) {
          console.error(`[persistentStorage] getItem failed for ${key}:`, error)
          return null
        }
      }

      // Web / no IPC — also try legacy key once and rewrite under the new name
      try {
        let raw = window.localStorage?.getItem(name) ?? null
        if (!raw) {
          const legacyKey = LEGACY_LOCAL_STORAGE_KEYS[key]
          if (legacyKey) {
            raw = window.localStorage?.getItem(legacyKey) ?? null
            if (raw) {
              try {
                window.localStorage?.setItem(name, raw)
                window.localStorage?.removeItem(legacyKey)
              } catch {
                // keep reading legacy payload even if rewrite fails
              }
            }
          }
        }
        const parsed = parseLegacyLocalStorage(raw)
        return parsed as StorageValue<S> | null
      } catch (error) {
        console.error(`[persistentStorage] localStorage getItem failed for ${name}:`, error)
        return null
      }
    },

    setItem: (name, value): void => {
      const key = docName || name
      const storageValue = value as StorageValue<unknown>
      memoryCache.set(key, storageValue)

      if (useElectron) {
        scheduleWrite(key, storageValue, debounceMs)
        return
      }

      try {
        window.localStorage?.setItem(name, JSON.stringify(storageValue))
      } catch (error) {
        console.error(`[persistentStorage] localStorage setItem failed for ${name}:`, error)
      }
    },

    removeItem: async (name): Promise<void> => {
      const key = docName || name
      memoryCache.delete(key)
      const pending = pendingWrites.get(key)
      if (pending?.timer) clearTimeout(pending.timer)
      pendingWrites.delete(key)

      if (useElectron) {
        try {
          await getElectronStoreApi()!.storeRemove(key)
        } catch (error) {
          console.error(`[persistentStorage] removeItem failed for ${key}:`, error)
        }
        return
      }

      try {
        window.localStorage?.removeItem(name)
      } catch (error) {
        console.error(`[persistentStorage] localStorage removeItem failed for ${name}:`, error)
      }
    },
  }
}

/** Simple JSON helpers for non-zustand modules (toggle registry, webdav, etc.). */
export async function readAppDoc<T>(docName: string): Promise<T | null> {
  const api = getElectronStoreApi()
  if (api) {
    try {
      const value = await api.storeGet(docName)
      if (value != null) {
        // Unwrap zustand envelope if present
        if (typeof value === 'object' && value !== null && 'state' in value) {
          return (value as StorageValue<T>).state
        }
        return value as T
      }
      const migrated = await migrateLegacyIfNeeded(docName)
      if (migrated) {
        if (typeof migrated === 'object' && migrated !== null && 'state' in migrated) {
          return (migrated as StorageValue<T>).state
        }
        return migrated as unknown as T
      }
      return null
    } catch (error) {
      console.error(`[persistentStorage] readAppDoc failed for ${docName}:`, error)
      return null
    }
  }

  const legacyKey = LEGACY_LOCAL_STORAGE_KEYS[docName] || docName
  try {
    const raw = window.localStorage?.getItem(legacyKey) ?? null
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'state' in parsed) return parsed.state as T
    return parsed as T
  } catch {
    return null
  }
}

export async function writeAppDoc(docName: string, value: unknown): Promise<boolean> {
  const api = getElectronStoreApi()
  if (api) {
    try {
      const result = await api.storeSet(docName, value)
      if (!result?.ok) {
        console.error(`[persistentStorage] writeAppDoc failed for ${docName}:`, result?.error)
        return false
      }
      return true
    } catch (error) {
      console.error(`[persistentStorage] writeAppDoc threw for ${docName}:`, error)
      return false
    }
  }

  const legacyKey = LEGACY_LOCAL_STORAGE_KEYS[docName] || docName
  try {
    window.localStorage?.setItem(legacyKey, JSON.stringify(value))
    return true
  } catch (error) {
    console.error(`[persistentStorage] writeAppDoc localStorage failed for ${docName}:`, error)
    return false
  }
}

export function readAppDocSync<T>(docName: string, fallback: T): T {
  const api = getElectronStoreApi()
  try {
    const value = api?.storeGetSync ? api.storeGetSync(docName) : window.localStorage?.getItem(docName)
    if (value == null) return fallback
    if (typeof value === 'string') return JSON.parse(value) as T
    if (typeof value === 'object' && value !== null && 'state' in value) return (value as StorageValue<T>).state as T
    return value as T
  } catch {
    return fallback
  }
}

export function writeAppDocSync(docName: string, value: unknown): boolean {
  const api = getElectronStoreApi()
  try {
    if (api?.storeSetSync) return api.storeSetSync(docName, value).ok
    window.localStorage?.setItem(docName, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
