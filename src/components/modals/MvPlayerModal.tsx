import { useState, useEffect, useRef } from 'react'
import { X, Play, Pause, Volume2, VolumeX, Maximize, Loader2, MessageCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import neteaseAuthApi, { NETEASE_COMMENT_TYPES } from '@/services/neteaseAuth'
import { usePlayerStore } from '@/stores/playerStore'
import CommentSection from '@/components/CommentSection'

interface MvPlayerModalProps {
    isOpen: boolean
    onClose: () => void
    mvId: number | string
    mvName?: string
    artistName?: string
}

export default function MvPlayerModal({ isOpen, onClose, mvId, mvName, artistName }: MvPlayerModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [mvUrl, setMvUrl] = useState<string | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isMuted, setIsMuted] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [showControls, setShowControls] = useState(true)
    const [showComments, setShowComments] = useState(false)
    const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    const { pause: pauseMusic, resume: resumeMusic, isPlaying: isMusicPlaying, currentSong } = usePlayerStore()
    const wasMusicPlayingRef = useRef(false)
    const prevIsOpenRef = useRef(false)

    // Pause music when MV player opens (only on open transition)
    useEffect(() => {
        // Detect open transition (from closed to open)
        if (isOpen && !prevIsOpenRef.current) {
            // Check if music is playing when MV opens
            if (isMusicPlaying) {
                wasMusicPlayingRef.current = true
                pauseMusic()
            }
        }
        // Resume music when modal closes
        if (!isOpen && prevIsOpenRef.current) {
            if (wasMusicPlayingRef.current && currentSong) {
                setTimeout(() => {
                    resumeMusic()
                }, 100)
            }
            wasMusicPlayingRef.current = false
        }
        prevIsOpenRef.current = isOpen
    }, [isOpen, isMusicPlaying, pauseMusic, resumeMusic, currentSong])

    // Handle MV ended - resume music if it was playing before
    const handleMvEnded = () => {
        setIsPlaying(false)
        if (wasMusicPlayingRef.current && currentSong) {
            wasMusicPlayingRef.current = false
            // Small delay to ensure video is fully stopped
            setTimeout(() => {
                resumeMusic()
            }, 100)
        }
    }

    // Load MV URL
    useEffect(() => {
        if (!isOpen || !mvId) return

        const loadMvUrl = async () => {
            setIsLoading(true)
            setError(null)
            setMvUrl(null)

            try {
                // Try different resolutions
                const resolutions = [1080, 720, 480, 240]
                let result = null

                for (const r of resolutions) {
                    result = await neteaseAuthApi.getMvUrl(mvId, r)
                    if (result?.url) break
                }

                if (result?.url) {
                    setMvUrl(result.url)
                } else {
                    setError('无法获取 MV 播放地址')
                }
            } catch (err) {
                console.error('Load MV URL error:', err)
                setError('加载 MV 失败')
            } finally {
                setIsLoading(false)
            }
        }

        loadMvUrl()
    }, [isOpen, mvId])

    // Auto play when URL is loaded
    useEffect(() => {
        if (mvUrl && videoRef.current) {
            videoRef.current.play().catch(() => {
                // Auto-play might be blocked
                setIsPlaying(false)
            })
        }
    }, [mvUrl])

    // Handle controls visibility
    const handleMouseMove = () => {
        setShowControls(true)
        if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current)
        }
        controlsTimeoutRef.current = setTimeout(() => {
            if (isPlaying) {
                setShowControls(false)
            }
        }, 3000)
    }

    // Cleanup
    useEffect(() => {
        return () => {
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current)
            }
        }
    }, [])

    const togglePlay = () => {
        if (!videoRef.current) return
        if (isPlaying) {
            videoRef.current.pause()
        } else {
            videoRef.current.play()
        }
    }

    const toggleMute = () => {
        if (!videoRef.current) return
        videoRef.current.muted = !isMuted
        setIsMuted(!isMuted)
    }

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!videoRef.current) return
        const time = Number(e.target.value)
        videoRef.current.currentTime = time
        setCurrentTime(time)
    }

    const toggleFullscreen = () => {
        if (!videoRef.current) return
        if (document.fullscreenElement) {
            document.exitFullscreen()
        } else {
            videoRef.current.requestFullscreen()
        }
    }

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    if (!isOpen) return null

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="relative w-full max-w-5xl mx-4"
                    onClick={(e) => e.stopPropagation()}
                    onMouseMove={handleMouseMove}
                >
                    {/* Close button */}
                    <button
                        onClick={onClose}
                        className="absolute -top-12 right-0 p-2 text-white/70 hover:text-white transition-colors z-10"
                    >
                        <X className="w-8 h-8" />
                    </button>

                    {/* Video container */}
                    <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
                        {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Loader2 className="w-12 h-12 text-white animate-spin" />
                            </div>
                        )}

                        {error && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="text-center text-white">
                                    <p className="text-lg mb-2">{error}</p>
                                    <button
                                        onClick={onClose}
                                        className="px-4 py-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                                    >
                                        关闭
                                    </button>
                                </div>
                            </div>
                        )}

                        {mvUrl && (
                            <video
                                ref={videoRef}
                                src={mvUrl}
                                className="w-full h-full"
                                onPlay={() => setIsPlaying(true)}
                                onPause={() => setIsPlaying(false)}
                                onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                                onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
                                onEnded={handleMvEnded}
                                onClick={togglePlay}
                            />
                        )}

                        {/* Controls overlay */}
                        <AnimatePresence>
                            {showControls && mvUrl && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40"
                                >
                                    {/* Title */}
                                    <div className="absolute top-4 left-4 text-white">
                                        <h3 className="text-lg font-bold">{mvName || 'MV'}</h3>
                                        {artistName && (
                                            <p className="text-sm text-white/70">{artistName}</p>
                                        )}
                                    </div>

                                    {/* Center play button */}
                                    <button
                                        onClick={togglePlay}
                                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
                                    >
                                        {isPlaying ? (
                                            <Pause className="w-8 h-8 text-white" />
                                        ) : (
                                            <Play className="w-8 h-8 text-white ml-1" />
                                        )}
                                    </button>

                                    {/* Bottom controls */}
                                    <div className="absolute bottom-0 left-0 right-0 p-4">
                                        {/* Progress bar */}
                                        <input
                                            type="range"
                                            min={0}
                                            max={duration || 100}
                                            value={currentTime}
                                            onChange={handleSeek}
                                            className="w-full h-1 bg-white/30 rounded-full appearance-none cursor-pointer mb-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                                        />

                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <button onClick={togglePlay} className="text-white hover:text-white/80">
                                                    {isPlaying ? (
                                                        <Pause className="w-6 h-6" />
                                                    ) : (
                                                        <Play className="w-6 h-6" />
                                                    )}
                                                </button>

                                                <button onClick={toggleMute} className="text-white hover:text-white/80">
                                                    {isMuted ? (
                                                        <VolumeX className="w-6 h-6" />
                                                    ) : (
                                                        <Volume2 className="w-6 h-6" />
                                                    )}
                                                </button>

                                                <span className="text-white text-sm">
                                                    {formatTime(currentTime)} / {formatTime(duration)}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => setShowComments(!showComments)}
                                                    className={`text-white hover:text-white/80 ${showComments ? 'text-red-400' : ''}`}
                                                >
                                                    <MessageCircle className="w-6 h-6" />
                                                </button>
                                                <button onClick={toggleFullscreen} className="text-white hover:text-white/80">
                                                    <Maximize className="w-6 h-6" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Comments panel */}
                    <AnimatePresence>
                        {showComments && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="mt-4 bg-gray-900/95 backdrop-blur-xl rounded-xl overflow-hidden"
                            >
                                <div className="p-4 max-h-[300px] overflow-y-auto">
                                    <CommentSection
                                        resourceId={mvId}
                                        resourceType={NETEASE_COMMENT_TYPES.MV}
                                        maxHeight="250px"
                                        theme="dark"
                                    />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}
