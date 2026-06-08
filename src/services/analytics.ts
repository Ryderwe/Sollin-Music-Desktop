/**
 * 使用统计服务 - 本地收集使用数据
 */

import { APP_VERSION } from '@/config'

const STORAGE_KEY = 'sollin-analytics'

interface AnalyticsData {
  // 设备信息
  deviceId: string
  platform: string
  version: string
  
  // 使用统计
  totalLaunches: number      // 总启动次数
  totalPlayTime: number      // 总播放时间（秒）
  totalUsageTime: number     // 总使用时间（秒）
  songsPlayed: number        // 播放歌曲数
  searchCount: number        // 搜索次数
  
  // 当前会话
  sessionStart: number       // 当前会话开始时间
  lastActive: number         // 最后活跃时间
  
  // 功能使用
  featuresUsed: {
    lyrics: number           // 歌词功能使用次数
    favorites: number        // 收藏功能使用次数
    playlists: number        // 歌单功能使用次数
    download: number         // 下载功能使用次数
  }
}

class AnalyticsService {
  private data: AnalyticsData
  private syncInterval: number | null = null
  private usageTimer: number | null = null

  constructor() {
    this.data = this.loadData()
  }

  /**
   * 生成或获取设备ID
   */
  private generateDeviceId(): string {
    let deviceId = localStorage.getItem('sollin-device-id')
    if (!deviceId) {
      deviceId = 'device_' + Math.random().toString(36).substring(2, 15) + 
                 Math.random().toString(36).substring(2, 15)
      localStorage.setItem('sollin-device-id', deviceId)
    }
    return deviceId
  }

  /**
   * 加载本地存储的数据
   */
  private loadData(): AnalyticsData {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        // 更新版本号为当前版本
        data.version = APP_VERSION
        return data
      }
    } catch (e) {
      console.error('Failed to load analytics data:', e)
    }

    // 默认数据
    return {
      deviceId: this.generateDeviceId(),
      platform: this.getPlatform(),
      version: APP_VERSION,
      totalLaunches: 0,
      totalPlayTime: 0,
      totalUsageTime: 0,
      songsPlayed: 0,
      searchCount: 0,
      sessionStart: Date.now(),
      lastActive: Date.now(),
      featuresUsed: {
        lyrics: 0,
        favorites: 0,
        playlists: 0,
        download: 0,
      },
    }
  }

  /**
   * 保存数据到本地
   */
  private saveData(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data))
    } catch (e) {
      console.error('Failed to save analytics data:', e)
    }
  }

  /**
   * 获取平台信息
   */
  private getPlatform(): string {
    const userAgent = navigator.userAgent.toLowerCase()
    if (userAgent.includes('electron')) {
      if (userAgent.includes('win')) return 'windows'
      if (userAgent.includes('mac')) return 'macos'
      if (userAgent.includes('linux')) return 'linux'
      return 'electron'
    }
    return 'web'
  }

  /**
   * 启动统计服务
   */
  start(): void {
    // 记录启动
    this.data.totalLaunches++
    this.data.sessionStart = Date.now()
    this.data.lastActive = Date.now()
    this.saveData()

    // 发送启动事件
    this.sendEvent('app_launch', {
      launches: this.data.totalLaunches,
    })

    // 每分钟更新使用时间
    this.usageTimer = window.setInterval(() => {
      this.data.totalUsageTime += 60
      this.data.lastActive = Date.now()
      this.saveData()
    }, 60000)

    // 定期刷新本地统计状态
    this.syncInterval = window.setInterval(() => {
      this.syncToServer()
    }, 5 * 60 * 1000)

    // 页面关闭前保存数据
    window.addEventListener('beforeunload', () => {
      this.stop()
    })
  }

  /**
   * 停止统计服务
   */
  stop(): void {
    if (this.usageTimer) {
      clearInterval(this.usageTimer)
      this.usageTimer = null
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }

    // 计算本次会话时长
    const sessionDuration = Math.floor((Date.now() - this.data.sessionStart) / 1000)
    this.data.totalUsageTime += sessionDuration % 60 // 补上不足一分钟的部分

    this.saveData()
    this.syncToServer()
  }

  /**
   * 记录歌曲播放
   */
  trackSongPlay(songId: string, platform: string): void {
    this.data.songsPlayed++
    this.data.lastActive = Date.now()
    this.saveData()

    this.sendEvent('song_play', { songId, platform })
  }

  /**
   * 记录播放时间
   */
  trackPlayTime(seconds: number): void {
    this.data.totalPlayTime += seconds
    this.saveData()
  }

  /**
   * 记录搜索
   */
  trackSearch(keyword: string): void {
    this.data.searchCount++
    this.data.lastActive = Date.now()
    this.saveData()

    this.sendEvent('search', { keyword: keyword.substring(0, 50) })
  }

  /**
   * 记录功能使用
   */
  trackFeature(feature: keyof AnalyticsData['featuresUsed']): void {
    this.data.featuresUsed[feature]++
    this.data.lastActive = Date.now()
    this.saveData()
  }

  /**
   * 发送事件（开源版仅本地记录）
   */
  private sendEvent(_event: string, _data?: Record<string, any>): void {
    // reserved for local-only usage
  }

  /**
   * 同步全部数据（开源版不上传）
   */
  private syncToServer(): void {
    // local-only
  }

  /**
   * 获取统计数据（用于设置页面显示）
   */
  getStats(): {
    totalLaunches: number
    totalUsageTime: string
    totalPlayTime: string
    songsPlayed: number
    searchCount: number
  } {
    const formatTime = (seconds: number): string => {
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      if (hours > 0) {
        return `${hours}小时${minutes}分钟`
      }
      return `${minutes}分钟`
    }

    return {
      totalLaunches: this.data.totalLaunches,
      totalUsageTime: formatTime(this.data.totalUsageTime),
      totalPlayTime: formatTime(this.data.totalPlayTime),
      songsPlayed: this.data.songsPlayed,
      searchCount: this.data.searchCount,
    }
  }
}

export const analytics = new AnalyticsService()
export default analytics
