import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Play, Disc, Loader2, ArrowLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import { usePaginatedSongs } from '@/hooks/usePaginatedSongs'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import neteaseAuthApi from '@/services/neteaseAuth'
import { usePlayerStore } from '@/stores/playerStore'
import { useAuthStore } from '@/stores/authStore'
import SongRow from '@/components/SongRow'
import CoverImage from '@/components/ui/CoverImage'
import MvPlayerModal from '@/components/modals/MvPlayerModal'

type TabType = 'songs' | 'albums' | 'mvs'
const ARTIST_ALBUM_PAGE_SIZE = 50

export default function ArtistDetail() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { playSong } = usePlayerStore()
    useAuthStore()

    const [artist, setArtist] = useState<any>(null)
    const [albums, setAlbums] = useState<any[]>([])
    const [mvs, setMvs] = useState<any[]>([])
    const [activeTab, setActiveTab] = useState<TabType>('songs')
    const [isLoading, setIsLoading] = useState(true)
    const [albumsTotal, setAlbumsTotal] = useState(0)
    const [albumsOffset, setAlbumsOffset] = useState(0)
    const [albumsHasMore, setAlbumsHasMore] = useState(false)
    const [isLoadingMoreAlbums, setIsLoadingMoreAlbums] = useState(false)
    const [mvsTotal, setMvsTotal] = useState(0)

    const fetcher = useCallback(async (page: number) => {
        const offset = (page - 1) * 500
        const result = await neteaseAuthApi.getArtistSongs(id!, 500, offset)
        return {
            songs: result.songs,
            total: result.total,
            page,
            limit: 500,
            hasMore: offset + result.songs.length < result.total,
        }
    }, [id])

    const {
        visibleSongs: songs,
        apiTotal: songsTotal,
        isLoading: songsLoading,
        hasMore,
        sentinelRef,
        loadInitial,
    } = usePaginatedSongs({ fetcher, batchSize: 500 })

    // MV player
    const [mvPlayerOpen, setMvPlayerOpen] = useState(false)
    const [currentMv, setCurrentMv] = useState<{ id: number; name: string; artist: string } | null>(null)

    const loadMoreAlbums = useCallback(async () => {
        if (!id || isLoadingMoreAlbums || !albumsHasMore) return

        setIsLoadingMoreAlbums(true)
        try {
            const result = await neteaseAuthApi.getArtistAlbums(id, ARTIST_ALBUM_PAGE_SIZE, albumsOffset)
            setAlbums((prev) => {
                const seenIds = new Set(prev.map((album) => album.id))
                const nextAlbums = result.albums.filter((album) => !seenIds.has(album.id))
                return [...prev, ...nextAlbums]
            })
            setAlbumsOffset((prev) => prev + result.albums.length)
            setAlbumsTotal(result.total)
            setAlbumsHasMore(result.hasMore && result.albums.length > 0)
        } catch (error) {
            console.error('Load more artist albums error:', error)
        } finally {
            setIsLoadingMoreAlbums(false)
        }
    }, [albumsHasMore, albumsOffset, id, isLoadingMoreAlbums])

    const { sentinelRef: albumsSentinelRef } = useInfiniteScroll({
        onLoadMore: loadMoreAlbums,
        hasMore: albumsHasMore,
        enabled: activeTab === 'albums' && !isLoading && !isLoadingMoreAlbums,
    })

    useEffect(() => {
        if (!id) return

        const loadArtist = async () => {
            setIsLoading(true)
            try {
                const [detail, albumsData, mvsData] = await Promise.all([
                    neteaseAuthApi.getArtistDetail(id),
                    neteaseAuthApi.getArtistAlbums(id, ARTIST_ALBUM_PAGE_SIZE),
                    neteaseAuthApi.getArtistMvs(id, 20),
                ])

                setArtist(detail)
                setAlbums(albumsData.albums)
                setAlbumsTotal(albumsData.total)
                setAlbumsOffset(albumsData.albums.length)
                setAlbumsHasMore(albumsData.hasMore && albumsData.albums.length > 0)
                setMvs(mvsData.mvs)
                setMvsTotal(mvsData.total)
            } catch (error) {
                console.error('Load artist error:', error)
            } finally {
                setIsLoading(false)
            }
        }

        loadArtist()
        loadInitial()
    }, [id, loadInitial])

    const playAll = () => {
        if (songs.length > 0) {
            playSong(songs[0], songs, `artist-${id}`)
        }
    }

    const handleMvClick = (mv: any) => {
        setCurrentMv({
            id: mv.id,
            name: mv.name,
            artist: artist?.name || '',
        })
        setMvPlayerOpen(true)
    }

    const formatPlayCount = (count: number) => {
        if (!count) return '0'
        if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿'
        if (count >= 10000) return (count / 10000).toFixed(1) + '万'
        return String(count)
    }

    const formatDuration = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000)
        const minutes = Math.floor(totalSeconds / 60)
        const seconds = totalSeconds % 60
        return `${minutes}:${seconds.toString().padStart(2, '0')}`
    }

    if (isLoading || songsLoading) {
        return (
            <div className="flex items-center justify-center h-[calc(100vh-200px)]">
                <Loader2 className="w-8 h-8 animate-spin text-red-500" />
            </div>
        )
    }

    if (!artist) {
        return (
            <div className="text-center py-20 text-[var(--text-muted)]">
                歌手不存在
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

            {/* Artist header */}
            <div className="flex gap-6 mb-8">
                <div className="w-48 h-48 rounded-full overflow-hidden flex-shrink-0 shadow-xl">
                    <CoverImage
                        src={artist.avatar}
                        alt={artist.name}
                        className="w-full h-full"
                    />
                </div>
                <div className="flex-1 flex flex-col justify-center">
                    <h1 className="text-3xl font-bold mb-2">{artist.name}</h1>
                    {artist.alias?.length > 0 && (
                        <p className="text-[var(--text-muted)] mb-3">{artist.alias.join(' / ')}</p>
                    )}
                    {artist.identities && (
                        <p className="text-sm text-[var(--text-muted)] mb-4">{artist.identities}</p>
                    )}
                    <div className="flex items-center gap-6 text-sm text-[var(--text-muted)] mb-4">
                        <span>单曲 {artist.musicSize || songsTotal}</span>
                        <span>专辑 {artist.albumSize || albumsTotal}</span>
                        <span>MV {artist.mvSize || mvsTotal}</span>
                    </div>
                    <button
                        onClick={playAll}
                        className="btn-primary gap-1.5"
                    >
                        <Play className="w-4 h-4" />
                        播放全部
                    </button>
                </div>
            </div>

            {/* Brief description */}
            {artist.briefDesc && (
                <p className="text-sm text-[var(--text-muted)] mb-6 line-clamp-2">
                    {artist.briefDesc}
                </p>
            )}

            {/* Tabs */}
            <div className="flex gap-6 border-b border-gray-200 dark:border-gray-700 mb-6">
                {[
                    { key: 'songs' as TabType, label: '热门歌曲', count: songsTotal },
                    { key: 'albums' as TabType, label: '专辑', count: albumsTotal },
                    { key: 'mvs' as TabType, label: 'MV', count: mvsTotal },
                ].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`pb-3 px-1 text-sm font-medium transition-colors relative ${
                            activeTab === tab.key
                                ? 'text-red-500'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                        }`}
                    >
                        {tab.label} ({tab.count})
                        {activeTab === tab.key && (
                            <motion.div
                                layoutId="artist-tab-indicator"
                                className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500"
                            />
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            {activeTab === 'songs' && (
                <div className="space-y-1">
                    {songs.map((song, index) => (
                        <SongRow
                            key={song.id}
                            song={song}
                            index={index}
                            playlist={songs}
                            playlistId={`artist-${id}`}
                            showPlatform={false}
                        />
                    ))}
                    {hasMore && (
                        <div ref={sentinelRef} className="min-h-16 flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'albums' && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {albums.map(album => (
                            <motion.div
                                key={album.id}
                                whileHover={{ scale: 1.03 }}
                                onClick={() => navigate(`/album/${album.id}`)}
                                className="cursor-pointer group"
                            >
                                <div className="relative aspect-square rounded-xl overflow-hidden mb-2">
                                    <CoverImage
                                        src={album.cover}
                                        alt={album.name}
                                        className="w-full h-full group-hover:scale-105 transition-transform"
                                    />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                        <Disc className="w-10 h-10 text-white" />
                                    </div>
                                </div>
                                <p className="font-medium text-sm truncate">{album.name}</p>
                                <p className="text-xs text-[var(--text-muted)]">
                                    {new Date(album.publishTime).getFullYear()} · {album.size}首
                                </p>
                            </motion.div>
                        ))}
                    </div>
                    {albumsHasMore && (
                        <div ref={albumsSentinelRef} className="min-h-16 flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                </>
            )}

            {activeTab === 'mvs' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {mvs.map(mv => (
                        <motion.div
                            key={mv.id}
                            whileHover={{ scale: 1.02 }}
                            onClick={() => handleMvClick(mv)}
                            className="cursor-pointer group"
                        >
                            <div className="relative aspect-video rounded-xl overflow-hidden mb-2">
                                <CoverImage
                                    src={mv.cover}
                                    alt={mv.name}
                                    className="w-full h-full group-hover:scale-105 transition-transform"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <Play className="w-12 h-12 text-white" fill="white" />
                                </div>
                                {mv.duration && (
                                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                                        {formatDuration(mv.duration)}
                                    </div>
                                )}
                                <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                                    {formatPlayCount(mv.playCount)} 播放
                                </div>
                            </div>
                            <p className="font-medium text-sm truncate">{mv.name}</p>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* MV Player */}
            <MvPlayerModal
                isOpen={mvPlayerOpen}
                onClose={() => {
                    setMvPlayerOpen(false)
                    setCurrentMv(null)
                }}
                mvId={currentMv?.id || ''}
                mvName={currentMv?.name}
                artistName={currentMv?.artist}
            />
        </div>
    )
}
