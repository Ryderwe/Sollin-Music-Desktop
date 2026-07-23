import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
    Play,
    RefreshCw,
    ArrowLeft,
    Music,
    Heart,
    Sparkles,
    MoreHorizontal,
    Pencil,
    Trash2,
    Globe,
    X,
    Search,
} from 'lucide-react'
import ExpandableSearch from '@/components/ui/ExpandableSearch'
import { motion } from 'framer-motion'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useAuthStore } from '@/stores/authStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import { useUserStore } from '@/stores/userStore'
import { usePaginatedSongs } from '@/hooks/usePaginatedSongs'
import neteaseAuthApi from '@/services/neteaseAuth'
import SongRow from '@/components/SongRow'
import VirtualSongList from '@/components/VirtualSongList'
import CoverImage from '@/components/ui/CoverImage'
import type { Platform } from '@/types'

export default function NeteasePlaylistDetail() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { isLoggedIn, cookie, userPlaylists } = useAuthStore()
    const { playSong, setPlaylist } = usePlayerStore()
    const { addToast, setShowAuthModal } = useUIStore()
    const { upsertOnlinePlaylist } = useUserStore()

    const [playlistInfo, setPlaylistInfo] = useState<any>(null)
    const [apiPlaylistInfo, setApiPlaylistInfo] = useState<any>(null)
    const [isIntelligenceMode, setIsIntelligenceMode] = useState(false)
    const [intelligenceLoading, setIntelligenceLoading] = useState(false)

    // 歌单管理状态
    const [showEditModal, setShowEditModal] = useState(false)
    const [editName, setEditName] = useState('')
    const [editDesc, setEditDesc] = useState('')
    const [isEditing, setIsEditing] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [selectedSongs, setSelectedSongs] = useState<Set<string>>(new Set())
    const [isSelectMode, setIsSelectMode] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    // Find playlist info from userPlaylists
    useEffect(() => {
        if (id && userPlaylists.playlists.length > 0) {
            const found = userPlaylists.playlists.find((p: any) => String(p.id) === id)
            if (found) {
                setPlaylistInfo(found)
                setEditName(found.name || '')
                setEditDesc(found.description || '')
            }
        }
    }, [id, userPlaylists.playlists])

    // Fetch playlist info from API as fallback
    useEffect(() => {
        if (!id || !cookie || !isLoggedIn) return
        neteaseAuthApi.getPlaylistInfo(Number(id), cookie).then((info) => {
            if (info) setApiPlaylistInfo(info)
        })
    }, [id, cookie, isLoggedIn])

    const isOwnPlaylist = playlistInfo?.creator?.userId === userPlaylists.userId
    const displayName = playlistInfo?.name || apiPlaylistInfo?.name || ''
    const displayCover = playlistInfo?.cover || apiPlaylistInfo?.cover || ''
    const displayDescription = playlistInfo?.description || apiPlaylistInfo?.description || ''
    const displayCreator = playlistInfo?.creator || apiPlaylistInfo?.creator

    useEffect(() => {
        if (!isLoggedIn) {
            addToast({ type: 'warning', message: '请先登录' })
            setShowAuthModal(true)
            navigate('/')
        }
    }, [isLoggedIn, navigate, addToast, setShowAuthModal])

    const fetcher = useCallback(async (page: number) => {
        const offset = (page - 1) * 500
        return neteaseAuthApi.getPlaylistDetailPage(Number(id), cookie ?? undefined, 500, offset)
    }, [id, cookie])

    const {
        visibleSongs: songs,
        allApiSongs,
        apiTotal,
        isLoading,
        hasMore,
        sentinelRef,
        loadInitial,
        reset: resetSongs,
    } = usePaginatedSongs({ fetcher, enabled: !!id && !!cookie && isLoggedIn, batchSize: 500 })

    const displayTrackCount = apiPlaylistInfo?.trackCount || apiTotal || allApiSongs.length

    useEffect(() => {
        if (!id || !cookie || !isLoggedIn) return
        loadInitial()
    }, [id, cookie, isLoggedIn, loadInitial])

    const handleRefresh = async () => {
        if (!id || !cookie) return

        try {
            addToast({ type: 'info', message: '正在刷新歌单...' })
            await resetSongs()
            addToast({ type: 'success', message: '歌单已刷新' })
        } catch (error) {
            console.error('Refresh playlist error:', error)
            addToast({ type: 'error', message: '刷新失败' })
        }
    }

    const handlePlayAll = () => {
        if (allApiSongs.length > 0) {
            setIsIntelligenceMode(false)
            const name = displayName || '网易云歌单'
            setPlaylist(allApiSongs, `netease-playlist-${id}`, name)
            playSong(allApiSongs[0], allApiSongs, `netease-playlist-${id}`, undefined, name)
        }
    }

    const handleCollectPlaylist = () => {
        if (allApiSongs.length === 0) {
            addToast({ type: 'warning', message: '歌单暂无歌曲' })
            return
        }
        upsertOnlinePlaylist({
            id: `netease_${id}`,
            sourceId: String(id),
            source: 'netease',
            name: displayName || '未知歌单',
            description: displayDescription,
            author: displayCreator?.nickname || '',
            cover: displayCover || allApiSongs[0]?.cover || '',
            songs: allApiSongs.map((s) => ({
                id: s.id,
                name: s.name,
                artist: s.artist,
                album: s.album,
                duration: s.duration,
                cover: s.cover,
                platform: (s.platform === 'local' ? 'netease' : s.platform) as Platform,
                types: s.lx?.types?.map((t: any) => t.type) ?? [],
            })),
            songCount: allApiSongs.length,
            importedAt: new Date().toISOString(),
            autoUpdate: true,
        })
        addToast({ type: 'success', message: '已收藏为在线歌单' })
    }

    const handleIntelligenceMode = async () => {
        if (allApiSongs.length === 0 || !id || !cookie) return

        setIntelligenceLoading(true)
        try {
            const seedSong = allApiSongs[0]
            const intelligenceSongs = await neteaseAuthApi.getIntelligenceList(
                seedSong.id,
                id,
                undefined,
                cookie
            )

            if (intelligenceSongs.length > 0) {
                const playlist = [seedSong, ...intelligenceSongs]
                setIsIntelligenceMode(true)
                setPlaylist(playlist, `netease-intelligence-${id}`, '心动模式')
                playSong(seedSong, playlist, `netease-intelligence-${id}`, undefined, '心动模式')
                addToast({ type: 'success', message: '已开启心动模式 💗' })
            } else {
                addToast({ type: 'warning', message: '暂无推荐歌曲' })
            }
        } catch (error) {
            console.error('Intelligence mode error:', error)
            addToast({ type: 'error', message: '心动模式启动失败' })
        } finally {
            setIntelligenceLoading(false)
        }
    }

    const handleEditPlaylist = async () => {
        if (!id || !cookie || !editName.trim()) return

        setIsEditing(true)
        try {
            const success = await neteaseAuthApi.updatePlaylist(id, editName.trim(), editDesc, undefined, cookie)
            if (success) {
                addToast({ type: 'success', message: '歌单信息已更新' })
                setShowEditModal(false)
                setPlaylistInfo((prev: any) => ({
                    ...prev,
                    name: editName.trim(),
                    description: editDesc,
                }))
                useAuthStore.getState().refreshUserPlaylists()
            } else {
                addToast({ type: 'error', message: '更新失败' })
            }
        } catch (error) {
            console.error('Edit playlist error:', error)
            addToast({ type: 'error', message: '更新失败' })
        } finally {
            setIsEditing(false)
        }
    }

    const handleDeletePlaylist = async () => {
        if (!id || !cookie) return

        if (!confirm('确定要删除这个歌单吗？此操作不可恢复。')) return

        setIsDeleting(true)
        try {
            const success = await neteaseAuthApi.deletePlaylist(id, cookie)
            if (success) {
                addToast({ type: 'success', message: '歌单已删除' })
                useAuthStore.getState().refreshUserPlaylists()
                navigate(-1)
            } else {
                addToast({ type: 'error', message: '删除失败' })
            }
        } catch (error) {
            console.error('Delete playlist error:', error)
            addToast({ type: 'error', message: '删除失败' })
        } finally {
            setIsDeleting(false)
        }
    }

    const handleMakePublic = async () => {
        if (!id || !cookie) return

        try {
            const success = await neteaseAuthApi.makePlaylistPublic(id, cookie)
            if (success) {
                addToast({ type: 'success', message: '歌单已公开' })
            } else {
                addToast({ type: 'error', message: '操作失败' })
            }
        } catch (error) {
            console.error('Make public error:', error)
            addToast({ type: 'error', message: '操作失败' })
        }
    }

    const handleRemoveSelectedSongs = async () => {
        if (!id || !cookie || selectedSongs.size === 0) return

        if (!confirm(`确定要从歌单中移除 ${selectedSongs.size} 首歌曲吗？`)) return

        try {
            const trackIds = Array.from(selectedSongs)
            const success = await neteaseAuthApi.updatePlaylistTracks(id, trackIds, 'del', cookie)
            if (success) {
                addToast({ type: 'success', message: `已移除 ${selectedSongs.size} 首歌曲` })
                setSelectedSongs(new Set())
                setIsSelectMode(false)
                await resetSongs()
            } else {
                addToast({ type: 'error', message: '移除失败' })
            }
        } catch (error) {
            console.error('Remove songs error:', error)
            addToast({ type: 'error', message: '移除失败' })
        }
    }

    const toggleSongSelection = (songId: string) => {
        setSelectedSongs((prev) => {
            const newSet = new Set(prev)
            if (newSet.has(songId)) {
                newSet.delete(songId)
            } else {
                newSet.add(songId)
            }
            return newSet
        })
    }

    const filteredSongs = useMemo(() => {
        if (!searchQuery.trim()) return songs

        const query = searchQuery.toLowerCase().trim()
        return songs.filter(song =>
            song.name.toLowerCase().includes(query) ||
            song.artist.toLowerCase().includes(query)
        )
    }, [songs, searchQuery])

    const toggleSelectAll = () => {
        if (selectedSongs.size === allApiSongs.length) {
            setSelectedSongs(new Set())
        } else {
            setSelectedSongs(new Set(allApiSongs.map((s) => s.id)))
        }
    }

    if (!isLoggedIn) {
        return null
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex-shrink-0 mb-6">
                <button
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    返回
                </button>

                <div className="flex items-center gap-6">
                    <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gradient-to-br from-red-500 to-pink-500 flex-shrink-0 shadow-lg">
                        {displayCover ? (
                            <CoverImage
                                src={displayCover}
                                alt={displayName}
                                className="w-full h-full"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <Music className="w-10 h-10 text-white" />
                            </div>
                        )}
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3 mb-1">
                            <h1 className="text-3xl font-bold min-w-0 truncate">
                                {displayName || '未知歌单'}
                            </h1>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                <button
                                    onClick={handlePlayAll}
                                    disabled={allApiSongs.length === 0 || isLoading}
                                    className="btn-primary gap-1.5"
                                >
                                    <Play className="w-4 h-4" />
                                    播放
                                </button>
                                <button
                                    onClick={handleRefresh}
                                    disabled={isLoading}
                                    className="btn-icon"
                                    title="刷新"
                                >
                                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                </button>
                                {allApiSongs.length > 0 && (
                                    <ExpandableSearch value={searchQuery} onChange={setSearchQuery} />
                                )}
                                {isOwnPlaylist && (
                                    <DropdownMenu.Root>
                                        <DropdownMenu.Trigger asChild>
                                            <button className="btn-icon">
                                                <MoreHorizontal className="w-4 h-4" />
                                            </button>
                                        </DropdownMenu.Trigger>
                                        <DropdownMenu.Portal>
                                            <DropdownMenu.Content
                                                className="min-w-[160px] bg-white dark:bg-gray-800 rounded-xl p-1.5 shadow-xl border border-gray-200 dark:border-gray-700 z-50"
                                                sideOffset={8}
                                                align="end"
                                            >
                                                <DropdownMenu.Item
                                                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                                                    onSelect={() => setShowEditModal(true)}
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                    编辑歌单
                                                </DropdownMenu.Item>
                                                <DropdownMenu.Item
                                                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                                                    onSelect={() => setIsSelectMode(!isSelectMode)}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                    {isSelectMode ? '取消选择' : '管理歌曲'}
                                                </DropdownMenu.Item>
                                                <DropdownMenu.Item
                                                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                                                    onSelect={handleMakePublic}
                                                >
                                                    <Globe className="w-4 h-4" />
                                                    公开歌单
                                                </DropdownMenu.Item>
                                                <DropdownMenu.Separator className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
                                                <DropdownMenu.Item
                                                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 outline-none"
                                                    onSelect={handleDeletePlaylist}
                                                    disabled={isDeleting}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                    {isDeleting ? '删除中...' : '删除歌单'}
                                                </DropdownMenu.Item>
                                            </DropdownMenu.Content>
                                        </DropdownMenu.Portal>
                                    </DropdownMenu.Root>
                                )}
                            </div>
                        </div>
                        <p className="text-[var(--text-muted)]">
                            {displayTrackCount} 首歌曲
                            {displayCreator?.nickname && (
                                <span> · 创建者: {displayCreator.nickname}</span>
                            )}
                        </p>
                        {displayDescription && (
                            <p className="text-sm text-[var(--text-muted)] mt-1 line-clamp-2">
                                {displayDescription}
                            </p>
                        )}
                        <div className="flex items-center gap-2 mt-3">
                            <button
                                onClick={handleIntelligenceMode}
                                disabled={allApiSongs.length === 0 || isLoading || intelligenceLoading}
                                className={`btn-secondary gap-1.5 ${
                                    isIntelligenceMode
                                        ? 'bg-pink-500 text-white hover:bg-pink-600'
                                        : 'text-pink-600 dark:text-pink-400'
                                } disabled:opacity-50`}
                                title="心动模式"
                            >
                                {intelligenceLoading ? (
                                    <Sparkles className="w-4 h-4 animate-pulse" />
                                ) : (
                                    <Heart className={`w-4 h-4 ${isIntelligenceMode ? 'fill-white' : ''}`} />
                                )}
                                心动模式
                            </button>
                            <button
                                onClick={handleCollectPlaylist}
                                disabled={allApiSongs.length === 0 || isLoading}
                                className="btn-secondary gap-1.5 disabled:opacity-50"
                            >
                                <Heart className="w-4 h-4" />
                                收藏歌单
                            </button>
                        </div>
                    </div>
                </div>

                {isSelectMode && (
                    <div className="flex items-center gap-4 mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-xl">
                        <button
                            onClick={toggleSelectAll}
                            className="text-sm text-primary-500 hover:text-primary-600"
                        >
                            {selectedSongs.size === allApiSongs.length ? '取消全选' : '全选'}
                        </button>
                        <span className="text-sm text-[var(--text-muted)]">
                            已选择 {selectedSongs.size} 首歌曲
                        </span>
                        <div className="flex-1" />
                        <button
                            onClick={handleRemoveSelectedSongs}
                            disabled={selectedSongs.size === 0}
                            className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                            <Trash2 className="w-4 h-4" />
                            移除选中
                        </button>
                        <button
                            onClick={() => {
                                setIsSelectMode(false)
                                setSelectedSongs(new Set())
                            }}
                            className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>

            {/* Song list */}
            {isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
            ) : allApiSongs.length > 0 ? (
                <div>
                    {filteredSongs.length > 0 ? (
                        <VirtualSongList
                            songs={filteredSongs}
                            playlist={songs}
                            playlistId={`netease-playlist-${id}`}
                            playlistName={displayName || undefined}
                            showPlatform={false}
                            scrollable={false}
                            footer={hasMore && !searchQuery ? (
                                <div ref={sentinelRef} className="min-h-16 flex items-center justify-center">
                                    <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : undefined}
                            renderRow={(song, index) => (
                                <div className="flex items-center gap-2">
                                    {isSelectMode && (
                                        <button
                                            onClick={() => toggleSongSelection(song.id)}
                                            className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                                selectedSongs.has(song.id)
                                                    ? 'bg-primary-500 border-primary-500 text-white'
                                                    : 'border-gray-300 dark:border-gray-600 hover:border-primary-500'
                                            }`}
                                        >
                                            {selectedSongs.has(song.id) && (
                                                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                                                    <path
                                                        d="M2 6L5 9L10 3"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
                                            )}
                                        </button>
                                    )}
                                    <div className="flex-1">
                                        <SongRow
                                            song={song}
                                            index={index}
                                            playlist={songs}
                                            playlistId={`netease-playlist-${id}`}
                                            playlistName={displayName || undefined}
                                            showPlatform={false}
                                        />
                                    </div>
                                </div>
                            )}
                        />
                    ) : (
                        <div className="flex-1 flex items-center justify-center py-12">
                            <div className="text-center">
                                <Search className="w-12 h-12 mx-auto mb-3 text-[var(--text-muted)]" />
                                <p className="text-[var(--text-muted)]">没有找到匹配的歌曲</p>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <Music className="w-16 h-16 mx-auto mb-4 text-[var(--text-muted)]" />
                        <p className="text-[var(--text-muted)]">歌单为空</p>
                        <button
                            onClick={handleRefresh}
                            className="mt-4 text-primary-500 hover:text-primary-600 flex items-center gap-2 mx-auto"
                        >
                            <RefreshCw className="w-4 h-4" />
                            点击刷新
                        </button>
                    </div>
                </div>
            )}

            {showEditModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold">编辑歌单</h2>
                            <button
                                onClick={() => setShowEditModal(false)}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">歌单名称</label>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    placeholder="输入歌单名称"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">歌单简介</label>
                                <textarea
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    rows={3}
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                                    placeholder="输入歌单简介（可选）"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowEditModal(false)}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleEditPlaylist}
                                disabled={isEditing || !editName.trim()}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
                            >
                                {isEditing ? '保存中...' : '保存'}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    )
}
