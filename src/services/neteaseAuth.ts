/**
 * Netease Cloud Music API Service
 * Direct API calls to music.163.com with weapi/eapi encryption
 */

import type { PaginatedSongsResult, Song } from '@/types'
import type { NeteasePlaylistSummary, NeteaseUserData, QrCheckResult } from '@/stores/authStore'
import type { AudioQuality } from '@/types'
import api from './api'
import { neteaseRequest, setCookie } from './neteaseCrypto'

// Resource type mapping for comments
const RESOURCE_TYPE_MAP: Record<string, string> = {
    '0': 'R_SO_4_',
    '1': 'R_MV_5_',
    '2': 'A_PL_0_',
    '3': 'R_AL_3_',
    '4': 'A_DJ_1_',
    '5': 'R_VI_62_',
    '6': 'A_EV_2_',
    '7': 'A_DR_14_',
}

class NeteaseAuthAPI {
    private playlistTrackIdsCache: Map<number, { ids: number[]; total: number }> = new Map()

    // Helper: make weapi request
    private async weapi(uri: string, data: Record<string, unknown> = {}, cookie?: string) {
        return neteaseRequest(uri, data, 'weapi', cookie)
    }

    // Helper: make eapi request
    private async eapi(uri: string, data: Record<string, unknown> = {}, cookie?: string) {
        return neteaseRequest(uri, data, 'eapi', cookie)
    }

    // Helper: map song item to Song type
    private mapSong(item: any): Song {
        const cover = item.al?.picUrl || item.album?.picUrl || item.cover || item.picUrl || ''
        return {
            id: String(item.id),
            name: item.name,
            artist: item.ar?.map((a: any) => a.name).join(', ') || '',
            artists: item.ar?.map((a: any) => ({
                id: String(a.id),
                name: a.name,
                avatar: a.picUrl,
                platform: 'netease' as const,
            })),
            album: item.al?.name || '',
            albumId: String(item.al?.id || ''),
            duration: Math.floor((item.dt || 0) / 1000),
            cover,
            platform: 'netease' as const,
        }
    }

    private mapPlaylist(item: any): NeteasePlaylistSummary {
        return {
            id: item.id,
            name: item.name || '',
            cover: item.coverImgUrl || item.cover || item.picUrl || '',
            description: item.description || '',
            trackCount: item.trackCount || item.trackcount || 0,
            playCount: item.playCount || item.playcount || 0,
            creator: item.creator ? {
                userId: item.creator.userId,
                nickname: item.creator.nickname || '',
                avatarUrl: item.creator.avatarUrl || '',
            } : undefined,
            subscribed: Boolean(item.subscribed),
        }
    }

    private extractPlaylistList(body: any): any[] {
        const playlist = body?.playlist || body?.data?.playlist || body?.list || body?.data?.list || body?.data
        return Array.isArray(playlist) ? playlist : []
    }

    /**
     * Set authentication cookie (call after login)
     */
    setAuthCookie(cookie: string | Record<string, string>) {
        setCookie(cookie)
    }

    /**
     * Generate QR code key for login
     */
    async getQrKey(): Promise<{ unikey: string; qrimg?: string } | null> {
        try {
            const res = await this.eapi('/api/login/qrcode/unikey', { type: 3 })
            if (res?.body?.code === 200) {
                const data = res.body.data || res.body
                if (data?.unikey) {
                    return { unikey: data.unikey }
                }
            }
            return null
        } catch (error) {
            console.error('Get QR key error:', error)
            return null
        }
    }

    /**
     * Create QR code image
     */
    async createQrCode(key: string): Promise<string | null> {
        // Generate QR code URL - client-side QR generation
        const url = `https://music.163.com/login?codekey=${key}`
        return url
    }

    /**
     * Check QR code scan status
     */
    async checkQrStatus(key: string): Promise<QrCheckResult | null> {
        try {
            const res = await this.eapi('/api/login/qrcode/client/login', {
                key,
                type: 3,
            })

            if (!res) return null

            const body = res.body
            const code = body.code as 800 | 801 | 802 | 803

            // Cookie from response
            const cookieStr = res.cookie?.join('; ') || ''

            return {
                code,
                message: body.message || '',
                nickname: body.nickname,
                avatarUrl: body.avatarUrl,
                cookie: cookieStr,
            }
        } catch (error) {
            console.error('Check QR status error:', error)
            return null
        }
    }

    /**
     * Get login status
     */
    async getLoginStatus(cookie?: string): Promise<{
        isLoggedIn: boolean
        userId?: number
        nickname?: string
        avatarUrl?: string
    }> {
        try {
            const res = await this.weapi('/api/w/nuser/account/get', {}, cookie)
            if (res?.body?.code === 200 && res.body.profile) {
                return {
                    isLoggedIn: true,
                    userId: res.body.profile.userId,
                    nickname: res.body.profile.nickname,
                    avatarUrl: res.body.profile.avatarUrl,
                }
            }
            return { isLoggedIn: false }
        } catch (error) {
            console.error('Get login status error:', error)
            return { isLoggedIn: false }
        }
    }

    /**
     * Get user account info
     */
    async getUserAccount(cookie?: string): Promise<NeteaseUserData | null> {
        try {
            const res = await this.weapi('/api/nuser/account/get', {}, cookie)
            if (res?.body?.code === 200 && res.body.profile) {
                const profile = res.body.profile
                return {
                    userId: profile.userId,
                    nickname: profile.nickname,
                    avatarUrl: profile.avatarUrl,
                    signature: profile.signature,
                    vipType: profile.vipType,
                }
            }
            return null
        } catch (error) {
            console.error('Get user account error:', error)
            return null
        }
    }

    /**
     * Get user's playlists
     */
    async getUserPlaylist(uid: number, cookie?: string): Promise<NeteasePlaylistSummary[]> {
        try {
            const res = await this.weapi('/api/user/playlist', {
                uid,
                limit: 50,
                offset: 0,
                includeVideo: true,
            }, cookie)

            if (res?.body?.code === 200 && res.body.playlist) {
                return res.body.playlist.map((item: any) => this.mapPlaylist(item))
            }
            return []
        } catch (error) {
            console.error('Get user playlist error:', error)
            return []
        }
    }

    /**
     * Get user's created playlists.
     * Mirrors api-enhanced `/user/playlist/create`.
     */
    async getUserCreatedPlaylists(
        uid: number,
        cookie?: string,
        limit: number = 100,
        offset: number = 0,
    ): Promise<NeteasePlaylistSummary[]> {
        try {
            const res = await this.eapi('/api/user/playlist/create', {
                userId: uid,
                limit,
                offset,
                isWebview: 'true',
                includeRedHeart: 'true',
                includeTop: 'true',
            }, cookie)

            if (res?.body?.code === 200) {
                return this.extractPlaylistList(res.body).map((item: any) => ({
                    ...this.mapPlaylist(item),
                    subscribed: Boolean(item.subscribed),
                }))
            }
            return []
        } catch (error) {
            console.error('Get user created playlists error:', error)
            return []
        }
    }

    /**
     * Get user's collected playlists.
     * Mirrors api-enhanced `/user/playlist/collect`.
     */
    async getUserCollectedPlaylists(
        uid: number,
        cookie?: string,
        limit: number = 100,
        offset: number = 0,
    ): Promise<NeteasePlaylistSummary[]> {
        try {
            const res = await this.eapi('/api/user/playlist/collect', {
                userId: uid,
                limit,
                offset,
                isWebview: 'true',
                includeRedHeart: 'true',
                includeTop: 'true',
            }, cookie)

            if (res?.body?.code === 200) {
                return this.extractPlaylistList(res.body).map((item: any) => ({
                    ...this.mapPlaylist(item),
                    subscribed: true,
                }))
            }
            return []
        } catch (error) {
            console.error('Get user collected playlists error:', error)
            return []
        }
    }

    async getUserPlaylistGroups(uid: number, cookie?: string): Promise<{
        playlists: NeteasePlaylistSummary[]
        createdPlaylists: NeteasePlaylistSummary[]
        collectedPlaylists: NeteasePlaylistSummary[]
    }> {
        const [createdPlaylists, collectedPlaylists] = await Promise.all([
            this.getUserCreatedPlaylists(uid, cookie),
            this.getUserCollectedPlaylists(uid, cookie),
        ])

        if (createdPlaylists.length > 0 || collectedPlaylists.length > 0) {
            return {
                createdPlaylists,
                collectedPlaylists,
                playlists: [...createdPlaylists, ...collectedPlaylists],
            }
        }

        const playlists = await this.getUserPlaylist(uid, cookie)
        return {
            playlists,
            createdPlaylists: playlists.filter((playlist) => playlist.creator?.userId === uid || !playlist.subscribed),
            collectedPlaylists: playlists.filter((playlist) => playlist.creator?.userId !== uid && playlist.subscribed),
        }
    }

    /**
     * Get playlist metadata (name, cover, trackCount, etc.)
     */
    async getPlaylistInfo(id: number, cookie?: string): Promise<{ name: string; cover: string; description: string; trackCount: number; creator?: { userId: number; nickname: string; avatarUrl: string } } | null> {
        try {
            const res = await this.eapi('/api/v6/playlist/detail', {
                id,
                n: 100000,
                s: 8,
            }, cookie)

            if (res?.body?.code === 200 && res.body.playlist) {
                const playlist = res.body.playlist
                return {
                    name: playlist.name || '',
                    cover: playlist.coverImgUrl || playlist.coverImg || '',
                    description: playlist.description || '',
                    trackCount: playlist.trackCount || 0,
                    creator: playlist.creator ? {
                        userId: playlist.creator.userId,
                        nickname: playlist.creator.nickname || '',
                        avatarUrl: playlist.creator.avatarUrl || '',
                    } : undefined,
                }
            }
            return null
        } catch (error) {
            console.error('Get playlist info error:', error)
            return null
        }
    }

    /**
     * Get daily recommended songs
     */
    async getDailyRecommend(cookie?: string): Promise<Song[]> {
        try {
            const res = await this.weapi('/api/v3/discovery/recommend/songs', {
                offset: 0,
                total: true,
                limit: 30,
            }, cookie)

            if (res?.body?.code === 200 && res.body.data?.dailySongs) {
                return res.body.data.dailySongs.map((item: any) => this.mapSong(item))
            }
            return []
        } catch (error) {
            console.error('Get daily recommend error:', error)
            return []
        }
    }

    /**
     * Get user's liked songs ID list
     */
    async getLikelist(uid: number, cookie?: string): Promise<number[]> {
        try {
            const res = await this.eapi('/api/song/like/get', { uid }, cookie)
            if (res?.body?.code === 200 && res.body.ids) {
                return res.body.ids
            }
            return []
        } catch (error) {
            console.error('Get likelist error:', error)
            return []
        }
    }

    /**
     * Get playlist detail with all tracks
     */
    async getPlaylistDetail(id: number, cookie?: string): Promise<Song[]> {
        try {
            const res = await this.eapi('/api/v6/playlist/detail', {
                id,
                n: 100000,
                s: 8,
            }, cookie)

            if (res?.body?.code === 200 && res.body.playlist) {
                const trackIds = res.body.playlist.trackIds as { id: number }[]
                if (!trackIds || trackIds.length === 0) return []

                // Fetch song details in batches
                const allSongs: Song[] = []
                const batchSize = 50
                for (let i = 0; i < trackIds.length; i += batchSize) {
                    const batch = trackIds.slice(i, i + batchSize)
                    const ids = batch.map((t) => t.id)
                    const c = '[' + ids.map((id) => `{"id":${id}}`).join(',') + ']'
                    const detailRes = await this.weapi('/api/v3/song/detail', { c })
                    if (detailRes?.body?.songs) {
                        allSongs.push(...detailRes.body.songs.map((item: any) => this.mapSong(item)))
                    }
                }
                return allSongs
            }
            return []
        } catch (error) {
            console.error('Get playlist detail error:', error)
            return []
        }
    }

    /**
     * Get playlist detail with pagination support
     * First fetches all track IDs, then fetches song details for the requested page
     */
    async getPlaylistDetailPage(id: number, cookie?: string, limit = 50, offset = 0): Promise<PaginatedSongsResult> {
        try {
            // Fetch track IDs if not cached
            if (!this.playlistTrackIdsCache.has(id)) {
                const res = await this.eapi('/api/v6/playlist/detail', {
                    id,
                    n: 100000,
                    s: 8,
                }, cookie)

                if (res?.body?.code === 200 && res.body.playlist) {
                    const trackIds = (res.body.playlist.trackIds as { id: number }[]).map((t) => t.id)
                    const total = res.body.playlist.trackCount || trackIds.length
                    this.playlistTrackIdsCache.set(id, { ids: trackIds, total })
                } else {
                    return { songs: [], total: 0, page: 1, limit, hasMore: false }
                }
            }

            const cached = this.playlistTrackIdsCache.get(id)!
            const pageIds = cached.ids.slice(offset, offset + limit)

            if (pageIds.length === 0) {
                return { songs: [], total: cached.total, page: Math.floor(offset / limit) + 1, limit, hasMore: false }
            }

            // Fetch song details for this page
            const c = '[' + pageIds.map((id) => `{"id":${id}}`).join(',') + ']'
            const detailRes = await this.weapi('/api/v3/song/detail', { c })
            const songs = detailRes?.body?.songs?.map((item: any) => this.mapSong(item)) || []

            const currentPage = Math.floor(offset / limit) + 1
            const hasMore = offset + songs.length < cached.total

            return { songs, total: cached.total, page: currentPage, limit, hasMore }
        } catch (error) {
            console.error('Get playlist detail page error:', error)
            return { songs: [], total: 0, page: 1, limit, hasMore: false }
        }
    }

    /**
     * Clear playlist track IDs cache (call after modifying playlist)
     */
    clearPlaylistCache(id?: number) {
        if (id) {
            this.playlistTrackIdsCache.delete(id)
        } else {
            this.playlistTrackIdsCache.clear()
        }
    }

    /**
     * Get song lyrics
     */
    async getLyrics(id: string | number): Promise<string | null> {
        try {
            const res = await this.eapi('/api/song/lyric/v1', {
                id,
                cp: false,
                tv: 0,
                lv: 0,
                rv: 0,
                kv: 0,
                yv: 0,
                ytv: 0,
                yrv: 0,
            })

            return res?.body?.lrc?.lyric || null
        } catch (error) {
            console.error('Get lyrics error:', error)
            return null
        }
    }

    /**
     * Get song URL for playback
     * Uses the music platform API to get a song URL.
     */
    async getSongUrl(
        id: string | number,
        level: 'standard' | 'higher' | 'exhigh' | 'lossless' | 'hires' = 'exhigh'
    ): Promise<{ url: string; quality: string; br?: number; error?: { code: number; message: string; type?: string } } | null> {
        try {
            let quality: AudioQuality = '320k'
            switch (level) {
                case 'standard':
                    quality = '128k'
                    break
                case 'higher':
                case 'exhigh':
                    quality = '320k'
                    break
                case 'lossless':
                    quality = 'flac'
                    break
                case 'hires':
                    quality = 'flac24bit'
                    break
            }

            const result = await api.getSongUrl('netease', String(id), quality)

            if (result) {
                if (result.error) {
                    return { url: '', quality: result.quality, error: result.error }
                }
                return { url: result.url, quality: result.quality }
            }
            return null
        } catch (error) {
            console.error('Get song URL error:', error)
            return null
        }
    }

    /**
     * Logout
     */
    async logout(): Promise<boolean> {
        try {
            const res = await this.eapi('/api/logout', {})
            return res?.body?.code === 200
        } catch (error) {
            console.error('Logout error:', error)
            return false
        }
    }

    /**
     * Search - Cloud search API
     */
    async search(
        keywords: string,
        type: number = 1,
        limit: number = 30,
        offset: number = 0,
        cookie?: string
    ): Promise<any> {
        try {
            const res = await this.eapi('/api/cloudsearch/pc', {
                s: keywords,
                type,
                limit,
                offset,
                total: true,
            }, cookie)

            if (res?.body?.code === 200 && res.body.result) {
                return res.body.result
            }
            return null
        } catch (error) {
            console.error('Search error:', error)
            return null
        }
    }

    /**
     * Search songs and return normalized Song array
     */
    async searchSongs(keywords: string, limit: number = 30, offset: number = 0, cookie?: string): Promise<Song[]> {
        const result = await this.search(keywords, 1, limit, offset, cookie)
        if (!result?.songs) return []

        return result.songs.map((item: any) => this.mapSong(item))
    }

    /**
     * Get hot search list
     */
    async getHotSearch(): Promise<any[]> {
        try {
            const res = await this.weapi('/api/hotsearchlist/get', {})
            if (res?.body?.code === 200 && res.body.data) {
                return res.body.data
            }
            return []
        } catch (error) {
            console.error('Get hot search error:', error)
            return []
        }
    }

    /**
     * Get search suggestions
     */
    async getSearchSuggest(keywords: string): Promise<any> {
        try {
            const type = 'web'
            const res = await this.weapi(`/api/search/suggest/${type}`, {
                s: keywords,
            })

            if (res?.body?.code === 200 && res.body.result) {
                return res.body.result
            }
            return null
        } catch (error) {
            console.error('Get search suggest error:', error)
            return null
        }
    }

    /**
     * Get personalized playlists (推荐歌单)
     */
    async getPersonalizedPlaylists(limit: number = 10): Promise<any[]> {
        try {
            const res = await this.weapi('/api/personalized/playlist', {
                limit,
                total: true,
                n: 1000,
            })

            if (res?.body?.code === 200 && res.body.result) {
                return res.body.result.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    cover: item.picUrl,
                    playCount: item.playCount,
                    trackCount: item.trackCount,
                    copywriter: item.copywriter,
                }))
            }
            return []
        } catch (error) {
            console.error('Get personalized playlists error:', error)
            return []
        }
    }

    /**
     * Get personalized new songs (推荐新歌)
     */
    async getPersonalizedNewSongs(limit: number = 10): Promise<Song[]> {
        try {
            const res = await this.weapi('/api/personalized/newsong', {
                type: 'recommend',
                limit,
                areaId: 0,
            })

            if (res?.body?.code === 200 && res.body.result) {
                return res.body.result.map((item: any) => {
                    const song = item.song || item
                    const cover = song.album?.picUrl || song.al?.picUrl || item.picUrl || ''
                    return {
                        id: String(song.id),
                        name: song.name,
                        artist: song.artists?.map((a: any) => a.name).join(', ') || song.ar?.map((a: any) => a.name).join(', ') || '',
                        album: song.album?.name || song.al?.name || '',
                        albumId: String(song.album?.id || song.al?.id || ''),
                        duration: Math.floor((song.duration || song.dt || 0) / 1000),
                        cover,
                        platform: 'netease' as const,
                    }
                })
            }
            return []
        } catch (error) {
            console.error('Get personalized new songs error:', error)
            return []
        }
    }

    /**
     * Get top artists (热门歌手)
     */
    async getTopArtists(limit: number = 10): Promise<any[]> {
        try {
            const res = await this.weapi('/api/artist/top', {
                limit,
                offset: 0,
                total: true,
            })

            if (res?.body?.code === 200 && res.body.artists) {
                return res.body.artists.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    avatar: item.picUrl || item.img1v1Url,
                    alias: item.alias,
                }))
            }
            return []
        } catch (error) {
            console.error('Get top artists error:', error)
            return []
        }
    }

    /**
     * Get new albums (最新专辑)
     */
    async getNewAlbums(limit: number = 10): Promise<any[]> {
        try {
            const res = await this.weapi('/api/album/new', {
                limit,
                offset: 0,
                total: true,
                area: 'ALL',
            })

            if (res?.body?.code === 200 && res.body.albums) {
                return res.body.albums.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    cover: item.picUrl,
                    artist: item.artist?.name || item.artists?.map((a: any) => a.name).join(', ') || '',
                    artistId: item.artist?.id,
                    publishTime: item.publishTime,
                }))
            }
            return []
        } catch (error) {
            console.error('Get new albums error:', error)
            return []
        }
    }

    /**
     * Get recommend resource (推荐歌单 - 需登录)
     */
    async getRecommendResource(cookie?: string): Promise<any[]> {
        try {
            const res = await this.weapi('/api/v1/discovery/recommend/resource', {}, cookie)

            if (res?.body?.code === 200 && res.body.recommend) {
                return res.body.recommend.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    cover: item.picUrl,
                    playCount: item.playcount,
                    trackCount: item.trackCount,
                    copywriter: item.copywriter,
                    creator: item.creator?.nickname,
                }))
            }
            return []
        } catch (error) {
            console.error('Get recommend resource error:', error)
            return []
        }
    }

    /**
     * Get MV URL for playback
     */
    async getMvUrl(id: number | string, r: number = 1080): Promise<{ url: string; r: number } | null> {
        try {
            const res = await this.weapi('/api/song/enhance/play/mv/url', {
                id,
                r,
            })

            if (res?.body?.code === 200 && res.body.data?.url) {
                return {
                    url: res.body.data.url,
                    r: res.body.data.r || r,
                }
            }
            return null
        } catch (error) {
            console.error('Get MV URL error:', error)
            return null
        }
    }

    /**
     * Get MV detail
     */
    async getMvDetail(mvid: number | string): Promise<any | null> {
        try {
            const res = await this.weapi('/api/v1/mv/detail', {
                id: mvid,
            })

            if (res?.body?.code === 200 && res.body.data) {
                return res.body.data
            }
            return null
        } catch (error) {
            console.error('Get MV detail error:', error)
            return null
        }
    }

    /**
     * Get comments
     */
    async getComments(
        id: number | string,
        type: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 = 0,
        pageNo: number = 1,
        pageSize: number = 20,
        sortType: 1 | 2 | 3 = 1,
        cursor?: string
    ): Promise<{ comments: any[]; totalCount: number; hasMore: boolean; cursor?: string } | null> {
        try {
            const threadType = RESOURCE_TYPE_MAP[String(type)]
            const threadId = threadType + id

            let sort = Number(sortType) || 99
            if (sort === 1) sort = 99

            let cursorVal = ''
            switch (sort) {
                case 99:
                    cursorVal = String((pageNo - 1) * pageSize)
                    break
                case 2:
                    cursorVal = 'normalHot#' + (pageNo - 1) * pageSize
                    break
                case 3:
                    cursorVal = cursor || '0'
                    break
            }

            const res = await this.eapi('/api/v2/resource/comments', {
                threadId,
                pageNo,
                showInner: true,
                pageSize,
                cursor: cursorVal,
                sortType: sort,
            })

            if (res?.body?.code === 200 && res.body.data) {
                return {
                    comments: res.body.data.comments || [],
                    totalCount: res.body.data.totalCount || 0,
                    hasMore: res.body.data.hasMore || false,
                    cursor: res.body.data.cursor,
                }
            }
            return null
        } catch (error) {
            console.error('Get comments error:', error)
            return null
        }
    }

    /**
     * Get hot comments
     */
    async getHotComments(
        id: number | string,
        type: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 = 0,
        limit: number = 20,
        offset: number = 0,
        before?: number
    ): Promise<{ hotComments: any[]; total: number; hasMore: boolean } | null> {
        try {
            const threadType = RESOURCE_TYPE_MAP[String(type)]
            const res = await this.eapi(`/api/v1/resource/hotcomments/${threadType}${id}`, {
                rid: id,
                limit,
                offset,
                beforeTime: before || 0,
            })

            if (res?.body?.code === 200) {
                return {
                    hotComments: res.body.hotComments || [],
                    total: res.body.total || 0,
                    hasMore: res.body.hasMore || false,
                }
            }
            return null
        } catch (error) {
            console.error('Get hot comments error:', error)
            return null
        }
    }

    /**
     * Like/unlike a comment
     */
    async likeComment(
        id: number | string,
        cid: number | string,
        t: 0 | 1,
        type: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 = 0,
        cookie?: string
    ): Promise<boolean> {
        try {
            const threadType = RESOURCE_TYPE_MAP[String(type)]
            const action = t === 1 ? 'like' : 'unlike'
            const res = await this.weapi(`/api/v1/comment/${action}`, {
                threadId: threadType + id,
                commentId: cid,
            }, cookie)

            return res?.body?.code === 200
        } catch (error) {
            console.error('Like comment error:', error)
            return false
        }
    }

    // ==================== 私人 FM ====================

    /**
     * Get personal FM songs
     */
    async getPersonalFM(cookie?: string): Promise<Song[]> {
        try {
            const res = await this.weapi('/api/v1/radio/get', {}, cookie)

            if (res?.body?.code === 200 && res.body.data) {
                return res.body.data.map((item: any) => ({
                    id: String(item.id),
                    name: item.name,
                    artist: item.artists?.map((a: any) => a.name).join(', ') || '',
                    artists: item.artists?.map((a: any) => ({
                        id: String(a.id),
                        name: a.name,
                        avatar: a.picUrl,
                        platform: 'netease' as const,
                    })),
                    album: item.album?.name || '',
                    albumId: String(item.album?.id || ''),
                    duration: Math.floor((item.duration || 0) / 1000),
                    cover: item.album?.picUrl || '',
                    platform: 'netease' as const,
                }))
            }
            return []
        } catch (error) {
            console.error('Get personal FM error:', error)
            return []
        }
    }

    /**
     * Move song to FM trash (dislike)
     */
    async fmTrash(id: number | string, cookie?: string): Promise<boolean> {
        try {
            const res = await this.weapi('/api/radio/trash/add', {
                songId: id,
                alg: 'RT',
                time: 25,
            }, cookie)
            return res?.body?.code === 200
        } catch (error) {
            console.error('FM trash error:', error)
            return false
        }
    }

    // ==================== 排行榜 ====================

    /**
     * Get all toplists
     */
    async getToplistDetail(): Promise<any[]> {
        try {
            const res = await this.weapi('/api/toplist/detail/v2', {})

            if (res?.body?.code === 200 && res.body.list) {
                return res.body.list.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    cover: item.coverImgUrl,
                    description: item.description,
                    playCount: item.playCount,
                    trackCount: item.trackCount,
                    updateTime: item.updateTime,
                    updateFrequency: item.updateFrequency,
                    tracks: item.tracks?.slice(0, 3) || [],
                }))
            }
            return []
        } catch (error) {
            console.error('Get toplist detail error:', error)
            return []
        }
    }

    // ==================== 歌手相关 ====================

    /**
     * Get artist detail
     */
    async getArtistDetail(id: number | string): Promise<any | null> {
        try {
            const res = await this.eapi('/api/artist/head/info/get', { id })

            if (res?.body?.code === 200 && res.body.data) {
                const artist = res.body.data.artist || res.body.data
                return {
                    id: artist.id,
                    name: artist.name,
                    avatar: artist.cover || artist.picUrl,
                    briefDesc: artist.briefDesc,
                    albumSize: artist.albumSize,
                    musicSize: artist.musicSize,
                    mvSize: artist.mvSize,
                    followed: artist.followed,
                    alias: artist.alias,
                    identities: res.body.data.identify?.imageDesc,
                }
            }
            return null
        } catch (error) {
            console.error('Get artist detail error:', error)
            return null
        }
    }

    /**
     * Get song details by IDs (for getting cover images)
     */
    async getSongDetail(ids: (number | string)[]): Promise<Song[]> {
        const BATCH_SIZE = 50
        const idSet = new Set(ids.map(String))
        const songMap = new Map<string, Song>()

        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            const batch = ids.slice(i, i + BATCH_SIZE)
            try {
                const c = '[' + batch.map((id) => `{"id":${id}}`).join(',') + ']'
                const res = await this.weapi('/api/v3/song/detail', { c })

                if (res?.body?.songs) {
                    for (const item of res.body.songs) {
                        const songId = String(item.id)
                        if (!idSet.has(songId)) continue
                        songMap.set(songId, this.mapSong(item))
                    }
                }
            } catch (error) {
                console.error('Get song detail batch error:', error)
            }
        }

        // Return songs in the same order as the input IDs
        return ids.map((id) => songMap.get(String(id))).filter((s): s is Song => !!s)
    }

    /**
     * Get artist's hot songs
     */
    async getArtistSongs(
        id: number | string,
        limit: number = 50,
        offset: number = 0,
        order: 'hot' | 'time' = 'hot'
    ): Promise<{ songs: Song[]; total: number }> {
        try {
            const res = await this.eapi('/api/v1/artist/songs', {
                id,
                private_cloud: 'true',
                work_type: 1,
                order,
                offset,
                limit,
            })

            if (res?.body?.code === 200 && res.body.songs) {
                const songIds = res.body.songs.map((item: any) => item.id)
                const total = res.body.total || songIds.length

                // Fetch full song details with covers
                if (songIds.length > 0) {
                    try {
                        const songsWithCovers = await this.getSongDetail(songIds)
                        if (songsWithCovers.length > 0) {
                            return { songs: songsWithCovers, total }
                        }
                    } catch (detailError) {
                        console.error('Failed to get song details, using fallback:', detailError)
                    }
                }

                // Fallback: return songs from artist/songs response
                const songs = res.body.songs.map((item: any) => this.mapSong(item))
                return { songs, total }
            }
            return { songs: [], total: 0 }
        } catch (error) {
            console.error('Get artist songs error:', error)
            return { songs: [], total: 0 }
        }
    }

    /**
     * Get artist's albums
     */
    async getArtistAlbums(
        id: number | string,
        limit: number = 30,
        offset: number = 0
    ): Promise<{ albums: any[]; total: number; hasMore: boolean }> {
        try {
            const res = await this.weapi(`/api/artist/albums/${id}`, {
                limit,
                offset,
                total: true,
            })

            if (res?.body?.code === 200 && res.body.hotAlbums) {
                const albums = res.body.hotAlbums.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    cover: item.picUrl,
                    size: item.size,
                    publishTime: item.publishTime,
                }))
                const total = res.body.artist?.albumSize
                    || res.body.total
                    || (res.body.more ? offset + albums.length + 1 : offset + albums.length)
                const hasMore = typeof res.body.more === 'boolean'
                    ? res.body.more
                    : offset + albums.length < total
                return { albums, total, hasMore }
            }
            return { albums: [], total: 0, hasMore: false }
        } catch (error) {
            console.error('Get artist albums error:', error)
            return { albums: [], total: 0, hasMore: false }
        }
    }

    /**
     * Get artist's MVs
     */
    async getArtistMvs(
        id: number | string,
        limit: number = 30,
        offset: number = 0
    ): Promise<{ mvs: any[]; total: number }> {
        try {
            const res = await this.weapi('/api/artist/mvs', {
                artistId: id,
                limit,
                offset,
                total: true,
            })

            if (res?.body?.code === 200 && res.body.mvs) {
                const mvs = res.body.mvs.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    cover: item.imgurl || item.imgurl16v9,
                    playCount: item.playCount,
                    duration: item.duration,
                    publishTime: item.publishTime,
                }))
                return { mvs, total: res.body.total || mvs.length }
            }
            return { mvs: [], total: 0 }
        } catch (error) {
            console.error('Get artist MVs error:', error)
            return { mvs: [], total: 0 }
        }
    }

    // ==================== 专辑相关 ====================

    /**
     * Get album detail
     */
    async getAlbumDetail(id: number | string): Promise<{ album: any; songs: Song[] } | null> {
        try {
            const res = await this.weapi(`/api/v1/album/${id}`, {})

            if (res?.body?.code === 200 && res.body.album) {
                const album = {
                    id: res.body.album.id,
                    name: res.body.album.name,
                    cover: res.body.album.picUrl,
                    artist: res.body.album.artist?.name || res.body.album.artists?.map((a: any) => a.name).join(', ') || '',
                    artistId: res.body.album.artist?.id,
                    description: res.body.album.description,
                    publishTime: res.body.album.publishTime,
                    size: res.body.album.size,
                    company: res.body.album.company,
                    subType: res.body.album.subType,
                }
                const songs = (res.body.songs || []).map((item: any) => ({
                    ...this.mapSong(item),
                    album: res.body.album.name,
                    albumId: String(res.body.album.id),
                    cover: res.body.album.picUrl,
                }))
                return { album, songs }
            }
            return null
        } catch (error) {
            console.error('Get album detail error:', error)
            return null
        }
    }

    // ==================== 歌单分类 ====================

    /**
     * Get playlist categories
     */
    async getPlaylistCategories(): Promise<{ categories: any; sub: any[] }> {
        try {
            const res = await this.eapi('/api/playlist/catalogue', {})

            if (res?.body?.code === 200) {
                return {
                    categories: res.body.categories || {},
                    sub: res.body.sub || [],
                }
            }
            return { categories: {}, sub: [] }
        } catch (error) {
            console.error('Get playlist categories error:', error)
            return { categories: {}, sub: [] }
        }
    }

    /**
     * Get playlists by category
     */
    async getPlaylistsByCategory(
        cat: string = '全部',
        limit: number = 30,
        offset: number = 0
    ): Promise<{ playlists: any[]; total: number }> {
        try {
            const res = await this.weapi('/api/playlist/list', {
                cat,
                order: 'hot',
                limit,
                offset,
                total: true,
            })

            if (res?.body?.code === 200 && res.body.playlists) {
                const playlists = res.body.playlists.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    cover: item.coverImgUrl,
                    playCount: item.playCount,
                    trackCount: item.trackCount,
                    creator: {
                        userId: item.creator?.userId,
                        nickname: item.creator?.nickname,
                        avatarUrl: item.creator?.avatarUrl,
                    },
                    description: item.description,
                    tags: item.tags,
                }))
                return { playlists, total: res.body.total || playlists.length }
            }
            return { playlists: [], total: 0 }
        } catch (error) {
            console.error('Get playlists by category error:', error)
            return { playlists: [], total: 0 }
        }
    }

    /**
     * Get high quality playlists
     */
    async getHighQualityPlaylists(
        cat: string = '全部',
        limit: number = 30,
        before?: number
    ): Promise<{ playlists: any[]; lasttime: number; more: boolean }> {
        try {
            const res = await this.weapi('/api/playlist/highquality/list', {
                cat,
                limit,
                lasttime: before || 0,
                total: true,
            })

            if (res?.body?.code === 200 && res.body.playlists) {
                const playlists = res.body.playlists.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    cover: item.coverImgUrl,
                    playCount: item.playCount,
                    trackCount: item.trackCount,
                    creator: {
                        userId: item.creator?.userId,
                        nickname: item.creator?.nickname,
                        avatarUrl: item.creator?.avatarUrl,
                    },
                    description: item.description,
                    tags: item.tags,
                    copywriter: item.copywriter,
                }))
                return {
                    playlists,
                    lasttime: res.body.lasttime || 0,
                    more: res.body.more || false,
                }
            }
            return { playlists: [], lasttime: 0, more: false }
        } catch (error) {
            console.error('Get high quality playlists error:', error)
            return { playlists: [], lasttime: 0, more: false }
        }
    }

    // ==================== 心动模式 ====================

    /**
     * Get intelligence/heartbeat mode playlist
     */
    async getIntelligenceList(
        id: number | string,
        pid: number | string,
        sid?: number | string,
        cookie?: string
    ): Promise<Song[]> {
        try {
            const res = await this.eapi('/api/playmode/intelligence/list', {
                songId: id,
                type: 'fromPlayOne',
                playlistId: pid,
                startMusicId: sid || id,
                count: 1,
            }, cookie)

            if (res?.body?.code === 200 && res.body.data) {
                return res.body.data.map((item: any) => {
                    const song = item.songInfo || item
                    return this.mapSong(song)
                })
            }
            return []
        } catch (error) {
            console.error('Get intelligence list error:', error)
            return []
        }
    }

    // ==================== 喜欢歌曲 ====================

    /**
     * Like/unlike a song
     */
    async likeSong(id: number | string, like: boolean = true, cookie?: string): Promise<boolean> {
        try {
            const res = await this.weapi('/api/radio/like', {
                alg: 'itembased',
                trackId: id,
                like,
                time: '3',
            }, cookie)
            return res?.body?.code === 200
        } catch (error) {
            console.error('Like song error:', error)
            return false
        }
    }

    // ==================== 歌单管理 ====================

    /**
     * Create a new playlist
     */
    async createPlaylist(
        name: string,
        privacy: 0 | 10 = 0,
        type: 'NORMAL' | 'VIDEO' | 'SHARED' = 'NORMAL',
        cookie?: string
    ): Promise<{ id: number; name: string } | null> {
        try {
            const res = await this.weapi('/api/playlist/create', {
                name,
                privacy: String(privacy),
                type,
            }, cookie)

            if (res?.body?.code === 200 && res.body.playlist) {
                return {
                    id: res.body.playlist.id,
                    name: res.body.playlist.name,
                }
            }
            return null
        } catch (error) {
            console.error('Create playlist error:', error)
            return null
        }
    }

    /**
     * Delete a playlist
     */
    async deletePlaylist(id: number | string, cookie?: string): Promise<boolean> {
        try {
            const res = await this.weapi('/api/playlist/remove', {
                ids: `[${id}]`,
            }, cookie)
            return res?.body?.code === 200
        } catch (error) {
            console.error('Delete playlist error:', error)
            return false
        }
    }

    /**
     * Update playlist info
     */
    async updatePlaylist(
        id: number | string,
        name: string,
        desc?: string,
        tags?: string,
        cookie?: string
    ): Promise<boolean> {
        try {
            const res = await this.eapi('/api/batch', {
                '/api/playlist/desc/update': JSON.stringify({ id, desc: desc || '' }),
                '/api/playlist/tags/update': JSON.stringify({ id, tags: tags || '' }),
                '/api/playlist/update/name': JSON.stringify({ id, name }),
            }, cookie)
            return res?.body?.code === 200
        } catch (error) {
            console.error('Update playlist error:', error)
            return false
        }
    }

    /**
     * Make private playlist public
     */
    async makePlaylistPublic(id: number | string, cookie?: string): Promise<boolean> {
        try {
            const res = await this.eapi('/api/playlist/update/privacy', {
                id,
                privacy: 0,
            }, cookie)
            return res?.body?.code === 200
        } catch (error) {
            console.error('Make playlist public error:', error)
            return false
        }
    }

    /**
     * Add or remove tracks from playlist
     */
    async updatePlaylistTracks(
        pid: number | string,
        tracks: (number | string)[] | string,
        op: 'add' | 'del',
        cookie?: string
    ): Promise<boolean> {
        try {
            const trackIds = Array.isArray(tracks) ? tracks : String(tracks).split(',')
            const res = await this.eapi('/api/playlist/manipulate/tracks', {
                op,
                pid,
                trackIds: JSON.stringify(trackIds),
                imme: 'true',
            }, cookie)

            // Clear cache for this playlist
            this.clearPlaylistCache(Number(pid))

            return res?.body?.code === 200
        } catch (error) {
            console.error('Update playlist tracks error:', error)
            return false
        }
    }

    // ==================== 副歌时间 ====================

    /**
     * Get song chorus/highlight time points
     */
    async getSongChorus(id: number | string): Promise<{ startTime: number; endTime: number }[]> {
        try {
            const res = await this.eapi('/api/song/chorus', {
                ids: JSON.stringify([id]),
            })

            if (res?.body?.code === 200 && res.body.chorus) {
                return res.body.chorus.map((item: any) => ({
                    startTime: item.startTime || item.start || 0,
                    endTime: item.endTime || item.end || 0,
                }))
            }
            return []
        } catch (error) {
            console.error('Get song chorus error:', error)
            return []
        }
    }
}

// Comment type constants
export const NETEASE_COMMENT_TYPES = {
    SONG: 0,
    MV: 1,
    PLAYLIST: 2,
    ALBUM: 3,
    RADIO_PROGRAM: 4,
    VIDEO: 5,
    DYNAMIC: 6,
    RADIO: 7,
} as const

// Search type constants
export const NETEASE_SEARCH_TYPES = {
    SONG: 1,
    ALBUM: 10,
    ARTIST: 100,
    PLAYLIST: 1000,
    USER: 1002,
    MV: 1004,
    LYRIC: 1006,
    RADIO: 1009,
    VIDEO: 1014,
    COMPOSITE: 1018,
    SOUND: 2000,
} as const

const neteaseAuthApi = new NeteaseAuthAPI()
export { neteaseAuthApi }
export default neteaseAuthApi
