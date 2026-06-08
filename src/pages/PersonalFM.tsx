import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Radio, Play, Pause, SkipForward, ThumbsDown, Heart, Loader2, ArrowLeft } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import neteaseAuthApi from '@/services/neteaseAuth'
import CoverImage from '@/components/ui/CoverImage'
import { isSamePlayableSong } from '@/utils/songIdentity'
import type { Song } from '@/types'

export default function PersonalFM() {
    const navigate = useNavigate()
    const { isLoggedIn, cookie, userData } = useAuthStore()
    const { currentSong, isPlaying, playSong, togglePlay, isLoading: playerLoading } = usePlayerStore()
    const { addToast, setShowAuthModal } = useUIStore()

    const [fmSongs, setFmSongs] = useState<Song[]>([])
    const [currentIndex, setCurrentIndex] = useState(0)
    const [isLoading, setIsLoading] = useState(true)
    const [likedIds, setLikedIds] = useState<Set<number>>(new Set())

    const currentFmSong = fmSongs[currentIndex]

    // Check login
    useEffect(() => {
        if (!isLoggedIn) {
            addToast({ type: 'warning', message: '请先登录小芸账号' })
            setShowAuthModal(true)
            navigate('/')
        }
    }, [isLoggedIn, navigate, addToast, setShowAuthModal])

    // Load FM songs
    const loadFmSongs = useCallback(async () => {
        if (!cookie) return
        setIsLoading(true)
        try {
            const songs = await neteaseAuthApi.getPersonalFM(cookie)
            if (songs.length > 0) {
                setFmSongs(prev => [...prev, ...songs])
            }
        } catch (error) {
            console.error('Load FM error:', error)
            addToast({ type: 'error', message: '加载私人FM失败' })
        } finally {
            setIsLoading(false)
        }
    }, [cookie, addToast])

    // Load liked list
    const loadLikedList = useCallback(async () => {
        if (!cookie || !userData?.userId) return
        try {
            const ids = await neteaseAuthApi.getLikelist(userData.userId, cookie)
            setLikedIds(new Set(ids))
        } catch (error) {
            console.error('Load liked list error:', error)
        }
    }, [cookie, userData?.userId])

    // Initial load
    useEffect(() => {
        if (isLoggedIn && cookie) {
            loadFmSongs()
            loadLikedList()
        }
    }, [isLoggedIn, cookie, loadFmSongs, loadLikedList])

    // Play current FM song
    const playCurrentSong = useCallback(() => {
        if (currentFmSong) {
            playSong(currentFmSong, fmSongs.slice(currentIndex), 'personal-fm')
        }
    }, [currentFmSong, fmSongs, currentIndex, playSong])

    // Next song
    const nextSong = useCallback(async () => {
        if (currentIndex >= fmSongs.length - 2) {
            // Load more songs when near the end
            await loadFmSongs()
        }
        setCurrentIndex(prev => prev + 1)
    }, [currentIndex, fmSongs.length, loadFmSongs])

    // Auto play when index changes
    useEffect(() => {
        if (currentFmSong && fmSongs.length > 0) {
            playCurrentSong()
        }
    }, [currentIndex])

    // Trash (dislike) song
    const trashSong = async () => {
        if (!currentFmSong || !cookie) return
        try {
            await neteaseAuthApi.fmTrash(currentFmSong.id, cookie)
            addToast({ type: 'success', message: '已移至垃圾桶，将减少类似推荐' })
            nextSong()
        } catch (error) {
            addToast({ type: 'error', message: '操作失败' })
        }
    }

    // Like/unlike song
    const toggleLike = async () => {
        if (!currentFmSong || !cookie) return
        const songId = Number(currentFmSong.id)
        const isLiked = likedIds.has(songId)

        try {
            const success = await neteaseAuthApi.likeSong(songId, !isLiked, cookie)
            if (success) {
                setLikedIds(prev => {
                    const newSet = new Set(prev)
                    if (isLiked) {
                        newSet.delete(songId)
                    } else {
                        newSet.add(songId)
                    }
                    return newSet
                })
                addToast({ type: 'success', message: isLiked ? '已取消喜欢' : '已添加到喜欢' })
            }
        } catch (error) {
            addToast({ type: 'error', message: '操作失败' })
        }
    }

    const isCurrentSongLiked = currentFmSong ? likedIds.has(Number(currentFmSong.id)) : false
    const isCurrentFmSong = isSamePlayableSong(currentSong, currentFmSong)
    const isCurrentPlaying = isCurrentFmSong && isPlaying

    if (!isLoggedIn) return null

    return (
        <div className="h-full flex flex-col">
            {/* Back button */}
            <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-4 transition-colors self-start"
            >
                <ArrowLeft className="w-5 h-5" />
                <span>返回</span>
            </button>

            <div className="flex-1 flex flex-col items-center justify-center">
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center gap-2 mb-2">
                        <Radio className="w-6 h-6 text-red-500" />
                        <h1 className="text-2xl font-bold">私人FM</h1>
                </div>
                <p className="text-[var(--text-muted)]">根据你的口味生成，{userData?.nickname}</p>
            </div>

            {isLoading && fmSongs.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-red-500" />
                </div>
            ) : currentFmSong ? (
                <div className="flex flex-col items-center">
                    {/* Album cover */}
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentFmSong.id}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="relative mb-6"
                        >
                            <div className="w-72 h-72 rounded-2xl overflow-hidden shadow-2xl">
                                <CoverImage
                                    src={currentFmSong.cover}
                                    alt={currentFmSong.name}
                                    className="w-full h-full"
                                />
                            </div>
                            {/* Playing indicator */}
                            {isCurrentPlaying && (
                                <div className="absolute bottom-4 right-4 bg-black/60 rounded-full p-2">
                                    <div className="flex gap-0.5">
                                        <span className="w-1 h-4 bg-red-500 rounded-full animate-pulse" />
                                        <span className="w-1 h-5 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                                        <span className="w-1 h-3 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>

                    {/* Song info */}
                    <motion.div
                        key={`info-${currentFmSong.id}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center mb-8"
                    >
                        <h2 className="text-xl font-bold mb-1">{currentFmSong.name}</h2>
                        <p className="text-[var(--text-muted)]">{currentFmSong.artist}</p>
                        {currentFmSong.album && (
                            <p className="text-sm text-[var(--text-muted)] mt-1">{currentFmSong.album}</p>
                        )}
                    </motion.div>

                    {/* Controls */}
                    <div className="flex items-center gap-6">
                        {/* Trash */}
                        <button
                            onClick={trashSong}
                            className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title="不喜欢"
                        >
                            <ThumbsDown className="w-5 h-5 text-[var(--text-muted)]" />
                        </button>

                        {/* Play/Pause */}
                        <button
                            onClick={() => {
                                if (isCurrentFmSong) {
                                    togglePlay()
                                } else {
                                    playCurrentSong()
                                }
                            }}
                            disabled={playerLoading}
                            className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors disabled:opacity-50"
                        >
                            {playerLoading ? (
                                <Loader2 className="w-7 h-7 animate-spin" />
                            ) : isCurrentPlaying ? (
                                <Pause className="w-7 h-7" />
                            ) : (
                                <Play className="w-7 h-7 ml-1" />
                            )}
                        </button>

                        {/* Next */}
                        <button
                            onClick={nextSong}
                            className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title="下一首"
                        >
                            <SkipForward className="w-5 h-5" />
                        </button>

                        {/* Like */}
                        <button
                            onClick={toggleLike}
                            className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title={isCurrentSongLiked ? '取消喜欢' : '喜欢'}
                        >
                            <Heart
                                className={`w-5 h-5 ${isCurrentSongLiked ? 'fill-red-500 text-red-500' : 'text-[var(--text-muted)]'}`}
                            />
                        </button>
                    </div>
                </div>
            ) : (
                <div className="text-center text-[var(--text-muted)]">
                    <p>暂无推荐</p>
                    <button
                        onClick={loadFmSongs}
                        className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                    >
                        重新加载
                    </button>
                </div>
            )}
            </div>
        </div>
    )
}
