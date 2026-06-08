import type { AudioQuality } from '@/types'

export const AUDIO_QUALITIES_ASC: AudioQuality[] = [
  '128k',
  '320k',
  'flac',
  'flac24bit',
  'hires',
  'atmos',
  'master',
]

export const AUDIO_QUALITIES_DESC: AudioQuality[] = [...AUDIO_QUALITIES_ASC].reverse()

export const QUALITY_NAMES: Record<AudioQuality, string> = {
  '128k': '128K',
  '320k': '320K',
  'flac': 'FLAC',
  'flac24bit': '24Bit',
  'hires': 'Hi-Res',
  'atmos': 'Atmos',
  'master': 'Master',
}

export const QUALITY_OPTIONS: Array<{ id: AudioQuality; label: string; desc: string }> = [
  { id: '128k', label: '标准', desc: '128kbps' },
  { id: '320k', label: '高品质', desc: '320kbps' },
  { id: 'flac', label: '无损', desc: 'FLAC' },
  { id: 'flac24bit', label: '24Bit', desc: '24bit FLAC' },
  { id: 'hires', label: 'Hi-Res', desc: '高解析度无损' },
  { id: 'atmos', label: 'Atmos', desc: '空间音频' },
  { id: 'master', label: 'Master', desc: '母带音质' },
]

export const isAudioQuality = (value: unknown): value is AudioQuality => {
  return typeof value === 'string' && AUDIO_QUALITIES_ASC.includes(value as AudioQuality)
}

export const getQualityFallbackChain = (quality: AudioQuality): AudioQuality[] => {
  const startIndex = AUDIO_QUALITIES_DESC.indexOf(quality)
  return startIndex >= 0
    ? AUDIO_QUALITIES_DESC.slice(startIndex)
    : [...AUDIO_QUALITIES_DESC]
}
