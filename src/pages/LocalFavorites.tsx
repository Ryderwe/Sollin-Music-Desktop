import { Heart, Play } from 'lucide-react'
import { useUserStore } from '@/stores/userStore'
import { usePlayerStore } from '@/stores/playerStore'
import VirtualSongList from '@/components/VirtualSongList'

export default function LocalFavorites() {
  const localFavorites = useUserStore((s) => s.localFavorites)
  const { playSong, setPlaylist } = usePlayerStore()

  const handlePlayLocalFavorites = () => {
    if (localFavorites.length > 0) {
      setPlaylist(localFavorites, 'local-favorites', '本地收藏')
      playSong(localFavorites[0], localFavorites, 'local-favorites', undefined, '本地收藏')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">本地收藏</h1>

      {localFavorites.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[var(--text-muted)]">{localFavorites.length} 首歌曲</p>
            <button
              onClick={handlePlayLocalFavorites}
              className="btn-primary gap-1.5"
            >
              <Play className="w-4 h-4" />
              播放全部
            </button>
          </div>
          <div>
            <VirtualSongList
              songs={localFavorites}
              playlistId="local-favorites"
              playlistName="本地收藏"
              showPlatform={false}
              scrollable={false}
            />
          </div>
        </div>
      ) : (
        <div className="text-center py-20 text-[var(--text-muted)]">
          <Heart className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>还没有本地收藏</p>
          <p className="text-sm mt-1">在本地音乐里点击心形即可收藏</p>
        </div>
      )}
    </div>
  )
}
