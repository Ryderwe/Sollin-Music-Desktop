import { useState, useEffect, useMemo, useRef } from 'react'
import { Trash2, Play, HardDrive, FolderOpen, RefreshCw, ChevronDown, Settings2 } from 'lucide-react'
import { useLocalMusicStore } from '@/stores/localMusicStore'
import VirtualSongList from '@/components/VirtualSongList'
import { usePlayerStore } from '@/stores/playerStore'
import { cn } from '@/utils/cn'
import type { Song } from '@/types'

// Local song sort types and functions
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

const LOCAL_SONG_SORT_STORAGE_KEY = 'local-music-song-sort'

const localSongCollator = new Intl.Collator('zh-CN', {
  sensitivity: 'base',
  numeric: true,
})

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

export default function Library() {
  const { playSong, setPlaylist } = usePlayerStore()

  // Local music store
  const localMusicStore = useLocalMusicStore()
  const { songs: localSongs, folders, isScanning, lastScannedAt, pickFolders, rescanFolders, removeFolder } = localMusicStore
  const [songSort, setSongSort] = useState<LocalSongSort>(() => readLocalSongSort())
  const sortedLocalSongs = useMemo(() => sortLocalSongs(localSongs, songSort), [songSort, localSongs])

  const handlePlayLocalMusic = () => {
    if (sortedLocalSongs.length > 0) {
      setPlaylist(sortedLocalSongs, 'local-library', '本地音乐')
      playSong(sortedLocalSongs[0], sortedLocalSongs, 'local-library', undefined, '本地音乐')
    }
  }

  const handlePickFolders = async () => {
    await pickFolders()
  }

  const handleRescanFolders = async () => {
    await rescanFolders()
  }

  const handleRemoveFolder = async (folder: string) => {
    if (confirm(`确定要移除目录「${folder}」吗？`)) {
      await removeFolder(folder)
    }
  }

  const formatScannedAt = (value: string | null) => {
    if (!value) return '未扫描'
    try {
      return new Date(value).toLocaleString('zh-CN', { hour12: false })
    } catch {
      return value
    }
  }

  const localMusicSummary = useMemo(() => {
    if (localSongs.length === 0) return '暂无歌曲'
    const artists = new Set(localSongs.map((s) => s.artist).filter(Boolean))
    return `${localSongs.length} 首歌曲 · ${artists.size} 位艺术家`
  }, [localSongs])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LOCAL_SONG_SORT_STORAGE_KEY, songSort)
  }, [songSort])

  return (
    <div className="space-y-6">
      {/* Header: title row with inline metadata and actions */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2 min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">本地音乐</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-muted)]">
            <span>{localMusicSummary}</span>
            {folders.length > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span>{folders.length} 个目录</span>
              </>
            )}
            {lastScannedAt && (
              <>
                <span className="opacity-40">·</span>
                <span>最近扫描 {formatScannedAt(lastScannedAt)}</span>
              </>
            )}
            {isScanning && (
              <span className="inline-flex items-center gap-1.5 text-violet-500 dark:text-violet-300">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                扫描中
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handlePlayLocalMusic}
            disabled={localSongs.length === 0}
            className="btn-primary gap-1.5"
          >
            <Play className="w-4 h-4" />
            播放全部
          </button>
          <FolderManagerButton
            folders={folders}
            isScanning={isScanning}
            onAddFolders={handlePickFolders}
            onRescan={handleRescanFolders}
            onRemoveFolder={handleRemoveFolder}
          />
        </div>
      </header>

      {/* Sort control and songs list */}
      {sortedLocalSongs.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--text-muted)]">
              共 {sortedLocalSongs.length} 首歌曲
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-muted)]">排序</span>
              <div className="relative">
                <select
                  value={songSort}
                  onChange={(event) => setSongSort(event.target.value as LocalSongSort)}
                  className="min-w-[160px] appearance-none rounded-xl border border-black/10 bg-black/5 py-2 pl-3 pr-10 text-sm font-medium text-[var(--text-secondary)] outline-none backdrop-blur-xl transition-colors hover:bg-black/10 focus:border-primary-400/70 focus:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-[var(--text-primary)] dark:hover:bg-white/15 dark:focus:border-primary-400/60 dark:focus:bg-white/15 [color-scheme:light] dark:[color-scheme:dark]"
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

          <div>
            <VirtualSongList
              songs={sortedLocalSongs}
              playlistId="local-library"
              playlistName="本地音乐"
              showPlatform={false}
              scrollable={false}
            />
          </div>
        </div>
      ) : (
        <div className="text-center py-16 text-[var(--text-muted)]">
          <HardDrive className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">还没有本地音乐</p>
          <p className="text-sm mt-1">点击「管理目录」添加本地音乐目录</p>
        </div>
      )}
    </div>
  )
}

function FolderManagerButton({
  folders,
  isScanning,
  onAddFolders,
  onRescan,
  onRemoveFolder,
}: {
  folders: string[]
  isScanning: boolean
  onAddFolders: () => void | Promise<void>
  onRescan: () => void | Promise<void>
  onRemoveFolder: (folder: string) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="btn-secondary gap-1.5"
      >
        <Settings2 className="w-4 h-4" />
        管理目录
        {folders.length > 0 && (
          <span className="ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-black/10 px-1.5 text-[11px] font-medium text-[var(--text-secondary)] dark:bg-white/15">
            {folders.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-80 rounded-2xl border border-black/5 bg-white/95 p-3 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-gray-800/95">
          <div className="flex items-center gap-2 px-1 pb-2">
            <button
              onClick={() => {
                void onAddFolders()
              }}
              disabled={isScanning}
              className="btn-secondary flex-1 gap-1.5 text-sm"
            >
              <FolderOpen className="w-4 h-4" />
              添加目录
            </button>
            {folders.length > 0 && (
              <button
                onClick={() => {
                  void onRescan()
                }}
                disabled={isScanning}
                className="btn-secondary gap-1.5 text-sm"
                title="重新扫描所有目录"
              >
                <RefreshCw className={cn('w-4 h-4', isScanning && 'animate-spin')} />
              </button>
            )}
          </div>

          {folders.length > 0 ? (
            <div className="border-t border-black/5 pt-2 dark:border-white/10">
              <p className="px-1 pb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                已添加目录
              </p>
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {folders.map((folder) => (
                  <li
                    key={folder}
                    className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-[var(--text-muted)]" />
                    <span className="flex-1 truncate text-sm" title={folder}>
                      {folder}
                    </span>
                    <button
                      onClick={() => {
                        void onRemoveFolder(folder)
                      }}
                      className="flex-shrink-0 rounded-md p-1 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                      title="移除目录"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="border-t border-black/5 px-2 py-3 text-center text-xs text-[var(--text-muted)] dark:border-white/10">
              还没有添加任何目录
            </div>
          )}
        </div>
      )}
    </div>
  )
}
