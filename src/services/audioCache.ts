/**
 * Audio Cache Service
 * Caches played audio files using IndexedDB for offline playback
 */

const DB_NAME = 'sollin-audio-cache'
const DB_VERSION = 1
const STORE_NAME = 'audio-files'
const META_STORE_NAME = 'cache-meta'
const AUDIO_CACHE_SETTINGS_KEY = 'sollin-audio-cache-settings-v1'

export interface AudioCacheSettings {
  enabled: boolean
  maxSizeMB: number
}

const DEFAULT_AUDIO_CACHE_SETTINGS: AudioCacheSettings = {
  enabled: true,
  maxSizeMB: 512,
}

interface CacheEntry {
  id: string // platform-songId
  platform: string
  songId: string
  songName: string
  artist: string
  blob: Blob
  size: number
  cachedAt: number
}

interface CacheMeta {
  id: string
  platform: string
  songId: string
  songName: string
  artist: string
  size: number
  cachedAt: number
}

class AudioCacheService {
  private db: IDBDatabase | null = null
  private dbReady: Promise<void>
  private settings: AudioCacheSettings = this.loadSettings()

  constructor() {
    this.dbReady = this.initDB()
  }

  private loadSettings(): AudioCacheSettings {
    try {
      const raw = localStorage.getItem(AUDIO_CACHE_SETTINGS_KEY)
      if (!raw) return { ...DEFAULT_AUDIO_CACHE_SETTINGS }
      const parsed = JSON.parse(raw) as Partial<AudioCacheSettings>
      return {
        enabled: parsed.enabled !== false,
        maxSizeMB: Number.isFinite(parsed.maxSizeMB) && Number(parsed.maxSizeMB) > 0
          ? Number(parsed.maxSizeMB)
          : DEFAULT_AUDIO_CACHE_SETTINGS.maxSizeMB,
      }
    } catch {
      return { ...DEFAULT_AUDIO_CACHE_SETTINGS }
    }
  }

  private persistSettings() {
    try {
      localStorage.setItem(AUDIO_CACHE_SETTINGS_KEY, JSON.stringify(this.settings))
    } catch {
      // ignore
    }
  }

  getSettings(): AudioCacheSettings {
    return { ...this.settings }
  }

  async updateSettings(next: Partial<AudioCacheSettings>): Promise<AudioCacheSettings> {
    this.settings = {
      enabled: typeof next.enabled === 'boolean' ? next.enabled : this.settings.enabled,
      maxSizeMB: Number.isFinite(next.maxSizeMB) && Number(next.maxSizeMB) > 0
        ? Number(next.maxSizeMB)
        : this.settings.maxSizeMB,
    }
    this.persistSettings()
    if (!this.settings.enabled) {
      await this.clearAll()
    } else {
      await this.enforceLimits()
    }
    return this.getSettings()
  }

  isEnabled(): boolean {
    return this.settings.enabled
  }

  private async initDB(): Promise<void> {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error('Failed to open audio cache database')
        this.db = null
        this.settings.enabled = false
        this.persistSettings()
        resolve()
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Store for audio blobs
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('platform', 'platform', { unique: false })
          store.createIndex('cachedAt', 'cachedAt', { unique: false })
        }

        // Store for metadata (for listing without loading blobs)
        if (!db.objectStoreNames.contains(META_STORE_NAME)) {
          const metaStore = db.createObjectStore(META_STORE_NAME, { keyPath: 'id' })
          metaStore.createIndex('platform', 'platform', { unique: false })
          metaStore.createIndex('cachedAt', 'cachedAt', { unique: false })
        }
      }
    })
  }

  private getCacheKey(platform: string, songId: string): string {
    return `${platform}-${songId}`
  }

  /**
   * Check if a song is cached
   */
  async has(platform: string, songId: string): Promise<boolean> {
    if (!this.settings.enabled) return false
    await this.dbReady
    if (!this.db) return false

    const key = this.getCacheKey(platform, songId)

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([META_STORE_NAME], 'readonly')
      const store = transaction.objectStore(META_STORE_NAME)
      const request = store.get(key)

      request.onsuccess = () => {
        resolve(!!request.result)
      }

      request.onerror = () => {
        resolve(false)
      }
    })
  }

  /**
   * Get cached audio as blob URL
   */
  async get(platform: string, songId: string): Promise<string | null> {
    if (!this.settings.enabled) return null
    await this.dbReady
    if (!this.db) return null

    const key = this.getCacheKey(platform, songId)

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(key)

      request.onsuccess = () => {
        const entry = request.result as CacheEntry | undefined
        if (entry?.blob) {
          const url = URL.createObjectURL(entry.blob)
          resolve(url)
        } else {
          resolve(null)
        }
      }

      request.onerror = () => {
        resolve(null)
      }
    })
  }

  /**
   * Cache audio from URL
   */
  async cache(
    platform: string,
    songId: string,
    songName: string,
    artist: string,
    audioUrl: string
  ): Promise<boolean> {
    if (!this.settings.enabled) return false
    await this.dbReady
    if (!this.db) return false

    try {
      // Fetch the audio file
      const response = await fetch(audioUrl)
      if (!response.ok) return false

      const blob = await response.blob()
      const key = this.getCacheKey(platform, songId)
      const now = Date.now()

      const entry: CacheEntry = {
        id: key,
        platform,
        songId,
        songName,
        artist,
        blob,
        size: blob.size,
        cachedAt: now,
      }

      const meta: CacheMeta = {
        id: key,
        platform,
        songId,
        songName,
        artist,
        size: blob.size,
        cachedAt: now,
      }

      return new Promise((resolve) => {
        const transaction = this.db!.transaction([STORE_NAME, META_STORE_NAME], 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const metaStore = transaction.objectStore(META_STORE_NAME)

        store.put(entry)
        metaStore.put(meta)

        transaction.oncomplete = () => {
          console.log(`Cached audio: ${songName} - ${artist}`)
          void this.enforceLimits().finally(() => resolve(true))
        }

        transaction.onerror = () => {
          console.error('Failed to cache audio')
          resolve(false)
        }
      })
    } catch (error) {
      console.error('Error caching audio:', error)
      return false
    }
  }

  /**
   * Remove a cached song
   */
  async remove(platform: string, songId: string): Promise<boolean> {
    await this.dbReady
    if (!this.db) return false

    const key = this.getCacheKey(platform, songId)

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME, META_STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const metaStore = transaction.objectStore(META_STORE_NAME)

      store.delete(key)
      metaStore.delete(key)

      transaction.oncomplete = () => {
        resolve(true)
      }

      transaction.onerror = () => {
        resolve(false)
      }
    })
  }

  /**
   * Clear all cached audio
   */
  async clearAll(): Promise<boolean> {
    await this.dbReady
    if (!this.db) return false

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME, META_STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const metaStore = transaction.objectStore(META_STORE_NAME)

      store.clear()
      metaStore.clear()

      transaction.oncomplete = () => {
        console.log('Audio cache cleared')
        resolve(true)
      }

      transaction.onerror = () => {
        resolve(false)
      }
    })
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ count: number; totalSize: number; items: CacheMeta[] }> {
    await this.dbReady
    if (!this.db) return { count: 0, totalSize: 0, items: [] }

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([META_STORE_NAME], 'readonly')
      const store = transaction.objectStore(META_STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        const items = request.result as CacheMeta[]
        const totalSize = items.reduce((sum, item) => sum + item.size, 0)
        resolve({
          count: items.length,
          totalSize,
          items: items.sort((a, b) => b.cachedAt - a.cachedAt),
        })
      }

      request.onerror = () => {
        resolve({ count: 0, totalSize: 0, items: [] })
      }
    })
  }

  /**
   * Format bytes to human readable string
   */
  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  async enforceLimits(): Promise<void> {
    if (!this.settings.enabled) {
      await this.clearAll()
      return
    }

    const stats = await this.getStats()
    const maxBytes = this.settings.maxSizeMB * 1024 * 1024
    if (stats.totalSize <= maxBytes) return

    const items = [...stats.items].sort((a, b) => a.cachedAt - b.cachedAt)
    let currentSize = stats.totalSize

    for (const item of items) {
      await this.remove(item.platform, item.songId)
      currentSize -= item.size
      if (currentSize <= maxBytes) break
    }
  }
}

export const audioCache = new AudioCacheService()
export default audioCache
