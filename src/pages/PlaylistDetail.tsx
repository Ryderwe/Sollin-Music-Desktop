import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Play, Shuffle, MoreHorizontal, Trash2, Edit, ArrowLeft, Search } from 'lucide-react'
import ExpandableSearch from '@/components/ui/ExpandableSearch'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useUserStore } from '@/stores/userStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import VirtualSongList from '@/components/VirtualSongList'
import { formatDuration, formatDate } from '@/utils/format'
import type { Playlist } from '@/types'
import CoverImage from '@/components/ui/CoverImage'

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { playlists, localPlaylists, deletePlaylist, deleteLocalPlaylist } = useUserStore()
  const { playSong, setPlaylist, setPlayMode } = usePlayerStore()
  const { addToast } = useUIStore()

  const [playlist, setPlaylistData] = useState<Playlist | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const found = playlists.find((p) => p.id === id) || localPlaylists.find((p) => p.id === id)
    if (found) {
      setPlaylistData(found)
      setEditName(found.name)
    }
  }, [id, localPlaylists, playlists])

  const filteredSongs = useMemo(() => {
    if (!playlist || !searchQuery.trim()) return playlist?.songs || []

    const query = searchQuery.toLowerCase().trim()
    return playlist.songs.filter(song =>
      song.name.toLowerCase().includes(query) ||
      song.artist.toLowerCase().includes(query)
    )
  }, [playlist, searchQuery])

  if (!playlist) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-[var(--text-muted)]">歌单不存在</p>
      </div>
    )
  }

  const totalDuration = playlist.songs.reduce((sum, song) => sum + (song.duration || 0), 0)
  const isLocalPlaylist = playlist.id.startsWith('local_playlist_')

  const handlePlayAll = () => {
    if (playlist.songs.length > 0) {
      setPlaylist(playlist.songs, playlist.id, playlist.name)
      playSong(playlist.songs[0], playlist.songs, playlist.id, undefined, playlist.name)
    }
  }

  const handleShufflePlay = () => {
    if (playlist.songs.length > 0) {
      setPlayMode('shuffle')
      setPlaylist(playlist.songs, playlist.id, playlist.name)
      const idx = Math.floor(Math.random() * playlist.songs.length)
      playSong(playlist.songs[idx], playlist.songs, playlist.id, undefined, playlist.name)
    }
  }

  const handleDelete = async () => {
    if (confirm('确定要删除这个歌单吗？')) {
      if (isLocalPlaylist) {
        await deleteLocalPlaylist(playlist.id)
        addToast({ type: 'success', message: '本地歌单已删除' })
      } else {
        await deletePlaylist(playlist.id)
        addToast({ type: 'success', message: '歌单已删除' })
      }
      navigate('/library')
    }
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      >
        <ArrowLeft className="w-4 h-4" />
        返回
      </button>

      {/* Header */}
      <div className="flex items-end gap-6">
        <div className="w-48 h-48 rounded-2xl overflow-hidden bg-gradient-to-br from-primary-500 to-pink-500 shadow-xl flex-shrink-0">
          {(playlist.cover || playlist.songs[0]?.cover) ? (
            <CoverImage
              src={playlist.cover || playlist.songs[0]?.cover}
              alt={playlist.name}
              className="w-full h-full"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white text-6xl font-bold">
              {playlist.name[0]}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-[var(--text-muted)] mb-1">歌单</p>
          <div className="flex items-start justify-between gap-4 mb-3">
            {isEditing ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="input text-3xl font-bold min-w-0"
                autoFocus
                onBlur={() => setIsEditing(false)}
              />
            ) : (
              <h1 className="text-4xl font-bold min-w-0 truncate">{playlist.name}</h1>
            )}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={handlePlayAll}
                disabled={playlist.songs.length === 0}
                className="btn-primary gap-1.5"
              >
                <Play className="w-4 h-4" />
                播放
              </button>
              <button
                onClick={handleShufflePlay}
                disabled={playlist.songs.length === 0}
                className="btn-icon"
                title="随机播放"
                aria-label="随机播放"
              >
                <Shuffle className="w-4 h-4" />
              </button>
              {playlist.songs.length > 0 && (
                <ExpandableSearch value={searchQuery} onChange={setSearchQuery} />
              )}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button className="btn-icon">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="min-w-40 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-1 z-50"
                    sideOffset={5}
                  >
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                      onClick={() => setIsEditing(true)}
                    >
                      <Edit className="w-4 h-4" />
                      编辑歌单
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none text-red-500"
                      onClick={handleDelete}
                    >
                      <Trash2 className="w-4 h-4" />
                      删除歌单
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
          {playlist.description && (
            <p className="text-[var(--text-muted)] mb-2">{playlist.description}</p>
          )}
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <span>{playlist.songCount} 首歌曲</span>
            <span>·</span>
            <span>{formatDuration(totalDuration)}</span>
            <span>·</span>
            <span>更新于 {formatDate(playlist.updatedAt)}</span>
          </div>
        </div>
      </div>

      {/* Songs */}
      {playlist.songs.length > 0 ? (
        filteredSongs.length > 0 ? (
          <div>
            {searchQuery && (
              <div className="text-sm text-[var(--text-muted)] mb-2">
                找到 {filteredSongs.length} 首歌曲
              </div>
            )}
            <VirtualSongList
              songs={filteredSongs}
              playlist={playlist.songs}
              playlistId={playlist.id}
              playlistName={playlist.name}
              scrollable={false}
            />
          </div>
        ) : (
          <div className="text-center py-20 text-[var(--text-muted)]">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>未找到匹配的歌曲</p>
            <p className="text-sm mt-1">试试其他关键词</p>
          </div>
        )
      ) : (
        <div className="text-center py-20 text-[var(--text-muted)]">
          <p>这个歌单还没有歌曲</p>
          <p className="text-sm mt-1">去搜索并添加一些歌曲吧</p>
        </div>
      )}
    </div>
  )
}
