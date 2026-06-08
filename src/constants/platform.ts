import type { Platform, SongPlatform } from '@/types'

// Single source of truth for the display name of each music platform.
// Keep in sync with the brand-specific naming scheme used by Sollin.
export const PLATFORM_NAMES: Record<Platform, string> = {
  netease: '小芸音乐',
  qq: '小秋音乐',
  kugou: '小枸音乐',
  kuwo: '小蜗音乐',
  migu: '小蜜音乐',
}

export const PLATFORM_SHORT_NAMES: Record<Platform, string> = {
  netease: '小芸',
  qq: '小秋',
  kugou: '小枸',
  kuwo: '小蜗',
  migu: '小蜜',
}

export function getPlatformName(platform: SongPlatform | null | undefined): string {
  if (!platform || platform === 'local') return '本地'
  return PLATFORM_NAMES[platform as Platform] || platform
}

export function getPlatformShortName(platform: SongPlatform | null | undefined): string {
  if (!platform || platform === 'local') return '本地'
  return PLATFORM_SHORT_NAMES[platform as Platform] || platform
}
