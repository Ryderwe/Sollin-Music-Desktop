import type {
  Song,
  PlaylistSummary,
  Album,
  Platform,
  AudioQuality,
  SearchResult,
  AggregateSearchResult,
  Toplist,
  PaginatedSongsResult,
  RecommendPlaylist,
  RecommendPlaylistPage,
  PlaylistSortOption,
  PlaylistTagInfo,
  PlaylistDetail,
  AlbumDetail,
  LyricData,
  SongCommentPage,
} from '@/types'
import { cache } from './cache'
import officialMusic from './officialMusic'
import officialSearch from './officialSearchApi'
import officialLyricApi from './officialLyricApi'
import officialCommentApi from './officialCommentApi'
import { songRegistry } from './songRegistry'
import { getQualityFallbackChain } from '@/constants/audio'
import { lxSourceApi } from './lxSource'
import { toggleSourceRegistry } from './toggleSourceRegistry'
import { findAlternativeSongs } from './findMusic'
import {
  getEnabledPlatformOrder,
  getEnabledScriptOrder,
  getEnabledStagesInOrder,
  isStageEnabled,
  useSourceSwitchSettingsStore,
} from '@/stores/sourceSwitchSettingsStore'

const TOPLISTS_CACHE_KEY = 'toplistsV2'
const TOPLIST_SONGS_CACHE_KEY = 'toplistSongsV2'
const RECOMMEND_PLAYLISTS_CACHE_KEY = 'recommendPlaylists'
const PLAYLIST_TAGS_CACHE_KEY = 'playlistTags'
const LYRIC_DATA_CACHE_VERSION = 'lx-lyric-v3'
const TOPLIST_SONGS_PAGE_CACHE_KEY = 'toplistSongsPage'
const PLAYLIST_DETAIL_PAGE_CACHE_KEY = 'playlistDetailPage'

type SongUrlError = {
  code: number
  message: string
  type?: string
}

type SongUrlResult = {
  url: string
  quality: AudioQuality
  sourceSwitch?: string
  toggleSong?: Song
  toggleAlternatives?: Song[]
  error?: SongUrlError
}

// Rate-limit recovery windows mirror lx-music-desktop's delayRetry (2-6s random backoff).
const TOO_MANY_REQUESTS_PATTERNS = [
  /too\s?many\s?requests/i,
  /服务器繁忙/,
  /request\s?limit/i,
  /\b429\b/,
]

const isTooManyRequestsError = (error: unknown): boolean => {
  if (!error) return false
  const message = error instanceof Error ? error.message : String(error)
  return TOO_MANY_REQUESTS_PATTERNS.some((pattern) => pattern.test(message))
}

const pickRandomDelayMs = (minSeconds: number, maxSeconds: number): number => {
  const span = Math.max(0, maxSeconds - minSeconds)
  return (minSeconds + Math.random() * span) * 1000
}

const hasInvalidToplistCache = (toplists: Toplist[]): boolean => toplists.some((item) => !item.cover)

const hasInvalidKugouSongCoverCache = (platform: Platform, songs: Song[]): boolean => (
  platform === 'kugou' && songs.some((song) => song.albumId && !song.cover)
)

const hasInvalidPlaylistDetailCache = (platform: Platform, detail: PlaylistDetail): boolean => (
  (!detail.cover && detail.songs.some((song) => song.cover))
  || hasInvalidKugouSongCoverCache(platform, detail.songs)
)

class SollinAPI {
  private songUrlRequests = new Map<string, Promise<SongUrlResult | null>>()
  private songUrlCooldownUntil = 0

  getCachedToplists(platform: Platform): Toplist[] | null {
    const cached = cache.get<Toplist[]>(TOPLISTS_CACHE_KEY, platform)
    if (!cached) return null
    if (hasInvalidToplistCache(cached)) {
      cache.remove(TOPLISTS_CACHE_KEY, platform)
      return null
    }
    return cached
  }

  getCachedToplist(platform: Platform, id: string): Song[] | null {
    const cached = cache.get<Song[]>(TOPLIST_SONGS_CACHE_KEY, platform, id)
    if (!cached) return null
    if (hasInvalidKugouSongCoverCache(platform, cached)) {
      cache.remove(TOPLIST_SONGS_CACHE_KEY, platform, id)
      return null
    }
    return cached
  }

  private async tryGetLxSongUrl(song: Song, qualities: AudioQuality[], sourceId?: string | null) {
    for (const candidateQuality of qualities) {
      try {
        const result = await lxSourceApi.getSongUrl(song, candidateQuality, { sourceId })
        if (result?.url) return result
      } catch (error) {
        if (isTooManyRequestsError(error)) {
          // Surface rate-limit errors so the caller can back off instead of blindly retrying with
          // a different quality, mirroring lx-music-desktop's delayRetry flow.
          throw error
        }
        console.warn('Try LX song url failed:', {
          sourceId: sourceId || 'active',
          quality: candidateQuality,
          error,
        })
      }
    }

    return null
  }

  private async resolveSongUrlWithFallbacks(
    song: Song,
    quality: AudioQuality,
    allowTempSourceFallback: boolean,
    internal: {
      retriedPlatforms?: Set<Platform>
      retriedToggleKey?: string | null
      failedSongKeys?: Set<string>
    } = {},
  ): Promise<SongUrlResult> {
    const qualityChain = getQualityFallbackChain(quality)
    const retriedPlatforms = internal.retriedPlatforms ?? new Set<Platform>()
    retriedPlatforms.add(song.platform as Platform)

    const failedSongKeys = internal.failedSongKeys ?? new Set<string>()
    // Seed retried platforms from failed keys so findMusic never revisits a source we already
    // know cannot play this song during the current recovery window.
    for (const key of failedSongKeys) {
      const failedPlatform = key.split(':')[0]
      if (failedPlatform) retriedPlatforms.add(failedPlatform as Platform)
    }
    const originKey = `${song.platform}:${song.id}`
    const originKnownBad = failedSongKeys.has(originKey)

    // The user-configurable pipeline decides (1) which fallback stages run at all and (2) their
    // order.  We still short-circuit on success and bail early on rate-limit errors.
    const stageOrder = allowTempSourceFallback ? getEnabledStagesInOrder() : ['origin']
    const stagesPlan: string[] = stageOrder.length > 0 ? stageOrder : ['origin']
    // Sticky toggle runs implicitly before findMusic whenever both the user wants cross-platform
    // fallback and we have something remembered, mirroring the previous behavior.
    const stickyEnabled = allowTempSourceFallback
      && isStageEnabled('findMusic')
      && useSourceSwitchSettingsStore.getState().rememberToggleChoices

    let originError: unknown = null

    for (const stageId of stagesPlan) {
      if (stageId === 'origin') {
        if (originKnownBad) continue
        try {
          const primaryResult = await this.tryGetLxSongUrl(song, qualityChain)
          if (primaryResult?.url) {
            return {
              url: primaryResult.url,
              quality: primaryResult.quality,
            }
          }
        } catch (error) {
          originError = error
          if (isTooManyRequestsError(error)) {
            return this.buildRateLimitResult(quality)
          }
        }
        continue
      }

      if (stageId === 'findMusic') {
        // Sticky toggle lives inside the findMusic stage conceptually: it is the cached result
        // of a previous findMusic round.  Respect the user's remember-choices preference.
        if (stickyEnabled) {
          const stickyToggle = toggleSourceRegistry.get(song.platform, song.id)
          const stickyToggleKey = stickyToggle ? `${stickyToggle.platform}:${stickyToggle.id}` : null
          const stickyTogglePlayable = Boolean(
            stickyToggle &&
            stickyToggleKey &&
            stickyToggleKey !== internal.retriedToggleKey &&
            !failedSongKeys.has(stickyToggleKey) &&
            !retriedPlatforms.has(stickyToggle.platform as Platform),
          )
          if (stickyToggle && stickyTogglePlayable) {
            try {
              const stickyResult = await this.tryGetLxSongUrl(stickyToggle, qualityChain)
              if (stickyResult?.url) {
                return {
                  url: stickyResult.url,
                  quality: stickyResult.quality,
                  sourceSwitch: `${song.platform} -> ${stickyToggle.platform}`,
                  toggleSong: stickyToggle,
                }
              }
            } catch (error) {
              if (isTooManyRequestsError(error)) {
                return this.buildRateLimitResult(quality)
              }
            }
            retriedPlatforms.add(stickyToggle.platform as Platform)
            toggleSourceRegistry.clear(song.platform, song.id)
          } else if (stickyToggle && stickyToggleKey && failedSongKeys.has(stickyToggleKey)) {
            toggleSourceRegistry.clear(song.platform, song.id)
            if (stickyToggle.platform) retriedPlatforms.add(stickyToggle.platform as Platform)
          }
        }

        const platformOrder = getEnabledPlatformOrder()
        if (platformOrder.length === 0) continue

        const alternatives = await findAlternativeSongs(song, {
          excludePlatforms: Array.from(retriedPlatforms),
          maxResults: 5,
          platformOrder,
        })
        const allowedPlatforms = new Set<Platform>(platformOrder)
        const usableAlternatives = alternatives.filter((alternative) => {
          if (!alternative?.platform || !alternative.id) return false
          if (!allowedPlatforms.has(alternative.platform as Platform)) return false
          const key = `${alternative.platform}:${alternative.id}`
          if (failedSongKeys.has(key)) return false
          return true
        })
        for (let index = 0; index < usableAlternatives.length; index += 1) {
          const alternative = usableAlternatives[index]
          if (retriedPlatforms.has(alternative.platform as Platform)) continue
          retriedPlatforms.add(alternative.platform as Platform)

          try {
            const altResult = await this.tryGetLxSongUrl(alternative, qualityChain)
            if (altResult?.url) {
              const remaining = usableAlternatives.filter((item, itemIndex) => (
                itemIndex !== index && !failedSongKeys.has(`${item.platform}:${item.id}`)
              ))
              return {
                url: altResult.url,
                quality: altResult.quality,
                sourceSwitch: `${song.platform} -> ${alternative.platform}`,
                toggleSong: alternative,
                toggleAlternatives: remaining,
              }
            }
          } catch (error) {
            if (isTooManyRequestsError(error)) {
              return this.buildRateLimitResult(quality)
            }
          }
        }
        continue
      }

      if (stageId === 'scripts') {
        const sourceStatus = await lxSourceApi.getStatus().catch((error) => {
          console.warn('Get LX source status for fallback failed:', error)
          return null
        })
        if (!sourceStatus?.available) continue

        const currentSourceName = sourceStatus.scriptInfo?.name || '当前音源'
        const { order: scriptOrderIds } = getEnabledScriptOrder()
        const managedById = new Map(sourceStatus.managedSources.map((item) => [item.id, item]))
        // Ordered + enabled scripts first, then newly imported ones that the user has not
        // ordered yet so they are still used by default.
        const orderedCandidates = [
          ...scriptOrderIds.map((id) => managedById.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item)),
          ...sourceStatus.managedSources.filter((item) => !scriptOrderIds.includes(item.id)),
        ]
        const fallbackSources = orderedCandidates.filter((item) => item.exists && item.id !== sourceStatus.activeSourceId)

        for (const fallbackSource of fallbackSources) {
          try {
            const fallbackResult = await this.tryGetLxSongUrl(song, qualityChain, fallbackSource.id)
            if (!fallbackResult?.url) continue

            return {
              url: fallbackResult.url,
              quality: fallbackResult.quality,
              sourceSwitch: `${currentSourceName} -> ${fallbackSource.scriptInfo.name || '备用音源'}`,
            }
          } catch (error) {
            if (isTooManyRequestsError(error)) {
              return this.buildRateLimitResult(quality)
            }
          }
        }
        continue
      }
    }

    // Everything failed.  Surface the most descriptive error we have.
    const failureMessage = originError instanceof Error ? originError.message : 'LX 音源未返回可用的播放链接'
    return {
      url: '',
      quality,
      error: {
        code: 404,
        message: allowTempSourceFallback ? '所有源均不可放' : failureMessage,
        type: allowTempSourceFallback ? 'ALL_SOURCES_UNPLAYABLE' : 'LX_SOURCE_EMPTY',
      },
    }
  }

  private buildRateLimitResult(quality: AudioQuality): SongUrlResult {
    // Cooldown matches lx-music-desktop's delayRetry jitter of 2-6 seconds.  A single cooldown is
    // enough because tooManyRequests usually means the remote is shared across queries.
    this.songUrlCooldownUntil = Date.now() + pickRandomDelayMs(2, 6)
    return {
      url: '',
      quality,
      error: {
        code: 429,
        message: '请求过于频繁，请稍后再试',
        type: 'TOO_MANY_REQUESTS',
      },
    }
  }

  private getSongUrlKey(
    platform: Platform,
    id: string,
    quality: AudioQuality,
    extraParams?: Record<string, any>
  ): string {
    const extras = extraParams
      ? JSON.stringify(extraParams, Object.keys(extraParams).sort())
      : ''
    return `${platform}:${id}:${quality}:${extras}`
  }

  // Builds a minimal Song record from just a platform + id.  Used as a last-resort metadata
  // fallback when the caller cannot supply the full song object (e.g. 小芸 direct playback by
  // ID).  Most LX scripts only need songmid (== id for wy/kw/kg/mg), so this stub is usually
  // enough to resolve a playback URL; callers that need richer metadata should still pass the
  // fully-populated Song via extraParams.song.
  private buildSongStub(platform: Platform, id: string): Song {
    return {
      id,
      name: '',
      artist: '',
      album: '',
      duration: 0,
      platform,
    }
  }

  // Get song URL with actual quality info and source switch info
  async getSongUrl(
    platform: Platform,
    id: string,
    quality: AudioQuality = '320k',
    extraParams?: Record<string, any>
  ): Promise<SongUrlResult | null> {
    const key = this.getSongUrlKey(platform, String(id), quality, extraParams)
    const now = Date.now()
    if (now < this.songUrlCooldownUntil) {
      console.warn('Song URL request throttled due to rate limit')
      return null
    }

    const existing = this.songUrlRequests.get(key)
    if (existing) return existing

    const task = (async() => {
      try {
        const registrySong = (extraParams?.song as Song | undefined) || songRegistry.getSong(platform, String(id))
        let targetSong = registrySong

        if (!targetSong) {
          // Fall back to a minimal stub without relying on any private service.
          // LX scripts still resolve correctly for wy/kw/kg/mg because songmid == id for those
          // platforms.  QQ (tx) may need richer metadata (hash/strMediaMid); callers that know
          // this should pre-populate extraParams.song.
          targetSong = this.buildSongStub(platform, String(id))
        }

        const failedKeysArray = Array.isArray(extraParams?.excludeFailedSongKeys)
          ? (extraParams!.excludeFailedSongKeys as unknown[]).filter((entry): entry is string => typeof entry === 'string')
          : []

        const resolution = await this.resolveSongUrlWithFallbacks(
          targetSong,
          quality,
          Boolean(extraParams?.allowTempSourceFallback),
          { failedSongKeys: new Set(failedKeysArray) },
        )

        // Persist the matched alternative so follow-up plays of the same song reuse it instead
        // of re-running findMusic.  Clearing happens inside resolveSongUrlWithFallbacks when a
        // remembered toggle stops working.
        if (resolution.url && resolution.toggleSong) {
          toggleSourceRegistry.set(platform, String(id), resolution.toggleSong)
          songRegistry.rememberSong(resolution.toggleSong)
        }

        return resolution
      } catch (error) {
        console.error('Get song URL error:', error)
        return {
          url: '',
          quality,
          error: {
            code: 500,
            message: error instanceof Error ? error.message : 'LX 音源解析失败',
            type: 'LX_SOURCE_ERROR',
          },
        }
      }
    })()

    this.songUrlRequests.set(key, task)
    try {
      return await task
    } finally {
      this.songUrlRequests.delete(key)
    }
  }

  async getLyricData(song: Song): Promise<LyricData | null> {
    if (!song?.id) return null
    songRegistry.rememberSong(song)

    const cached = cache.get<LyricData>('lyricData', song.platform, song.id, LYRIC_DATA_CACHE_VERSION)
    if (cached) return cached

    try {
      const lyricData = await officialLyricApi.getLyric(song)
      if (lyricData) {
        cache.set('lyricData', lyricData, undefined, song.platform, song.id, LYRIC_DATA_CACHE_VERSION)
        if (lyricData.lyric) {
          cache.set('lyrics', lyricData.lyric, undefined, song.platform, song.id)
        }
      }
      return lyricData
    } catch (error) {
      console.error('Get lyric data error:', error)
      return null
    }
  }

  async getSongComments(song: Song, page: number = 1, limit: number = 20): Promise<SongCommentPage> {
    if (!song?.id) return { source: 'wy', comments: [], total: 0, page, limit, maxPage: 1 }
    songRegistry.rememberSong(song)

    const cached = cache.get<SongCommentPage>('songComments', song.platform, song.id, page, limit)
    if (cached) return cached

    const result = await officialCommentApi.getComments(song, page, limit)
    cache.set('songComments', result, undefined, song.platform, song.id, page, limit)
    return result
  }

  async getSongHotComments(song: Song, page: number = 1, limit: number = 20): Promise<SongCommentPage> {
    if (!song?.id) return { source: 'wy', comments: [], total: 0, page, limit, maxPage: 1 }
    songRegistry.rememberSong(song)

    const cached = cache.get<SongCommentPage>('songHotComments', song.platform, song.id, page, limit)
    if (cached) return cached

    const result = await officialCommentApi.getHotComments(song, page, limit)
    cache.set('songHotComments', result, undefined, song.platform, song.id, page, limit)
    return result
  }

  // Search songs
  async search(
    platform: Platform,
    keyword: string,
    limit: number = 20,
    page: number = 1
  ): Promise<SearchResult> {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) return { songs: [], hasMore: false, total: 0 }

    const cacheKey = ['songsV2', platform, normalizedKeyword, limit, page] as const
    const cached = cache.get<SearchResult>('search', ...cacheKey)
    if (cached) return cached

    try {
      const result = await officialSearch.searchSongs(platform, normalizedKeyword, limit, page)
      cache.set('search', result, undefined, ...cacheKey)
      return result
    } catch (error) {
      console.error('Search error:', error)
      return { songs: [], hasMore: false, total: 0 }
    }
  }

  // Search albums
  async searchAlbum(
    platform: Platform,
    keyword: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ albums: Album[]; hasMore: boolean; total: number }> {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) return { albums: [], hasMore: false, total: 0 }

    const cacheKey = ['albums', platform, normalizedKeyword, limit, page] as const
    const cached = cache.get<{ albums: Album[]; hasMore: boolean; total: number }>('search', ...cacheKey)
    if (cached) return cached

    try {
      const result = await officialSearch.searchAlbums(platform, normalizedKeyword, limit, page)
      cache.set('search', result, undefined, ...cacheKey)
      return result
    } catch (error) {
      console.error('Search album error:', error)
      return { albums: [], hasMore: false, total: 0 }
    }
  }

  // Search playlists
  async searchPlaylist(
    platform: Platform,
    keyword: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ playlists: PlaylistSummary[]; hasMore: boolean; total: number }> {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) return { playlists: [], hasMore: false, total: 0 }

    const cacheKey = ['playlists', platform, normalizedKeyword, limit, page] as const
    const cached = cache.get<{ playlists: PlaylistSummary[]; hasMore: boolean; total: number }>('search', ...cacheKey)
    if (cached) return cached

    try {
      const result = await officialSearch.searchPlaylists(platform, normalizedKeyword, limit, page)
      cache.set('search', result, undefined, ...cacheKey)
      return result
    } catch (error) {
      console.error('Search playlist error:', error)
      return { playlists: [], hasMore: false, total: 0 }
    }
  }

  // Aggregate search (search all platforms)
  async aggregateSearch(
    keyword: string,
    limit: number = 10,
    page: number = 1
  ): Promise<AggregateSearchResult> {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) return { keyword: normalizedKeyword, total: 0, results: [] }

    const cacheKey = ['aggregate', normalizedKeyword, limit, page] as const
    const cached = cache.get<AggregateSearchResult>('search', ...cacheKey)
    if (cached) return cached

    try {
      const platforms: Platform[] = ['netease', 'qq', 'kuwo', 'kugou', 'migu']
      const results = await Promise.all(
        platforms.map(async(platform) => ({
          platform,
          ...(await officialSearch.searchSongs(platform, normalizedKeyword, limit, page)),
        }))
      )

      const aggregate: AggregateSearchResult = {
        keyword: normalizedKeyword,
        total: results.reduce((sum, item) => sum + item.total, 0),
        results: results.map((item) => ({
          platform: item.platform,
          songs: item.songs,
        })),
      }

      cache.set('search', aggregate, undefined, ...cacheKey)
      return aggregate
    } catch (error) {
      console.error('Aggregate search error:', error)
      return { keyword: normalizedKeyword, total: 0, results: [] }
    }
  }

  // Get all toplists (with cache)
  async getToplists(platform: Platform, options?: { force?: boolean }): Promise<Toplist[]> {
    if (options?.force) {
      cache.remove(TOPLISTS_CACHE_KEY, platform)
    } else {
      const cached = this.getCachedToplists(platform)
      if (cached) return cached
    }

    try {
      const toplists = await officialMusic.getToplists(platform)
      cache.set(TOPLISTS_CACHE_KEY, toplists, undefined, platform)
      return toplists
    } catch (error) {
      console.error('Get toplists error:', error)
      throw error
    }
  }

  // Get toplist songs (with cache)
  async getToplist(platform: Platform, id: string, options?: { force?: boolean }): Promise<Song[]> {
    if (options?.force) {
      cache.remove(TOPLIST_SONGS_CACHE_KEY, platform, id)
    } else {
      const cached = this.getCachedToplist(platform, id)
      if (cached) return cached
    }

    try {
      const songs = await officialMusic.getToplistSongs(platform, id)
      cache.set(TOPLIST_SONGS_CACHE_KEY, songs, undefined, platform, id)
      return songs
    } catch (error) {
      const cached = this.getCachedToplist(platform, id)
      if (cached) {
        console.warn('Get toplist fallback to cache:', error)
        return cached
      }
      console.error('Get toplist error:', error)
      throw error
    }
  }

  getPlaylistSorts(platform: Platform): PlaylistSortOption[] {
    return officialMusic.getPlaylistSorts(platform)
  }

  async getPlaylistTags(platform: Platform, options?: { force?: boolean }): Promise<PlaylistTagInfo> {
    if (options?.force) {
      cache.remove(PLAYLIST_TAGS_CACHE_KEY, platform)
    } else {
      const cached = cache.get<PlaylistTagInfo>(PLAYLIST_TAGS_CACHE_KEY, platform)
      if (cached) return cached
    }

    try {
      const tagInfo = await officialMusic.getPlaylistTags(platform)
      cache.set(PLAYLIST_TAGS_CACHE_KEY, tagInfo, undefined, platform)
      return tagInfo
    } catch (error) {
      console.error('Get playlist tags error:', error)
      return {
        hotTag: [],
        tags: [],
        platform,
      }
    }
  }

  // Get recommended playlists
  async getRecommendPlaylistPage(
    platform: Platform,
    page: number = 1,
    options?: { sortId?: string; tagId?: string; force?: boolean },
  ): Promise<RecommendPlaylistPage> {
    const sortId = options?.sortId || ''
    const tagId = options?.tagId || ''

    if (options?.force) {
      cache.remove(RECOMMEND_PLAYLISTS_CACHE_KEY, platform, sortId, tagId, page)
    } else {
      const cached = cache.get<RecommendPlaylistPage>(RECOMMEND_PLAYLISTS_CACHE_KEY, platform, sortId, tagId, page)
      if (cached) return cached
    }

    try {
      const result = await officialMusic.getRecommendPlaylistPage(platform, page, { sortId, tagId })
      cache.set(RECOMMEND_PLAYLISTS_CACHE_KEY, result, undefined, platform, sortId, tagId, page)
      return result
    } catch (error) {
      console.error('Get recommend playlists error:', error)
      return {
        playlists: [],
        total: 0,
        page,
        limit: 0,
        hasMore: false,
      }
    }
  }

  async getRecommendPlaylists(
    platform: Platform,
    page: number = 1,
    options?: { sortId?: string; tagId?: string; force?: boolean },
  ): Promise<RecommendPlaylist[]> {
    return (await this.getRecommendPlaylistPage(platform, page, options)).playlists
  }

  // Get playlist detail with description
  async getPlaylistDetail(platform: Platform, id: string, options?: { force?: boolean }): Promise<PlaylistDetail | null> {
    // Handle special ID formats (e.g., kuwo: "digest-8__3636252949" -> "3636252949")
    let cleanId = id
    if (platform === 'kuwo' && id.includes('__')) {
      cleanId = id.split('__').pop() || id
    }

    // Check cache
    if (!options?.force) {
      const cached = cache.get<PlaylistDetail>('playlistDetail', platform, cleanId)
      if (cached) {
        if (!hasInvalidPlaylistDetailCache(platform, cached)) {
          return cached
        }
        cache.remove('playlistDetail', platform, cleanId)
      }
    }

    try {
      const result = await officialMusic.getPlaylistDetail(platform, cleanId)
      if (!result) return null
      cache.set('playlistDetail', result, undefined, platform, cleanId)
      return result
    } catch (error) {
      console.error('Get playlist detail error:', error)
      return null
    }
  }

  async getToplistPage(platform: Platform, id: string, page: number, options?: { force?: boolean }): Promise<PaginatedSongsResult> {
    if (options?.force) {
      cache.remove(TOPLIST_SONGS_PAGE_CACHE_KEY, platform, id, page)
    } else {
      const cached = cache.get<PaginatedSongsResult>(TOPLIST_SONGS_PAGE_CACHE_KEY, platform, id, page)
      if (cached) return cached
    }

    try {
      const result = await officialMusic.getToplistSongsPage(platform, id, page)
      cache.set(TOPLIST_SONGS_PAGE_CACHE_KEY, result, undefined, platform, id, page)
      return result
    } catch (error) {
      console.error('Get toplist page error:', error)
      throw error
    }
  }

  async getPlaylistDetailPage(platform: Platform, id: string, page: number, options?: { force?: boolean }): Promise<PaginatedSongsResult> {
    let cleanId = id
    if (platform === 'kuwo' && id.includes('__')) {
      cleanId = id.split('__').pop() || id
    }

    if (options?.force) {
      cache.remove(PLAYLIST_DETAIL_PAGE_CACHE_KEY, platform, cleanId, page)
    } else {
      const cached = cache.get<PaginatedSongsResult>(PLAYLIST_DETAIL_PAGE_CACHE_KEY, platform, cleanId, page)
      if (cached) return cached
    }

    try {
      const result = await officialMusic.getPlaylistDetailPage(platform, cleanId, page)
      cache.set(PLAYLIST_DETAIL_PAGE_CACHE_KEY, result, undefined, platform, cleanId, page)
      return result
    } catch (error) {
      console.error('Get playlist detail page error:', error)
      throw error
    }
  }

  async getAlbumDetail(platform: Platform, id: string, options?: { force?: boolean }): Promise<AlbumDetail | null> {
    if (!options?.force) {
      const cached = cache.get<AlbumDetail>('albumDetail', platform, id)
      if (cached) return cached
    }

    try {
      const result = await officialSearch.getAlbumDetail(platform, id)
      if (!result) return null
      cache.set('albumDetail', result, undefined, platform, id)
      return result
    } catch (error) {
      console.error('Get album detail error:', error)
      return null
    }
  }

}

export const api = new SollinAPI()
export default api
