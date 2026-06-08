import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Play, Calendar, Building2, Loader2, ArrowLeft, ListPlus } from 'lucide-react'
import neteaseAuthApi from '@/services/neteaseAuth'
import { usePlayerStore } from '@/stores/playerStore'
import { useUserStore } from '@/stores/userStore'
import { useUIStore } from '@/stores/uiStore'
import SongRow from '@/components/SongRow'
import CoverImage from '@/components/ui/CoverImage'
import type { Song } from '@/types'

export default function AlbumDetail() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { playSong } = usePlayerStore()
    const { createLocalPlaylist, updateLocalPlaylist } = useUserStore()
    const { addToast } = useUIStore()

    const [album, setAlbum] = useState<any>(null)
    const [songs, setSongs] = useState<Song[]>([])
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        if (!id) return

        const loadAlbum = async () => {
            setIsLoading(true)
            try {
                const data = await neteaseAuthApi.getAlbumDetail(id)
                if (data) {
                    setAlbum(data.album)
                    setSongs(data.songs)
                }
            } catch (error) {
                console.error('Load album error:', error)
            } finally {
                setIsLoading(false)
            }
        }

        loadAlbum()
    }, [id])

    const playAll = () => {
        if (songs.length > 0) {
            playSong(songs[0], songs, `album-${id}`)
        }
    }

    const handleConvertToLocalPlaylist = () => {
        if (!album) return
        if (songs.length === 0) {
            addToast({ type: 'warning', message: '专辑暂无歌曲' })
            return
        }
        const local = createLocalPlaylist(album.name)
        updateLocalPlaylist(local.id, {
            songs,
            songCount: songs.length,
            cover: album.cover || songs[0]?.cover || '',
            updatedAt: new Date().toISOString(),
        })
        addToast({ type: 'success', message: '已转为本地歌单' })
    }

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp)
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
    }

    const getTotalDuration = () => {
        const totalSeconds = songs.reduce((acc, song) => acc + (song.duration || 0), 0)
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        if (hours > 0) {
            return `${hours}小时${minutes}分钟`
        }
        return `${minutes}分钟`
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-[calc(100vh-200px)]">
                <Loader2 className="w-8 h-8 animate-spin text-red-500" />
            </div>
        )
    }

    if (!album) {
        return (
            <div className="text-center py-20 text-[var(--text-muted)]">
                专辑不存在
            </div>
        )
    }

    return (
        <div className="pb-8">
            {/* Back button */}
            <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-4 transition-colors"
            >
                <ArrowLeft className="w-5 h-5" />
                <span>返回</span>
            </button>

            {/* Album header */}
            <div className="flex gap-6 mb-8">
                <div className="w-56 h-56 rounded-2xl overflow-hidden flex-shrink-0 shadow-xl">
                    <CoverImage
                        src={album.cover}
                        alt={album.name}
                        className="w-full h-full"
                    />
                </div>
                <div className="flex-1 flex flex-col justify-center">
                    <span className="text-xs text-red-500 font-medium mb-1">专辑</span>
                    <h1 className="text-3xl font-bold mb-2">{album.name}</h1>
                    <button
                        onClick={() => album.artistId && navigate(`/artist/${album.artistId}`)}
                        className="text-[var(--text-muted)] hover:text-red-500 transition-colors mb-4 text-left"
                    >
                        {album.artist}
                    </button>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--text-muted)] mb-4">
                        {album.publishTime && (
                            <span className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                {formatDate(album.publishTime)}
                            </span>
                        )}
                        {album.company && (
                            <span className="flex items-center gap-1">
                                <Building2 className="w-4 h-4" />
                                {album.company}
                            </span>
                        )}
                        <span>{songs.length} 首歌曲</span>
                        <span>{getTotalDuration()}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={playAll}
                            className="btn-primary gap-1.5"
                        >
                            <Play className="w-4 h-4" />
                            播放全部
                        </button>
                        <button
                            onClick={handleConvertToLocalPlaylist}
                            disabled={songs.length === 0}
                            className="btn-secondary gap-1.5 disabled:opacity-50"
                        >
                            <ListPlus className="w-4 h-4" />
                            转为本地歌单
                        </button>
                    </div>
                </div>
            </div>

            {/* Description */}
            {album.description && (
                <div className="mb-6">
                    <h3 className="font-bold mb-2">专辑介绍</h3>
                    <p className="text-sm text-[var(--text-muted)] whitespace-pre-line line-clamp-4">
                        {album.description}
                    </p>
                </div>
            )}

            {/* Songs */}
            <div>
                <h3 className="font-bold mb-4">歌曲列表</h3>
                <div className="space-y-1">
                    {songs.map((song, index) => (
                        <SongRow
                            key={song.id}
                            song={song}
                            index={index}
                            playlist={songs}
                            playlistId={`album-${id}`}
                            showPlatform={false}
                        />
                    ))}
                </div>
            </div>
        </div>
    )
}
