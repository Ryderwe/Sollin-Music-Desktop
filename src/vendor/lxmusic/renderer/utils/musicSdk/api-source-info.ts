// API source preset list.
// Keep the structure parallel to lx-music-desktop so we can plug extra presets (test/temp/...) later.
// The default preset stays empty on purpose: Sollin uses LX scripts (aka "user_api") to resolve playback URLs,
// matching lx-music-desktop's out-of-the-box behavior.

export interface ApiSourceInfoItem {
  id: string
  name: string
  disabled: boolean
  supportQualitys: Record<string, string[]>
}

const sources: ApiSourceInfoItem[] = []

export default sources
