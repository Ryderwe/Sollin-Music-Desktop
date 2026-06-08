/**
 * 缓存服务 - 用于缓存 API 数据减少加载时间
 */

interface CacheItem<T> {
  data: T
  timestamp: number
  expiry: number // 过期时间（毫秒）
}

export interface DataCacheSettings {
  enabled: boolean
  maxSizeMB: number
}

const CACHE_PREFIX = 'sollin-cache-'
const CACHE_SETTINGS_KEY = 'sollin-cache-settings-v1'
const DEFAULT_DATA_CACHE_SETTINGS: DataCacheSettings = {
  enabled: true,
  maxSizeMB: 32,
}

// 默认过期时间
const DEFAULT_EXPIRY = {
  toplists: 2 * 60 * 60 * 1000,         // 排行榜列表: 2小时
  toplistsV2: 2 * 60 * 60 * 1000,       // 排行榜列表 v2: 2小时
  toplistSongs: 2 * 60 * 60 * 1000,     // 排行榜歌曲: 2小时
  toplistSongsV2: 2 * 60 * 60 * 1000,   // 排行榜歌曲 v2: 2小时
  recommendPlaylists: 2 * 60 * 60 * 1000, // 推荐歌单: 2小时
  playlistTags: 24 * 60 * 60 * 1000,    // 歌单分类: 24小时
  playlistDetail: 2 * 60 * 60 * 1000,   // 歌单详情: 2小时
  albumDetail: 2 * 60 * 60 * 1000,      // 专辑详情: 2小时
  search: 5 * 60 * 1000,                // 搜索结果: 5分钟
  songUrl: 60 * 60 * 1000,              // 歌曲URL: 1小时
  lyrics: 24 * 60 * 60 * 1000,          // 歌词: 24小时
  lyricData: 24 * 60 * 60 * 1000,       // 多通道歌词: 24小时
  songComments: 10 * 60 * 1000,         // 歌曲评论: 10分钟
  songHotComments: 10 * 60 * 1000,      // 热门评论: 10分钟
}

class CacheService {
  private memoryCache: Map<string, CacheItem<any>> = new Map()
  private settings: DataCacheSettings = this.loadSettings()

  private loadSettings(): DataCacheSettings {
    try {
      const raw = localStorage.getItem(CACHE_SETTINGS_KEY)
      if (!raw) return { ...DEFAULT_DATA_CACHE_SETTINGS }
      const parsed = JSON.parse(raw) as Partial<DataCacheSettings>
      return {
        enabled: parsed.enabled !== false,
        maxSizeMB: Number.isFinite(parsed.maxSizeMB) && Number(parsed.maxSizeMB) > 0
          ? Number(parsed.maxSizeMB)
          : DEFAULT_DATA_CACHE_SETTINGS.maxSizeMB,
      }
    } catch {
      return { ...DEFAULT_DATA_CACHE_SETTINGS }
    }
  }

  private persistSettings(): void {
    try {
      localStorage.setItem(CACHE_SETTINGS_KEY, JSON.stringify(this.settings))
    } catch {
      // ignore persistence failure
    }
  }

  getSettings(): DataCacheSettings {
    return { ...this.settings }
  }

  updateSettings(next: Partial<DataCacheSettings>): DataCacheSettings {
    this.settings = {
      enabled: typeof next.enabled === 'boolean' ? next.enabled : this.settings.enabled,
      maxSizeMB: Number.isFinite(next.maxSizeMB) && Number(next.maxSizeMB) > 0
        ? Number(next.maxSizeMB)
        : this.settings.maxSizeMB,
    }
    this.persistSettings()
    if (!this.settings.enabled) {
      this.clearAll()
    } else {
      this.enforceLimits()
    }
    return this.getSettings()
  }

  isEnabled(): boolean {
    return this.settings.enabled
  }

  /**
   * 生成缓存键
   */
  private getKey(type: string, ...args: (string | number)[]): string {
    return `${CACHE_PREFIX}${type}-${args.join('-')}`
  }

  /**
   * 从缓存获取数据
   */
  get<T>(type: string, ...args: (string | number)[]): T | null {
    if (!this.settings.enabled) return null
    const key = this.getKey(type, ...args)
    
    // 先检查内存缓存
    const memoryItem = this.memoryCache.get(key)
    if (memoryItem && Date.now() < memoryItem.timestamp + memoryItem.expiry) {
      return memoryItem.data as T
    }
    
    // 再检查 localStorage
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        const item: CacheItem<T> = JSON.parse(stored)
        if (Date.now() < item.timestamp + item.expiry) {
          // 更新内存缓存
          this.memoryCache.set(key, item)
          return item.data
        } else {
          // 过期了，删除
          localStorage.removeItem(key)
        }
      }
    } catch (e) {
      console.error('Cache read error:', e)
    }
    
    return null
  }

  /**
   * 设置缓存
   */
  set<T>(type: string, data: T, expiry?: number, ...args: (string | number)[]): void {
    if (!this.settings.enabled) return
    const key = this.getKey(type, ...args)
    const defaultExpiry = DEFAULT_EXPIRY[type as keyof typeof DEFAULT_EXPIRY] || 5 * 60 * 1000
    
    const item: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      expiry: expiry || defaultExpiry,
    }
    
    // 更新内存缓存
    this.memoryCache.set(key, item)
    
    // 更新 localStorage
    try {
      localStorage.setItem(key, JSON.stringify(item))
      this.enforceLimits()
    } catch (e) {
      console.error('Cache write error:', e)
      // 如果 localStorage 满了，清理旧缓存
      this.cleanup()
    }
  }

  /**
   * 删除特定缓存
   */
  remove(type: string, ...args: (string | number)[]): void {
    const key = this.getKey(type, ...args)
    this.memoryCache.delete(key)
    localStorage.removeItem(key)
  }

  /**
   * 清理过期缓存
   */
  cleanup(): void {
    const now = Date.now()
    
    // 清理内存缓存
    for (const [key, item] of this.memoryCache.entries()) {
      if (now >= item.timestamp + item.expiry) {
        this.memoryCache.delete(key)
      }
    }
    
    // 清理 localStorage
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX)) {
        try {
          const stored = localStorage.getItem(key)
          if (stored) {
            const item: CacheItem<any> = JSON.parse(stored)
            if (now >= item.timestamp + item.expiry) {
              keysToRemove.push(key)
            }
          }
        } catch {
          keysToRemove.push(key)
        }
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key))
  }

  private getCacheEntries(): Array<{ key: string; size: number; timestamp: number }> {
    const entries: Array<{ key: string; size: number; timestamp: number }> = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(CACHE_PREFIX)) continue
      const value = localStorage.getItem(key)
      if (!value) continue
      try {
        const item: CacheItem<any> = JSON.parse(value)
        entries.push({
          key,
          size: key.length + value.length,
          timestamp: item.timestamp || 0,
        })
      } catch {
        entries.push({
          key,
          size: key.length + value.length,
          timestamp: 0,
        })
      }
    }
    return entries
  }

  enforceLimits(): void {
    if (!this.settings.enabled) {
      this.clearAll()
      return
    }

    this.cleanup()
    const maxBytes = this.settings.maxSizeMB * 1024 * 1024
    let entries = this.getCacheEntries()
    let totalSize = entries.reduce((sum, item) => sum + item.size, 0)
    if (totalSize <= maxBytes) return

    entries = entries.sort((left, right) => left.timestamp - right.timestamp)
    for (const entry of entries) {
      localStorage.removeItem(entry.key)
      this.memoryCache.delete(entry.key)
      totalSize -= entry.size
      if (totalSize <= maxBytes) break
    }
  }

  /**
   * 清除所有缓存
   */
  clearAll(): void {
    this.memoryCache.clear()
    
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key))
  }

  /**
   * 获取缓存大小（大约）
   */
  getCacheSize(): string {
    return this.formatSize(this.getCacheSizeBytes())
  }

  getCacheSizeBytes(): number {
    return this.getCacheEntries().reduce((sum, item) => sum + item.size, 0)
  }

  formatSize(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }
}

export const cache = new CacheService()
export default cache
