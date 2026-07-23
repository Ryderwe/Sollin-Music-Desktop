import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Disc,
  FolderOpen,
  FolderPlus,
  Music2,
  Play,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import type { Song } from '@/types'
import { useLocalMusicStore } from '@/stores/localMusicStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import SongRow from '@/components/SongRow'
import CoverImage from '@/components/ui/CoverImage'

type BrowseTab = 'songs' | 'albums' | 'artists'
type LocalSongSort =
  | 'default'
  | 'title-asc'
  | 'title-desc'
  | 'artist-asc'
  | 'artist-desc'
  | 'album-asc'
  | 'album-desc'
  | 'duration-desc'
  | 'duration-asc'
  | 'size-desc'
  | 'size-asc'
  | 'modified-desc'
  | 'modified-asc'

type LocalAlbumGroup = {
  id: string
  name: string
  artist: string
  cover?: string
  songs: Song[]
  duration: number
}

type LocalArtistGroup = {
  id: string
  name: string
  cover?: string
  songs: Song[]
  duration: number
  albums: Array<{
    id: string
    name: string
  }>
}

const formatScannedAt = (value: string | null) => {
  if (!value) return '未扫描'

  try {
    return new Date(value).toLocaleString('zh-CN', {
      hour12: false,
    })
  } catch {
    return value
  }
}

const normalizeLabel = (value: string | undefined, fallback: string) => {
  const next = value?.trim()
  return next || fallback
}

const createGroupKey = (...parts: string[]) => (
  parts
    .map((part) => part.trim().toLocaleLowerCase('zh-CN'))
    .join('::')
)

const LOCAL_SONG_SORT_STORAGE_KEY = 'local-music-song-sort'
const localSongCollator = new Intl.Collator('zh-CN', {
  sensitivity: 'base',
  numeric: true,
})

const LOCAL_SONG_SORT_OPTIONS: Array<{ value: LocalSongSort; label: string }> = [
  { value: 'default', label: '默认排序' },
  { value: 'title-asc', label: '标题 A-Z' },
  { value: 'title-desc', label: '标题 Z-A' },
  { value: 'artist-asc', label: '艺术家 A-Z' },
  { value: 'artist-desc', label: '艺术家 Z-A' },
  { value: 'album-asc', label: '专辑 A-Z' },
  { value: 'album-desc', label: '专辑 Z-A' },
  { value: 'duration-desc', label: '时长从长到短' },
  { value: 'duration-asc', label: '时长从短到长' },
  { value: 'size-desc', label: '文件大小从大到小' },
  { value: 'size-asc', label: '文件大小从小到大' },
  { value: 'modified-desc', label: '最近修改优先' },
  { value: 'modified-asc', label: '最早修改优先' },
]

const isLocalSongSort = (value: string | null): value is LocalSongSort => (
  LOCAL_SONG_SORT_OPTIONS.some((option) => option.value === value)
)

const readLocalSongSort = (): LocalSongSort => {
  if (typeof window === 'undefined') return 'default'

  const storedValue = window.localStorage.getItem(LOCAL_SONG_SORT_STORAGE_KEY)
  return isLocalSongSort(storedValue) ? storedValue : 'default'
}

const compareText = (left: string | undefined, right: string | undefined, direction: 1 | -1 = 1) => {
  const leftValue = left?.trim()
  const rightValue = right?.trim()

  if (!leftValue && !rightValue) return 0
  if (!leftValue) return 1
  if (!rightValue) return -1

  return localSongCollator.compare(leftValue, rightValue) * direction
}

const compareOptionalNumber = (left: number | undefined, right: number | undefined, direction: 1 | -1 = 1) => {
  const leftValid = typeof left === 'number' && Number.isFinite(left)
  const rightValid = typeof right === 'number' && Number.isFinite(right)

  if (!leftValid && !rightValid) return 0
  if (!leftValid) return 1
  if (!rightValid) return -1

  return (left - right) * direction
}

const getSongModifiedTimestamp = (song: Song) => {
  if (!song.localModifiedAt) return undefined

  const timestamp = Date.parse(song.localModifiedAt)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

const compareSongsByLibraryOrder = (left: Song, right: Song) => {
  const artistCompare = compareText(left.artist, right.artist)
  if (artistCompare !== 0) return artistCompare

  const albumCompare = compareText(left.album, right.album)
  if (albumCompare !== 0) return albumCompare

  const discCompare = compareOptionalNumber(left.localDiscNo, right.localDiscNo)
  if (discCompare !== 0) return discCompare

  const trackCompare = compareOptionalNumber(left.localTrackNo, right.localTrackNo)
  if (trackCompare !== 0) return trackCompare

  const titleCompare = compareText(left.name, right.name)
  if (titleCompare !== 0) return titleCompare

  return compareText(left.localPath, right.localPath)
}

const sortLocalSongs = (items: Song[], sortType: LocalSongSort) => {
  const sortedItems = [...items]

  sortedItems.sort((left, right) => {
    switch (sortType) {
      case 'title-asc':
        return compareText(left.name, right.name) || compareSongsByLibraryOrder(left, right)
      case 'title-desc':
        return compareText(left.name, right.name, -1) || compareSongsByLibraryOrder(left, right)
      case 'artist-asc':
        return compareText(left.artist, right.artist) || compareSongsByLibraryOrder(left, right)
      case 'artist-desc':
        return compareText(left.artist, right.artist, -1) || compareSongsByLibraryOrder(left, right)
      case 'album-asc':
        return compareText(left.album, right.album) || compareSongsByLibraryOrder(left, right)
      case 'album-desc':
        return compareText(left.album, right.album, -1) || compareSongsByLibraryOrder(left, right)
      case 'duration-desc':
        return compareOptionalNumber(left.duration, right.duration, -1) || compareSongsByLibraryOrder(left, right)
      case 'duration-asc':
        return compareOptionalNumber(left.duration, right.duration, 1) || compareSongsByLibraryOrder(left, right)
      case 'size-desc':
        return compareOptionalNumber(left.localFileSize, right.localFileSize, -1) || compareSongsByLibraryOrder(left, right)
      case 'size-asc':
        return compareOptionalNumber(left.localFileSize, right.localFileSize, 1) || compareSongsByLibraryOrder(left, right)
      case 'modified-desc':
        return compareOptionalNumber(getSongModifiedTimestamp(left), getSongModifiedTimestamp(right), -1) || compareSongsByLibraryOrder(left, right)
      case 'modified-asc':
        return compareOptionalNumber(getSongModifiedTimestamp(left), getSongModifiedTimestamp(right), 1) || compareSongsByLibraryOrder(left, right)
      case 'default':
      default:
        return compareSongsByLibraryOrder(left, right)
    }
  })

  return sortedItems
}

const formatCollectionDuration = (totalSeconds: number) => {
  if (!totalSeconds) return '0 分钟'

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }

  if (minutes > 0) {
    return `${minutes} 分钟`
  }

  return `${Math.max(1, totalSeconds)} 秒`
}

const buildLocalPlaylistId = (prefix: string, id: string) => `local-${prefix}-${encodeURIComponent(id)}`

export default function LocalMusic() {
  const {
    folders,
    songs,
    isScanning,
    lastScannedAt,
    scanError,
    pickFolders,
    rescanFolders,
    removeFolder,
  } = useLocalMusicStore()
  const { playSong, setPlaylist } = usePlayerStore()
  const { setShowCreatePlaylistModal, setCreatePlaylistMode } = useUIStore()
  const [showLibrarySettings, setShowLibrarySettings] = useState(folders.length === 0)
  const [activeTab, setActiveTab] = useState<BrowseTab>('songs')
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null)
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null)
  const [songSort, setSongSort] = useState<LocalSongSort>(() => readLocalSongSort())

  const topSummary = useMemo(() => {
    if (isScanning) return '正在扫描目录'
    if (!folders.length) return '还没有添加扫描目录'
    if (!songs.length) return '目录已保存，暂时没有识别到歌曲'
    return `${songs.length} 首歌`
  }, [folders.length, isScanning, songs.length])

  const sortedSongs = useMemo(() => sortLocalSongs(songs, songSort), [songSort, songs])

  const albumGroups = useMemo(() => {
    const groups = new Map<string, LocalAlbumGroup>()

    songs.forEach((song) => {
      const albumName = normalizeLabel(song.album, '未知专辑')
      const artistName = normalizeLabel(song.artist, '未知歌手')
      const id = createGroupKey(albumName, artistName)

      if (!groups.has(id)) {
        groups.set(id, {
          id,
          name: albumName,
          artist: artistName,
          cover: song.cover,
          songs: [],
          duration: 0,
        })
      }

      const group = groups.get(id)!
      group.songs.push(song)
      group.duration += song.duration || 0
      if (!group.cover && song.cover) {
        group.cover = song.cover
      }
    })

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        songs: sortLocalSongs(group.songs, 'default'),
      }))
      .sort((left, right) => {
        const byCount = right.songs.length - left.songs.length
        if (byCount !== 0) return byCount
        return localSongCollator.compare(left.name, right.name)
      })
  }, [songs])

  const artistGroups = useMemo(() => {
    const groups = new Map<string, LocalArtistGroup>()

    songs.forEach((song) => {
      const artistName = normalizeLabel(song.artist, '未知歌手')
      const albumName = normalizeLabel(song.album, '未知专辑')
      const artistId = createGroupKey(artistName)
      const albumId = createGroupKey(albumName, artistName)

      if (!groups.has(artistId)) {
        groups.set(artistId, {
          id: artistId,
          name: artistName,
          cover: song.cover,
          songs: [],
          duration: 0,
          albums: [],
        })
      }

      const group = groups.get(artistId)!
      group.songs.push(song)
      group.duration += song.duration || 0
      if (!group.cover && song.cover) {
        group.cover = song.cover
      }
      if (!group.albums.some((album) => album.id === albumId)) {
        group.albums.push({
          id: albumId,
          name: albumName,
        })
      }
    })

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        songs: sortLocalSongs(group.songs, 'default'),
        albums: [...group.albums].sort((left, right) => localSongCollator.compare(left.name, right.name)),
      }))
      .sort((left, right) => {
        const byCount = right.songs.length - left.songs.length
        if (byCount !== 0) return byCount
        return localSongCollator.compare(left.name, right.name)
      })
  }, [songs])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LOCAL_SONG_SORT_STORAGE_KEY, songSort)
  }, [songSort])

  const tabOptions = useMemo(() => ([
    {
      id: 'songs' as BrowseTab,
      label: '歌曲',
      count: songs.length,
      unit: '首',
      icon: Music2,
    },
    {
      id: 'albums' as BrowseTab,
      label: '专辑',
      count: albumGroups.length,
      unit: '张',
      icon: Disc,
    },
    {
      id: 'artists' as BrowseTab,
      label: '艺术家',
      count: artistGroups.length,
      unit: '位',
      icon: Users,
    },
  ]), [albumGroups.length, artistGroups.length, songs.length])

  const selectedAlbum = useMemo(
    () => albumGroups.find((album) => album.id === selectedAlbumId) ?? null,
    [albumGroups, selectedAlbumId],
  )

  const selectedArtist = useMemo(
    () => artistGroups.find((artist) => artist.id === selectedArtistId) ?? null,
    [artistGroups, selectedArtistId],
  )

  useEffect(() => {
    if (!albumGroups.length) {
      if (selectedAlbumId !== null) setSelectedAlbumId(null)
      return
    }

    if (!selectedAlbumId || !albumGroups.some((album) => album.id === selectedAlbumId)) {
      setSelectedAlbumId(albumGroups[0].id)
    }
  }, [albumGroups, selectedAlbumId])

  useEffect(() => {
    if (!artistGroups.length) {
      if (selectedArtistId !== null) setSelectedArtistId(null)
      return
    }

    if (!selectedArtistId || !artistGroups.some((artist) => artist.id === selectedArtistId)) {
      setSelectedArtistId(artistGroups[0].id)
    }
  }, [artistGroups, selectedArtistId])

  const handlePlayCollection = async(
    collectionSongs: Song[],
    playlistId: string,
    playlistName?: string,
  ) => {
    if (!collectionSongs.length) return
    setPlaylist(collectionSongs, playlistId, playlistName)
    await playSong(collectionSongs[0], collectionSongs, playlistId, undefined, playlistName)
  }

  const handlePlayAll = async() => {
    await handlePlayCollection(sortedSongs, 'local-library', '本地音乐')
  }

  const renderCollectionCover = (cover: string | undefined, alt: string, rounded = 'rounded-2xl') => {
    if (cover) {
      return (
        <CoverImage
          src={cover}
          alt={alt}
          className={`h-full w-full ${rounded}`}
        />
      )
    }

    return (
      <div className={cn(
        'flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-500/15 to-sky-500/10 text-violet-500',
        rounded,
      )}>
        <Music2 className="h-8 w-8 opacity-70" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/20 bg-white/45 p-5 backdrop-blur-xl dark:border-gray-700/40 dark:bg-gray-800/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">本地音乐</h1>
              <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-[var(--text-secondary)] dark:bg-white/10 dark:text-[var(--text-secondary)]">
                MP3 / FLAC / M4A / OGG
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center rounded-full bg-black/5 px-3 py-1.5 text-[var(--text-secondary)] dark:bg-white/10 dark:text-[var(--text-secondary)]">
                {topSummary}
              </span>
              <span className="inline-flex items-center rounded-full bg-black/5 px-3 py-1.5 text-[var(--text-secondary)] dark:bg-white/10 dark:text-[var(--text-secondary)]">
                {folders.length} 个目录
              </span>
              <span className="inline-flex items-center rounded-full bg-black/5 px-3 py-1.5 text-[var(--text-secondary)] dark:bg-white/10 dark:text-[var(--text-secondary)]">
                最近扫描 {formatScannedAt(lastScannedAt)}
              </span>
              {isScanning && (
                <span className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1.5 text-violet-600 dark:text-violet-300">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  扫描中
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                setCreatePlaylistMode('local')
                setShowCreatePlaylistModal(true)
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white/75 px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-white dark:border-gray-700 dark:bg-gray-800/75 dark:text-[var(--text-secondary)] dark:hover:bg-gray-800"
            >
              <Plus className="h-4 w-4" />
              新建本地歌单
            </button>
            <button
              onClick={() => void handlePlayAll()}
              className="btn-primary gap-1.5"
              disabled={!songs.length || isScanning}
            >
              <Play className="w-4 h-4" />
              播放全部
            </button>
            <button
              onClick={() => setShowLibrarySettings((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white/75 px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-white dark:border-gray-700 dark:bg-gray-800/75 dark:text-[var(--text-secondary)] dark:hover:bg-gray-800"
            >
              <SlidersHorizontal className="h-4 w-4" />
              库设置
              {showLibrarySettings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </section>

      {scanError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {scanError}
        </div>
      )}

      {showLibrarySettings && (
        <section className="rounded-3xl border border-white/20 bg-white/45 p-5 backdrop-blur-xl dark:border-gray-700/40 dark:bg-gray-800/40">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-violet-500" />
                <h2 className="text-lg font-semibold">库设置</h2>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                添加新的扫描目录、重新扫描现有目录，或者移除不再需要的文件夹。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void pickFolders()}
                className="btn-primary gap-2"
                disabled={isScanning}
              >
                <FolderPlus className="h-5 w-5" />
                添加文件夹
              </button>
              <button
                onClick={() => void rescanFolders()}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white/70 px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-white dark:border-gray-700 dark:bg-gray-800/70 dark:text-[var(--text-secondary)] dark:hover:bg-gray-800"
                disabled={isScanning || folders.length === 0}
              >
                <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
                重新扫描
              </button>
            </div>
          </div>

          <div className="mt-5">
            {folders.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {folders.map((folder) => (
                  <div
                    key={folder}
                    className="inline-flex max-w-full items-center gap-2 rounded-full bg-gray-100/90 px-4 py-2 text-sm text-[var(--text-secondary)] dark:bg-gray-700/70 dark:text-[var(--text-secondary)]"
                    title={folder}
                  >
                    <span className="truncate">{folder}</span>
                    <button
                      onClick={() => void removeFolder(folder)}
                      className="rounded-full p-1 text-[var(--text-muted)] transition-colors hover:bg-gray-200 hover:text-[var(--text-secondary)] dark:hover:bg-gray-600 dark:hover:text-white"
                      aria-label={`移除 ${folder}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300/80 px-6 py-10 text-center text-[var(--text-muted)] dark:border-gray-700 dark:text-[var(--text-muted)]">
                <FolderOpen className="mx-auto mb-3 h-10 w-10 opacity-60" />
                <p className="text-base font-medium">还没有添加本地扫描目录</p>
                <p className="mt-1 text-sm">选择一个或多个音乐文件夹后，就可以在这里统一浏览和播放</p>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-white/20 bg-white/45 p-5 backdrop-blur-xl dark:border-gray-700/40 dark:bg-gray-800/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Music2 className="h-5 w-5 text-violet-500" />
              <h2 className="text-lg font-semibold">曲库浏览</h2>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              按歌曲、专辑或艺术家查看本地曲库，并支持直接从分类视图开始播放。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tabOptions.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-violet-500 text-white'
                      : 'bg-black/5 text-[var(--text-secondary)] hover:bg-black/10 dark:bg-white/10 dark:text-[var(--text-secondary)] dark:hover:bg-white/15'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-xs',
                    active ? 'bg-white/20 text-white' : 'bg-white/70 text-[var(--text-muted)] dark:bg-gray-800/70 dark:text-[var(--text-muted)]'
                  )}>
                    {tab.count} {tab.unit}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-5">
          {activeTab === 'songs' && (
            songs.length > 0 ? (
              <div>
                <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-black/5 px-4 py-3 dark:bg-white/5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-[var(--text-muted)]">
                    当前共 {sortedSongs.length} 首歌曲，播放全部会按照这里的排序顺序开始播放。
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--text-muted)]">排序</span>
                    <div className="relative">
                      <select
                        value={songSort}
                        onChange={(event) => setSongSort(event.target.value as LocalSongSort)}
                        className="min-w-[180px] appearance-none rounded-xl border border-black/10 bg-black/5 py-2 pl-3 pr-10 text-sm font-medium text-[var(--text-secondary)] outline-none backdrop-blur-xl transition-colors hover:bg-black/10 focus:border-violet-400/70 focus:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-[var(--text-primary)] dark:hover:bg-white/15 dark:focus:border-violet-400/60 dark:focus:bg-white/15 [color-scheme:light] dark:[color-scheme:dark]"
                      >
                        {LOCAL_SONG_SORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  {sortedSongs.map((song, index) => (
                    <SongRow
                      key={`${song.id}-${song.platform}`}
                      song={song}
                      index={index}
                      playlist={sortedSongs}
                      playlistId="local-library"
                      playlistName="本地音乐"
                      showPlatform={false}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300/80 px-6 py-16 text-center text-[var(--text-muted)] dark:border-gray-700 dark:text-[var(--text-muted)]">
                <Music2 className="mx-auto mb-3 h-10 w-10 opacity-60" />
                <p className="text-base font-medium">还没有可播放的本地歌曲</p>
                <p className="mt-1 text-sm">支持扫描 mp3、flac、m4a、wav、ogg、opus 等常见音频格式</p>
                <div className="mt-5 flex justify-center">
                  {folders.length === 0 ? (
                    <button
                      onClick={() => setShowLibrarySettings(true)}
                      className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-600"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      打开库设置
                    </button>
                  ) : (
                    <button
                      onClick={() => void rescanFolders()}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white/70 px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-white dark:border-gray-700 dark:bg-gray-800/70 dark:text-[var(--text-secondary)] dark:hover:bg-gray-800"
                      disabled={isScanning}
                    >
                      <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
                      重新扫描目录
                    </button>
                  )}
                </div>
              </div>
            )
          )}

          {activeTab === 'albums' && (
            albumGroups.length > 0 ? (
              <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
                <div className="space-y-3 xl:max-h-[760px] xl:overflow-y-auto xl:pr-1">
                  {albumGroups.map((album) => {
                    const active = selectedAlbum?.id === album.id
                    return (
                      <div
                        key={album.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedAlbumId(album.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedAlbumId(album.id)
                          }
                        }}
                        className={cn(
                          'group rounded-2xl border p-3 transition-all outline-none',
                          active
                            ? 'border-violet-400 bg-violet-500/10 shadow-sm dark:border-violet-400/60'
                            : 'border-white/20 bg-white/50 hover:bg-white/70 dark:border-gray-700/40 dark:bg-gray-800/40 dark:hover:bg-gray-800/60'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl">
                            {renderCollectionCover(album.cover, album.name, 'rounded-xl')}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{album.name}</p>
                            <p className="truncate text-xs text-[var(--text-muted)]">{album.artist}</p>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              {album.songs.length} 首 · {formatCollectionDuration(album.duration)}
                            </p>
                          </div>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              void handlePlayCollection(album.songs, buildLocalPlaylistId('album', album.id), album.name)
                            }}
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500 text-white transition-colors hover:bg-violet-600"
                            aria-label={`播放专辑 ${album.name}`}
                          >
                            <Play className="ml-0.5 h-4 w-4" fill="white" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {selectedAlbum && (
                  <div className="rounded-3xl border border-white/20 bg-white/45 p-5 backdrop-blur-xl dark:border-gray-700/40 dark:bg-gray-800/40">
                    <div className="flex flex-col gap-5 md:flex-row">
                      <div className="h-36 w-36 flex-shrink-0 overflow-hidden rounded-2xl shadow-sm">
                        {renderCollectionCover(selectedAlbum.cover, selectedAlbum.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-500">本地专辑</p>
                        <h3 className="mt-2 truncate text-2xl font-bold">{selectedAlbum.name}</h3>
                        <button
                          onClick={() => {
                            const targetArtist = artistGroups.find((artist) => artist.name === selectedAlbum.artist)
                            setActiveTab('artists')
                            if (targetArtist) {
                              setSelectedArtistId(targetArtist.id)
                            }
                          }}
                          className="mt-2 text-left text-sm text-[var(--text-muted)] transition-colors hover:text-violet-500 dark:text-[var(--text-muted)] dark:hover:text-violet-300"
                        >
                          {selectedAlbum.artist}
                        </button>
                        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--text-muted)]">
                          <span>{selectedAlbum.songs.length} 首歌曲</span>
                          <span>{formatCollectionDuration(selectedAlbum.duration)}</span>
                        </div>
                        <div className="mt-5 flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => void handlePlayCollection(selectedAlbum.songs, buildLocalPlaylistId('album', selectedAlbum.id), selectedAlbum.name)}
                            className="inline-flex items-center gap-2 rounded-2xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-600"
                          >
                            <Play className="h-4 w-4" />
                            播放这张专辑
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-[var(--text-secondary)]">专辑歌曲</h4>
                        <span className="text-xs text-[var(--text-muted)]">{selectedAlbum.songs.length} 首</span>
                      </div>
                      <div className="space-y-1">
                        {selectedAlbum.songs.map((song, index) => (
                          <SongRow
                            key={`${selectedAlbum.id}-${song.id}-${index}`}
                            song={song}
                            index={index}
                            playlist={selectedAlbum.songs}
                            playlistId={buildLocalPlaylistId('album', selectedAlbum.id)}
                            playlistName={selectedAlbum.name}
                            showAlbum={false}
                            showPlatform={false}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300/80 px-6 py-16 text-center text-[var(--text-muted)] dark:border-gray-700 dark:text-[var(--text-muted)]">
                <Disc className="mx-auto mb-3 h-10 w-10 opacity-60" />
                <p className="text-base font-medium">还没有可浏览的本地专辑</p>
                <p className="mt-1 text-sm">扫描完成后，会按歌曲内嵌的专辑信息自动归类。</p>
              </div>
            )
          )}

          {activeTab === 'artists' && (
            artistGroups.length > 0 ? (
              <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
                <div className="space-y-3 xl:max-h-[760px] xl:overflow-y-auto xl:pr-1">
                  {artistGroups.map((artist) => {
                    const active = selectedArtist?.id === artist.id
                    return (
                      <div
                        key={artist.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedArtistId(artist.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedArtistId(artist.id)
                          }
                        }}
                        className={cn(
                          'group rounded-2xl border p-3 transition-all outline-none',
                          active
                            ? 'border-violet-400 bg-violet-500/10 shadow-sm dark:border-violet-400/60'
                            : 'border-white/20 bg-white/50 hover:bg-white/70 dark:border-gray-700/40 dark:bg-gray-800/40 dark:hover:bg-gray-800/60'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl">
                            {renderCollectionCover(artist.cover, artist.name, 'rounded-xl')}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{artist.name}</p>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              {artist.albums.length} 张专辑 · {artist.songs.length} 首歌曲
                            </p>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              {formatCollectionDuration(artist.duration)}
                            </p>
                          </div>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              void handlePlayCollection(artist.songs, buildLocalPlaylistId('artist', artist.id), artist.name)
                            }}
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500 text-white transition-colors hover:bg-violet-600"
                            aria-label={`播放艺术家 ${artist.name}`}
                          >
                            <Play className="ml-0.5 h-4 w-4" fill="white" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {selectedArtist && (
                  <div className="rounded-3xl border border-white/20 bg-white/45 p-5 backdrop-blur-xl dark:border-gray-700/40 dark:bg-gray-800/40">
                    <div className="flex flex-col gap-5 md:flex-row">
                      <div className="h-36 w-36 flex-shrink-0 overflow-hidden rounded-2xl shadow-sm">
                        {renderCollectionCover(selectedArtist.cover, selectedArtist.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-500">本地艺术家</p>
                        <h3 className="mt-2 truncate text-2xl font-bold">{selectedArtist.name}</h3>
                        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--text-muted)]">
                          <span>{selectedArtist.songs.length} 首歌曲</span>
                          <span>{selectedArtist.albums.length} 张专辑</span>
                          <span>{formatCollectionDuration(selectedArtist.duration)}</span>
                        </div>
                        <div className="mt-5 flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => void handlePlayCollection(selectedArtist.songs, buildLocalPlaylistId('artist', selectedArtist.id), selectedArtist.name)}
                            className="inline-flex items-center gap-2 rounded-2xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-600"
                          >
                            <Play className="h-4 w-4" />
                            播放这位艺术家
                          </button>
                        </div>
                      </div>
                    </div>

                    {selectedArtist.albums.length > 0 && (
                      <div className="mt-6">
                        <div className="mb-3 flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-[var(--text-secondary)]">收录专辑</h4>
                          <span className="text-xs text-[var(--text-muted)]">{selectedArtist.albums.length} 张</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedArtist.albums.map((album) => (
                            <button
                              key={album.id}
                              onClick={() => {
                                setActiveTab('albums')
                                setSelectedAlbumId(album.id)
                              }}
                              className="rounded-full bg-black/5 px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-violet-500/10 hover:text-violet-600 dark:bg-white/10 dark:text-[var(--text-secondary)] dark:hover:text-violet-300"
                            >
                              {album.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-6">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-[var(--text-secondary)]">艺术家歌曲</h4>
                        <span className="text-xs text-[var(--text-muted)]">{selectedArtist.songs.length} 首</span>
                      </div>
                      <div className="space-y-1">
                        {selectedArtist.songs.map((song, index) => (
                          <SongRow
                            key={`${selectedArtist.id}-${song.id}-${index}`}
                            song={song}
                            index={index}
                            playlist={selectedArtist.songs}
                            playlistId={buildLocalPlaylistId('artist', selectedArtist.id)}
                            playlistName={selectedArtist.name}
                            showPlatform={false}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300/80 px-6 py-16 text-center text-[var(--text-muted)] dark:border-gray-700 dark:text-[var(--text-muted)]">
                <Users className="mx-auto mb-3 h-10 w-10 opacity-60" />
                <p className="text-base font-medium">还没有可浏览的本地艺术家</p>
                <p className="mt-1 text-sm">扫描完成后，会按歌曲内嵌的歌手信息自动归类。</p>
              </div>
            )
          )}
        </div>
      </section>
    </div>
  )
}
