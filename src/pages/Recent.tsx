import { Clock, Play } from 'lucide-react'
import { useUserStore } from '@/stores/userStore'
import { usePlayerStore } from '@/stores/playerStore'
import VirtualSongList from '@/components/VirtualSongList'

export default function Recent() {
  const recentlyPlayed = useUserStore((s) => s.recentlyPlayed)
  const { playSong, setPlaylist } = usePlayerStore()

  const handlePlayRecent = () => {
    if (recentlyPlayed.length > 0) {
      setPlaylist(recentlyPlayed, 'recent')
      playSong(recentlyPlayed[0], recentlyPlayed, 'recent')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">最近播放</h1>

      {recentlyPlayed.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[var(--text-muted)]">{recentlyPlayed.length} 首歌曲</p>
            <button
              onClick={handlePlayRecent}
              className="btn-primary gap-1.5"
            >
              <Play className="w-4 h-4" />
              播放全部
            </button>
          </div>
          <div>
            <VirtualSongList
              songs={recentlyPlayed}
              playlistId="recent"
              scrollable={false}
            />
          </div>
        </div>
      ) : (
        <div className="text-center py-20 text-[var(--text-muted)]">
          <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>还没有播放记录</p>
        </div>
      )}
    </div>
  )
}
