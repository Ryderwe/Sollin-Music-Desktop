import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar, ListMusic, Play, ChevronRight, RefreshCw, Plus, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import neteaseAuthApi from '@/services/neteaseAuth'
import CoverImage from '@/components/ui/CoverImage'
import type { Song } from '@/types'

export default function UserSection() {
    const navigate = useNavigate()
    const {
        isLoggedIn,
        userData,
        cookie,
        dailyRecommend,
        userPlaylists,
        setDailyRecommend,
        setUserPlaylists,
    } = useAuthStore()
    const { playSong, setPlaylist } = usePlayerStore()
    const { addToast } = useUIStore()

    // 创建歌单状态
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [newPlaylistName, setNewPlaylistName] = useState('')
    const [isPrivate, setIsPrivate] = useState(false)
    const [isCreating, setIsCreating] = useState(false)

    if (!isLoggedIn || !userData) {
        return null
    }

    const today = new Date()
    const day = today.getDate()

    // Get first few songs for daily recommend preview
    const previewSongs = (dailyRecommend.songs as Song[]).slice(0, 4)

    // Get user's own playlists (created by them, not subscribed)
    const ownPlaylists = userPlaylists.playlists.filter(
        (p: any) => p.creator?.userId === userData.userId
    ).slice(0, 6)

    const handlePlayDaily = () => {
        const songs = dailyRecommend.songs as Song[]
        if (songs.length > 0) {
            setPlaylist(songs, 'daily-recommend')
            playSong(songs[0], songs)
        }
    }

    const handleRefresh = async () => {
        if (!cookie) return

        try {
            addToast({ type: 'info', message: '正在刷新数据...' })

            // Refresh daily recommend
            const songs = await neteaseAuthApi.getDailyRecommend(cookie)
            setDailyRecommend({
                timestamp: Date.now(),
                songs,
            })

            // Refresh playlists
            const playlists = await neteaseAuthApi.getUserPlaylist(userData.userId, cookie)
            setUserPlaylists({
                userId: userData.userId,
                playlists,
                lastUpdated: Date.now(),
            })

            addToast({ type: 'success', message: '数据已刷新' })
        } catch (error) {
            console.error('Refresh error:', error)
            addToast({ type: 'error', message: '刷新失败' })
        }
    }

    // 创建歌单
    const handleCreatePlaylist = async () => {
        if (!cookie || !newPlaylistName.trim()) return

        setIsCreating(true)
        try {
            const result = await neteaseAuthApi.createPlaylist(
                newPlaylistName.trim(),
                isPrivate ? 10 : 0,
                'NORMAL',
                cookie
            )
            if (result) {
                addToast({ type: 'success', message: '歌单创建成功' })
                setShowCreateModal(false)
                setNewPlaylistName('')
                setIsPrivate(false)
                // 刷新歌单列表
                const playlists = await neteaseAuthApi.getUserPlaylist(userData.userId, cookie)
                setUserPlaylists({
                    userId: userData.userId,
                    playlists,
                    lastUpdated: Date.now(),
                })
            } else {
                addToast({ type: 'error', message: '创建失败' })
            }
        } catch (error) {
            console.error('Create playlist error:', error)
            addToast({ type: 'error', message: '创建失败' })
        } finally {
            setIsCreating(false)
        }
    }

    return (
        <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
        >
            {/* Section header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    {userData.avatarUrl ? (
                        <img
                            src={userData.avatarUrl}
                            alt={userData.nickname}
                            className="w-10 h-10 rounded-full object-cover"
                        />
                    ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-pink-500" />
                    )}
                    <div>
                        <h2 className="text-lg font-bold">{userData.nickname}</h2>
                        <p className="text-xs text-[var(--text-muted)]">小芸音乐</p>
                    </div>
                </div>
                <button
                    onClick={handleRefresh}
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    title="刷新"
                >
                    <RefreshCw className="w-4 h-4 text-[var(--text-muted)]" />
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Daily Recommend Card */}
                <motion.div
                    whileHover={{ scale: 1.02 }}
                    className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-500 to-pink-500 p-5 cursor-pointer group"
                    onClick={() => navigate('/daily-recommend')}
                >
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <div className="flex flex-col items-center justify-center bg-white/20 rounded-lg w-10 h-10">
                                    <Calendar className="w-4 h-4 text-white/80" />
                                    <span className="text-xs font-bold text-white">{day}</span>
                                </div>
                                <div>
                                    <h3 className="text-white font-bold text-lg">每日推荐</h3>
                                    <p className="text-white/70 text-xs">
                                        {dailyRecommend.songs.length} 首 · 每日更新
                                    </p>
                                </div>
                            </div>

                            {/* Preview song names */}
                            {previewSongs.length > 0 && (
                                <div className="mt-3 space-y-1">
                                    {previewSongs.map((song, i) => (
                                        <p key={i} className="text-white/60 text-xs truncate max-w-[200px]">
                                            {song.name} - {song.artist}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                handlePlayDaily()
                            }}
                            className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
                        >
                            <Play className="w-6 h-6 text-white" fill="white" />
                        </button>
                    </div>

                    <ChevronRight className="absolute right-4 bottom-4 w-5 h-5 text-white/50 group-hover:text-white/80 transition-colors" />
                </motion.div>

                {/* User Playlists Preview */}
                <div className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-bold flex items-center gap-2">
                            <ListMusic className="w-4 h-4" />
                            我的歌单
                        </h3>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="text-xs text-primary-500 hover:text-primary-600 flex items-center gap-1"
                                title="新建歌单"
                            >
                                <Plus className="w-4 h-4" />
                                新建
                            </button>
                            <button
                                onClick={() => navigate('/library')}
                                className="text-xs text-primary-500 hover:text-primary-600 flex items-center gap-1"
                            >
                                查看全部
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {ownPlaylists.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                            {ownPlaylists.map((playlist: any) => (
                                <motion.div
                                    key={playlist.id}
                                    whileHover={{ scale: 1.05 }}
                                    className="cursor-pointer"
                                    onClick={() => navigate(`/netease-playlist/${playlist.id}`)}
                                >
                                    <CoverImage
                                        src={playlist.cover}
                                        alt={playlist.name}
                                        className="w-full aspect-square rounded-xl"
                                    />
                                    <p className="text-xs mt-1 truncate">{playlist.name}</p>
                                    <p className="text-xs text-[var(--text-muted)]">{playlist.trackCount} 首</p>
                                </motion.div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-4">
                            <p className="text-sm text-[var(--text-muted)] mb-2">暂无歌单</p>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="text-sm text-primary-500 hover:text-primary-600 flex items-center gap-1 mx-auto"
                            >
                                <Plus className="w-4 h-4" />
                                创建第一个歌单
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* 创建歌单弹窗 */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold">新建歌单</h2>
                            <button
                                onClick={() => setShowCreateModal(false)}
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
                                    value={newPlaylistName}
                                    onChange={(e) => setNewPlaylistName(e.target.value)}
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    placeholder="输入歌单名称"
                                    autoFocus
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setIsPrivate(!isPrivate)}
                                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                        isPrivate
                                            ? 'bg-primary-500 border-primary-500 text-white'
                                            : 'border-gray-300 dark:border-gray-600'
                                    }`}
                                >
                                    {isPrivate && (
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
                                <span className="text-sm">设为私密歌单</span>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCreatePlaylist}
                                disabled={isCreating || !newPlaylistName.trim()}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
                            >
                                {isCreating ? '创建中...' : '创建'}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </motion.section>
    )
}
