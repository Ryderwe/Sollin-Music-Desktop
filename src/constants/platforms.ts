import type { Platform } from '@/types'

export const ONLINE_MUSIC_PLATFORMS: Array<{ id: Platform; name: string }> = [
  { id: 'netease', name: '小芸音乐' },
  { id: 'qq', name: '小秋音乐' },
  { id: 'kugou', name: '小枸音乐' },
  { id: 'kuwo', name: '小蜗音乐' },
  { id: 'migu', name: '小蜜音乐' },
]

export const ONLINE_MUSIC_PLATFORM_OPTIONS = ONLINE_MUSIC_PLATFORMS.map(({ id, name }) => ({
  value: id,
  label: name,
}))
