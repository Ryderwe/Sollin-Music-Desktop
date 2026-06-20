import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, RefreshCw, Calendar, ArrowLeft } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import neteaseAuthApi from '@/services/neteaseAuth'
import SongRow from '@/components/SongRow'
import type { Song } from '@/types'

export default function DailyRecommend() {
    const navigate = useNavigate()
    const { isLoggedIn, cookie, dailyRecommend, setDailyRecommend } = useAuthStore()
    const { playSong, setPlaylist } = usePlayerStore()
    const { addToast, setShowAuthModal } = useUIStore()

    // Check login status
    useEffect(() => {
        if (!isLoggedIn) {
            addToast({ type: 'warning', message: '请先登录' })
            setShowAuthModal(true)
            navigate('/')
        }
    }, [isLoggedIn, navigate, addToast, setShowAuthModal])

    // Get today's date
    const today = new Date()
    const day = today.getDate()
    const month = today.getMonth() + 1

    // Format last update time
    const lastUpdate = dailyRecommend.timestamp
        ? new Date(dailyRecommend.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
        })
        : null

    const handleRefresh = async () => {
        if (!cookie) return

        try {
            addToast({ type: 'info', message: '正在刷新每日推荐...' })
            const songs = await neteaseAuthApi.getDailyRecommend(cookie)
            setDailyRecommend({
                timestamp: Date.now(),
                songs,
            })
            addToast({ type: 'success', message: '每日推荐已更新' })
        } catch (error) {
            console.error('Refresh daily recommend error:', error)
            addToast({ type: 'error', message: '刷新失败' })
        }
    }

    const handlePlayAll = () => {
        const songs = dailyRecommend.songs as Song[]
        if (songs.length > 0) {
            setPlaylist(songs, 'daily-recommend')
            playSong(songs[0], songs)
        }
    }

    if (!isLoggedIn) {
        return null
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                {/* Back button */}
                <button
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    返回
                </button>

                <div className="flex items-center gap-6">
                    {/* Calendar icon with date */}
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-red-500 to-pink-500 flex flex-col items-center justify-center text-white shadow-lg">
                        <Calendar className="w-6 h-6 mb-1" />
                        <span className="text-3xl font-bold">{day}</span>
                        <span className="text-xs opacity-80">{month}月</span>
                    </div>

                    <div className="flex-1">
                        <h1 className="text-3xl font-bold mb-1">每日推荐</h1>
                        <p className="text-[var(--text-muted)]">
                            根据你的音乐口味 · 每日 6:00 更新
                        </p>
                        {lastUpdate && (
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                上次更新: {lastUpdate}
                            </p>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleRefresh}
                            className="btn-icon"
                            title="刷新"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                            onClick={handlePlayAll}
                            disabled={dailyRecommend.songs.length === 0}
                            className="btn-primary gap-1.5"
                        >
                            <Play className="w-4 h-4" />
                            播放全部
                        </button>
                    </div>
                </div>
            </div>

            {/* Song list */}
            {dailyRecommend.songs.length > 0 ? (
                <div className="space-y-1">
                    {(dailyRecommend.songs as Song[]).map((song, index) => (
                        <SongRow
                            key={`${song.id}-${song.platform}`}
                            song={song}
                            index={index}
                            playlist={dailyRecommend.songs as Song[]}
                            playlistId="daily-recommend"
                            showPlatform={false}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <Calendar className="w-16 h-16 mx-auto mb-4 text-[var(--text-muted)]" />
                        <p className="text-[var(--text-muted)]">暂无每日推荐</p>
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
        </div>
    )
}
