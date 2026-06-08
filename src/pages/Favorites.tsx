import { Heart, Play } from 'lucide-react'
import { useUserStore } from '@/stores/userStore'
import { usePlayerStore } from '@/stores/playerStore'
import VirtualSongList from '@/components/VirtualSongList'

export default function Favorites() {
  const favorites = useUserStore((s) => s.favorites)
  const { playSong, setPlaylist } = usePlayerStore()

  const handlePlayFavorites = () => {
    if (favorites.length > 0) {
      setPlaylist(favorites, 'favorites')
      playSong(favorites[0], favorites, 'favorites')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">在线收藏</h1>

      {favorites.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[var(--text-muted)]">{favorites.length} 首歌曲</p>
            <button
              onClick={handlePlayFavorites}
              className="btn-primary gap-1.5"
            >
              <Play className="w-4 h-4" />
              播放全部
            </button>
          </div>
          <div className="h-[calc(100vh-220px)] min-h-[300px]">
            <VirtualSongList
              songs={favorites}
              playlistId="favorites"
            />
          </div>
        </div>
      ) : (
        <div className="text-center py-20 text-[var(--text-muted)]">
          <Heart className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>还没有喜欢的歌曲</p>
          <p className="text-sm mt-1">去发现一些好听的音乐吧</p>
        </div>
      )}
    </div>
  )
}
