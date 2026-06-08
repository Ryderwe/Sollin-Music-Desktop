import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Play,
    RefreshCw,
    Search,
    ListMusic,
    User,
    Disc,
    Mic2,
    TrendingUp,
    X,
    Video,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import neteaseAuthApi, { NETEASE_SEARCH_TYPES } from '@/services/neteaseAuth'
import SongRow from '@/components/SongRow'
import CoverImage from '@/components/ui/CoverImage'
import MvPlayerModal from '@/components/modals/MvPlayerModal'
import type { Song } from '@/types'

// Search type options
const SEARCH_TYPE_OPTIONS = [
    { value: NETEASE_SEARCH_TYPES.SONG, label: '单曲', icon: Disc },
    { value: NETEASE_SEARCH_TYPES.ALBUM, label: '专辑', icon: Disc },
    { value: NETEASE_SEARCH_TYPES.ARTIST, label: '歌手', icon: Mic2 },
    { value: NETEASE_SEARCH_TYPES.PLAYLIST, label: '歌单', icon: ListMusic },
    { value: NETEASE_SEARCH_TYPES.MV, label: 'MV', icon: Video },
    { value: NETEASE_SEARCH_TYPES.USER, label: '用户', icon: User },
]

export default function NeteaseHome() {
    const navigate = useNavigate()
    const { isLoggedIn, userData, cookie } = useAuthStore()
    usePlayerStore() // For potential future use
    const { addToast, setShowAuthModal } = useUIStore()

    // Search state
    const [searchKeyword, setSearchKeyword] = useState('')
    const [searchType, setSearchType] = useState<number>(NETEASE_SEARCH_TYPES.SONG)
    const [isSearching, setIsSearching] = useState(false)
    const [searchResults, setSearchResults] = useState<any>(null)
    const [hotSearch, setHotSearch] = useState<any[]>([])

    // Recommend state
    const [isLoading, setIsLoading] = useState(true)
    const [personalizedPlaylists, setPersonalizedPlaylists] = useState<any[]>([])
    const [newSongs, setNewSongs] = useState<Song[]>([])
    const [topArtists, setTopArtists] = useState<any[]>([])
    const [newAlbums, setNewAlbums] = useState<any[]>([])
    const [recommendPlaylists, setRecommendPlaylists] = useState<any[]>([])

    // MV player state
    const [mvPlayerOpen, setMvPlayerOpen] = useState(false)
    const [currentMv, setCurrentMv] = useState<{ id: number | string; name?: string; artist?: string } | null>(null)

    // Handle MV click
    const handleMvClick = (mv: any) => {
        setCurrentMv({
            id: mv.id,
            name: mv.name,
            artist: mv.artists?.map((a: any) => a.name).join(' / ') || mv.artistName,
        })
        setMvPlayerOpen(true)
    }

    // Check login status
    useEffect(() => {
        if (!isLoggedIn) {
            addToast({ type: 'warning', message: '请先登录小芸账号' })
            setShowAuthModal(true)
            navigate('/')
        }
    }, [isLoggedIn, navigate, addToast, setShowAuthModal])

    // Load initial data
    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true)
            try {
                const [playlists, songs, artists, albums, hotSearchData, recommendRes] = await Promise.all([
                    neteaseAuthApi.getPersonalizedPlaylists(10),
                    neteaseAuthApi.getPersonalizedNewSongs(12),
                    neteaseAuthApi.getTopArtists(10),
                    neteaseAuthApi.getNewAlbums(10),
                    neteaseAuthApi.getHotSearch(),
                    cookie ? neteaseAuthApi.getRecommendResource(cookie) : Promise.resolve([]),
                ])

                setPersonalizedPlaylists(playlists)
                setNewSongs(songs)
                setTopArtists(artists)
                setNewAlbums(albums)
                setHotSearch(hotSearchData.slice(0, 10))
                setRecommendPlaylists(recommendRes.slice(0, 6))
            } catch (error) {
                console.error('Load data error:', error)
                addToast({ type: 'error', message: '加载推荐内容失败' })
            } finally {
                setIsLoading(false)
            }
        }

        if (isLoggedIn) {
            loadData()
        }
    }, [isLoggedIn, cookie, addToast])

    // Handle search
    const handleSearch = async () => {
        if (!searchKeyword.trim()) return

        setIsSearching(true)
        try {
            const result = await neteaseAuthApi.search(searchKeyword, searchType, 30, 0, cookie || undefined)
            setSearchResults({ type: searchType, data: result })
        } catch (error) {
            console.error('Search error:', error)
            addToast({ type: 'error', message: '搜索失败' })
        } finally {
            setIsSearching(false)
        }
    }

    // Handle hot search click
    const handleHotSearchClick = (keyword: string) => {
        setSearchKeyword(keyword)
        setSearchType(NETEASE_SEARCH_TYPES.SONG)
        // Trigger search
        setTimeout(async () => {
            setIsSearching(true)
            try {
                const result = await neteaseAuthApi.search(keyword, NETEASE_SEARCH_TYPES.SONG, 30, 0, cookie || undefined)
                setSearchResults({ type: NETEASE_SEARCH_TYPES.SONG, data: result })
            } catch (error) {
                console.error('Search error:', error)
            } finally {
                setIsSearching(false)
            }
        }, 0)
    }

    // Clear search
    const clearSearch = () => {
        setSearchKeyword('')
        setSearchResults(null)
    }



    // Render search results
    const renderSearchResults = () => {
        if (!searchResults?.data) return null

        const { type, data } = searchResults

        // Songs
        if (type === NETEASE_SEARCH_TYPES.SONG && data.songs) {
            const songs: Song[] = data.songs.map((item: any) => ({
                id: String(item.id),
                name: item.name,
                artist: item.ar?.map((a: any) => a.name).join(', ') || '',
                album: item.al?.name || '',
                albumId: String(item.al?.id || ''),
                duration: Math.floor((item.dt || 0) / 1000),
                cover: item.al?.picUrl || '',
                platform: 'netease' as const,
            }))

            return (
                <div className="space-y-1">
                    <p className="text-sm text-[var(--text-muted)] mb-2">找到 {data.songCount || songs.length} 首歌曲</p>
                    {songs.map((song, index) => (
                        <SongRow
                            key={song.id}
                            song={song}
                            index={index}
                            playlist={songs}
                            playlistId="netease-search"
                            showPlatform={false}
                        />
                    ))}
                </div>
            )
        }

        // Albums
        if (type === NETEASE_SEARCH_TYPES.ALBUM && data.albums) {
            return (
                <div>
                    <p className="text-sm text-[var(--text-muted)] mb-4">找到 {data.albumCount || data.albums.length} 张专辑</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {data.albums.map((album: any) => (
                            <motion.div
                                key={album.id}
                                whileHover={{ scale: 1.03 }}
                                className="cursor-pointer group"
                                onClick={() => navigate(`/album/${album.id}`)}
                            >
                                <div className="aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2">
                                    <CoverImage
                                        src={album.picUrl}
                                        alt={album.name}
                                        className="w-full h-full group-hover:scale-105 transition-transform"
                                    />
                                </div>
                                <p className="font-medium truncate text-sm">{album.name}</p>
                                <p className="text-xs text-[var(--text-muted)] truncate">{album.artist?.name}</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            )
        }

        // Artists
        if (type === NETEASE_SEARCH_TYPES.ARTIST && data.artists) {
            return (
                <div>
                    <p className="text-sm text-[var(--text-muted)] mb-4">找到 {data.artistCount || data.artists.length} 位歌手</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {data.artists.map((artist: any) => (
                            <motion.div
                                key={artist.id}
                                whileHover={{ scale: 1.03 }}
                                className="cursor-pointer group text-center"
                                onClick={() => navigate(`/artist/${artist.id}`)}
                            >
                                <div className="aspect-square rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2 mx-auto w-24 h-24">
                                    <CoverImage
                                        src={artist.picUrl || artist.img1v1Url}
                                        alt={artist.name}
                                        className="w-full h-full group-hover:scale-105 transition-transform"
                                    />
                                </div>
                                <p className="font-medium truncate text-sm">{artist.name}</p>
                                {artist.alias?.[0] && (
                                    <p className="text-xs text-[var(--text-muted)] truncate">{artist.alias[0]}</p>
                                )}
                            </motion.div>
                        ))}
                    </div>
                </div>
            )
        }

        // Playlists
        if (type === NETEASE_SEARCH_TYPES.PLAYLIST && data.playlists) {
            return (
                <div>
                    <p className="text-sm text-[var(--text-muted)] mb-4">找到 {data.playlistCount || data.playlists.length} 个歌单</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {data.playlists.map((playlist: any) => (
                            <motion.div
                                key={playlist.id}
                                whileHover={{ scale: 1.03 }}
                                className="cursor-pointer group"
                                onClick={() => navigate(`/netease-playlist/${playlist.id}`)}
                            >
                                <div className="aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2 relative">
                                    <CoverImage
                                        src={playlist.coverImgUrl}
                                        alt={playlist.name}
                                        className="w-full h-full group-hover:scale-105 transition-transform"
                                    />
                                    <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                                        {formatPlayCount(playlist.playCount)}
                                    </div>
                                </div>
                                <p className="font-medium truncate text-sm">{playlist.name}</p>
                                <p className="text-xs text-[var(--text-muted)] truncate">by {playlist.creator?.nickname}</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            )
        }

        // Users
        if (type === NETEASE_SEARCH_TYPES.USER && data.userprofiles) {
            return (
                <div>
                    <p className="text-sm text-[var(--text-muted)] mb-4">找到 {data.userprofileCount || data.userprofiles.length} 位用户</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {data.userprofiles.map((user: any) => (
                            <div
                                key={user.userId}
                                className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"
                            >
                                <img
                                    src={user.avatarUrl}
                                    alt={user.nickname}
                                    className="w-12 h-12 rounded-full object-cover"
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{user.nickname}</p>
                                    <p className="text-xs text-[var(--text-muted)] truncate">{user.signature || '暂无签名'}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )
        }

        // MVs
        if (type === NETEASE_SEARCH_TYPES.MV && data.mvs) {
            return (
                <div>
                    <p className="text-sm text-[var(--text-muted)] mb-4">找到 {data.mvCount || data.mvs.length} 个 MV</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {data.mvs.map((mv: any) => (
                            <motion.div
                                key={mv.id}
                                whileHover={{ scale: 1.02 }}
                                className="cursor-pointer group"
                                onClick={() => handleMvClick(mv)}
                            >
                                <div className="aspect-video rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2 relative">
                                    <CoverImage
                                        src={mv.cover || mv.imgurl || mv.coverUrl}
                                        alt={mv.name || 'MV'}
                                        className="w-full h-full group-hover:scale-105 transition-transform"
                                    />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                        <Play className="w-12 h-12 text-white" fill="white" />
                                    </div>
                                    {mv.duration != null && mv.duration > 0 && (
                                        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                                            {formatDuration(mv.duration)}
                                        </div>
                                    )}
                                    {mv.playCount != null && (
                                        <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                                            {formatPlayCount(mv.playCount)} 播放
                                        </div>
                                    )}
                                </div>
                                <p className="font-medium truncate text-sm">{mv.name || '未知MV'}</p>
                                <p className="text-xs text-[var(--text-muted)] truncate">
                                    {mv.artists?.map((a: any) => a.name).join(' / ') || mv.artistName || '未知歌手'}
                                </p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            )
        }

        return <p className="text-[var(--text-muted)] text-center py-8">暂无搜索结果</p>
    }

    if (!isLoggedIn) {
        return null
    }

    return (
        <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-thin min-w-0">
            {/* Header with Search */}
            <div className="mb-6 min-w-0">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        {userData?.avatarUrl ? (
                            <img
                                src={userData.avatarUrl}
                                alt={userData.nickname}
                                className="w-12 h-12 rounded-full object-cover"
                            />
                        ) : (
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center">
                                <User className="w-6 h-6 text-white" />
                            </div>
                        )}
                        <div>
                            <h1 className="text-2xl font-bold">小芸音乐</h1>
                            <p className="text-sm text-[var(--text-muted)]">{userData?.nickname}</p>
                        </div>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="flex items-center gap-2 px-1 min-w-0">
                    <select
                        value={searchType}
                        onChange={(e) => setSearchType(Number(e.target.value))}
                        className="flex-shrink-0 rounded-2xl border border-black/10 bg-black/5 px-3 py-2 text-sm text-[var(--text-secondary)] outline-none backdrop-blur-xl transition-colors hover:bg-black/[0.07] focus:border-red-400/70 focus:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-[var(--text-primary)] dark:hover:bg-white/15 dark:focus:border-red-400/60 dark:focus:bg-white/15"
                    >
                        {SEARCH_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
                        <input
                            type="text"
                            value={searchKeyword}
                            onChange={(e) => setSearchKeyword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            placeholder="搜索歌曲、歌手、专辑、歌单..."
                            className="w-full rounded-full bg-white/50 dark:bg-gray-800/50 backdrop-blur-xl border border-white/20 dark:border-gray-700/30 py-2 pl-9 pr-9 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:bg-white/70 dark:focus:bg-gray-800/70 focus:shadow-sm"
                        />
                        {searchKeyword && (
                            <button
                                onClick={clearSearch}
                                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                            >
                                <X className="w-4 h-4 text-[var(--text-muted)]" />
                            </button>
                        )}
                    </div>
                    <button
                        onClick={handleSearch}
                        disabled={isSearching || !searchKeyword.trim()}
                        className="flex-shrink-0 inline-flex items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-2 text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                    >
                        {isSearching ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                            <Search className="w-5 h-5" />
                        )}
                        搜索
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="space-y-6">
                {/* Search Results */}
                {searchResults ? (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold">搜索结果</h2>
                            <button
                                onClick={clearSearch}
                                className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                            >
                                清除搜索
                            </button>
                        </div>
                        {renderSearchResults()}
                    </section>
                ) : (
                    <>
                        {/* Hot Search */}
                        {hotSearch.length > 0 && (
                            <section>
                                <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5 text-red-500" />
                                    热搜榜
                                </h2>
                                <div className="flex flex-wrap gap-2">
                                    {hotSearch.map((item, index) => (
                                        <button
                                            key={index}
                                            onClick={() => handleHotSearchClick(item.searchWord)}
                                            className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-red-500/10 hover:text-red-500 transition-colors text-sm flex items-center gap-1"
                                        >
                                            <span className={index < 3 ? 'text-red-500 font-bold' : 'text-[var(--text-muted)]'}>
                                                {index + 1}
                                            </span>
                                            {item.searchWord}
                                            {item.iconType === 1 && (
                                                <span className="text-xs text-red-500">HOT</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </section>
                        )}

                        {isLoading ? (
                            <div className="flex items-center justify-center py-20">
                                <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                        ) : (
                            <>
                                {/* Recommend Playlists (登录用户专属) */}
                                {recommendPlaylists.length > 0 && (
                                    <section className="overflow-visible">
                                        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                                            <ListMusic className="w-5 h-5 text-red-500" />
                                            为你推荐
                                        </h2>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-1">
                                            {recommendPlaylists.map((playlist) => (
                                                <motion.div
                                                    key={playlist.id}
                                                    whileHover={{ scale: 1.03 }}
                                                    className="cursor-pointer group"
                                                    onClick={() => navigate(`/netease-playlist/${playlist.id}`)}
                                                >
                                                    <div className="aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2 relative">
                                                        <CoverImage
                                                            src={playlist.cover}
                                                            alt={playlist.name}
                                                            className="w-full h-full group-hover:scale-105 transition-transform"
                                                        />
                                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                                            <Play className="w-10 h-10 text-white" fill="white" />
                                                        </div>
                                                    </div>
                                                    <p className="font-medium truncate text-sm">{playlist.name}</p>
                                                </motion.div>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                {/* Personalized Playlists */}
                                {personalizedPlaylists.length > 0 && (
                                    <section className="overflow-visible">
                                        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                                            <ListMusic className="w-5 h-5 text-blue-500" />
                                            推荐歌单
                                        </h2>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-1">
                                            {personalizedPlaylists.map((playlist) => (
                                                <motion.div
                                                    key={playlist.id}
                                                    whileHover={{ scale: 1.03 }}
                                                    className="cursor-pointer group"
                                                    onClick={() => navigate(`/netease-playlist/${playlist.id}`)}
                                                >
                                                    <div className="aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2 relative">
                                                        <CoverImage
                                                            src={playlist.cover}
                                                            alt={playlist.name}
                                                            className="w-full h-full group-hover:scale-105 transition-transform"
                                                        />
                                                        <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                                                            {formatPlayCount(playlist.playCount)}
                                                        </div>
                                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                                            <Play className="w-10 h-10 text-white" fill="white" />
                                                        </div>
                                                    </div>
                                                    <p className="font-medium truncate text-sm">{playlist.name}</p>
                                                </motion.div>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                {/* New Songs */}
                                {newSongs.length > 0 && (
                                    <section>
                                        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                                            <Disc className="w-5 h-5 text-green-500" />
                                            新歌速递
                                        </h2>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                            {newSongs.slice(0, 12).map((song, index) => (
                                                <SongRow
                                                    key={song.id}
                                                    song={song}
                                                    index={index}
                                                    playlist={newSongs}
                                                    playlistId="netease-new-songs"
                                                    showPlatform={false}
                                                />
                                            ))}
                                        </div>
                                    </section>
                                )}

                                {/* Top Artists */}
                                {topArtists.length > 0 && (
                                    <section>
                                        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                                            <Mic2 className="w-5 h-5 text-purple-500" />
                                            热门歌手
                                        </h2>
                                        <div className="flex gap-4 overflow-x-auto pb-2 px-1 scrollbar-thin">
                                            {topArtists.map((artist) => (
                                                <motion.div
                                                    key={artist.id}
                                                    whileHover={{ scale: 1.05 }}
                                                    onClick={() => navigate(`/artist/${artist.id}`)}
                                                    className="flex-shrink-0 cursor-pointer text-center w-24"
                                                >
                                                    <div className="w-20 h-20 mx-auto rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2">
                                                        <CoverImage
                                                            src={artist.avatar}
                                                            alt={artist.name}
                                                            className="w-full h-full"
                                                        />
                                                    </div>
                                                    <p className="font-medium truncate text-sm">{artist.name}</p>
                                                </motion.div>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                {/* New Albums */}
                                {newAlbums.length > 0 && (
                                    <section className="overflow-visible">
                                        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                                            <Disc className="w-5 h-5 text-orange-500" />
                                            新碟上架
                                        </h2>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-1">
                                            {newAlbums.map((album) => (
                                                <motion.div
                                                    key={album.id}
                                                    whileHover={{ scale: 1.03 }}
                                                    onClick={() => navigate(`/album/${album.id}`)}
                                                    className="cursor-pointer group"
                                                >
                                                    <div className="aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2">
                                                        <CoverImage
                                                            src={album.cover}
                                                            alt={album.name}
                                                            className="w-full h-full group-hover:scale-105 transition-transform"
                                                        />
                                                    </div>
                                                    <p className="font-medium truncate text-sm">{album.name}</p>
                                                    <p className="text-xs text-[var(--text-muted)] truncate">{album.artist}</p>
                                                </motion.div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>

            {/* MV Player Modal */}
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

// Format play count
function formatPlayCount(count: number): string {
    if (count >= 100000000) {
        return (count / 100000000).toFixed(1) + '亿'
    }
    if (count >= 10000) {
        return (count / 10000).toFixed(1) + '万'
    }
    return String(count)
}

// Format duration (milliseconds to mm:ss)
function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
