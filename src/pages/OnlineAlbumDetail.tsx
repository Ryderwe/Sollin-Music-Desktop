import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Play, ArrowLeft, Music } from 'lucide-react'
import ExpandableSearch from '@/components/ui/ExpandableSearch'
import api from '@/services/api'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import SongRow from '@/components/SongRow'
import CoverImage from '@/components/ui/CoverImage'
import { getPlatformName } from '@/utils/format'
import type { AlbumDetail, Platform } from '@/types'

export default function OnlineAlbumDetail() {
  const { platform, id } = useParams<{ platform: Platform; id: string }>()
  const navigate = useNavigate()
  const { playSong, setPlaylist } = usePlayerStore()
  const { addToast } = useUIStore()

  const [albumDetail, setAlbumDetail] = useState<AlbumDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const loadAlbum = async() => {
      if (!platform || !id) return

      setIsLoading(true)
      try {
        const detail = await api.getAlbumDetail(platform as Platform, id)
        setAlbumDetail(detail)
      } catch (error) {
        console.error('Load album error:', error)
        addToast({ type: 'error', message: '加载专辑失败' })
      } finally {
        setIsLoading(false)
      }
    }

    loadAlbum()
  }, [platform, id, addToast])

  const filteredSongs = useMemo(() => {
    if (!albumDetail || !searchQuery.trim()) return albumDetail?.songs || []

    const query = searchQuery.toLowerCase().trim()
    return albumDetail.songs.filter((song) => (
      song.name.toLowerCase().includes(query)
      || song.artist.toLowerCase().includes(query)
    ))
  }, [albumDetail, searchQuery])

  const handlePlayAll = () => {
    if (albumDetail && albumDetail.songs.length > 0) {
      setPlaylist(albumDetail.songs, `online-album-${platform}-${id}`)
      playSong(albumDetail.songs[0], albumDetail.songs, `online-album-${platform}-${id}`)
    }
  }


  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!albumDetail) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[var(--text-muted)] mb-4">专辑不存在、暂未支持或加载失败</p>
        <button onClick={() => navigate(-1)} className="btn-secondary">
          返回
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>

        <div className="flex items-start gap-6">
          <div className="w-40 h-40 rounded-2xl overflow-hidden bg-gradient-to-br from-primary-500 to-pink-500 flex-shrink-0 shadow-lg">
            {albumDetail.cover ? (
              <CoverImage
                src={albumDetail.cover}
                alt={albumDetail.name}
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Music className="w-16 h-16 text-white/50" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="px-3 py-1 rounded-full bg-primary-500/10 text-primary-500 text-sm font-medium">
                专辑
              </span>
              <span className="px-3 py-1 rounded-full bg-white/50 dark:bg-gray-800/50 text-xs text-[var(--text-muted)]">
                {getPlatformName(albumDetail.platform)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 mb-2">
              <h1 className="text-3xl font-bold min-w-0 truncate">{albumDetail.name}</h1>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={handlePlayAll} className="btn-primary gap-1.5">
                  <Play className="w-4 h-4" />
                  播放
                </button>
                <ExpandableSearch value={searchQuery} onChange={setSearchQuery} />
              </div>
            </div>
            <p className="text-lg text-[var(--text-secondary)] mb-2">{albumDetail.artist || '未知歌手'}</p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--text-muted)] mb-5">
              <span>{albumDetail.songs.length} 首歌曲</span>
              {albumDetail.releaseDate && (
                <span>{new Date(albumDetail.releaseDate).toLocaleDateString('zh-CN')}</span>
              )}
            </div>


            {albumDetail.description && (
              <p className="text-sm text-[var(--text-muted)] leading-6 line-clamp-4">
                {albumDetail.description}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">

        <div className="flex-1 overflow-y-auto space-y-1">
          {filteredSongs.length > 0 ? (
            filteredSongs.map((song, index) => (
              <SongRow
                key={`${song.id}-${song.platform}-${index}`}
                song={song}
                index={index}
                playlist={filteredSongs}
                playlistId={`online-album-${platform}-${id}`}
                showPlatform={false}
              />
            ))
          ) : (
            <div className="text-center py-16 text-[var(--text-muted)]">
              <p>{searchQuery ? '没有找到匹配歌曲' : '暂无歌曲'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
