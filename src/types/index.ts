// Music Platform Types
export type Platform = 'netease' | 'kuwo' | 'qq' | 'kugou' | 'migu'
export type SongPlatform = Platform | 'local'

export type AudioQuality = '128k' | '320k' | 'flac' | 'flac24bit' | 'hires' | 'atmos' | 'master'
export type LyricsPlayerMode = 'default' | 'amll' | 'mineradio'

export interface LxSongQualityMeta {
  type: AudioQuality
  size?: string
  hash?: string
}

export interface LxSongMeta {
  source: 'wy' | 'tx' | 'kw' | 'kg' | 'mg'
  songmid?: string
  songId?: string
  albumId?: string
  albumMid?: string
  strMediaMid?: string
  hash?: string
  copyrightId?: string
  lrcUrl?: string
  mrcUrl?: string
  trcUrl?: string
  interval?: string
  albumName?: string
  img?: string
  types?: LxSongQualityMeta[]
  _types?: Record<string, { size?: string; hash?: string }>
}

// Song Types
export interface Song {
  id: string
  name: string
  artist: string
  artists?: Artist[]
  album: string
  albumId?: string
  duration: number // in seconds
  cover?: string
  url?: string
  lrc?: string
  platform: SongPlatform
  quality?: AudioQuality
  lx?: LxSongMeta
  localPath?: string
  localFolder?: string
  localFileSize?: number
  localModifiedAt?: string
  localTrackNo?: number
  localDiscNo?: number
}

export interface LocalSongEmbeddedTags {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  composers?: string[]
  genres?: string[]
  year?: number
  trackNo?: number
  trackTotal?: number
  discNo?: number
  discTotal?: number
  comment?: string
  lyrics?: string
  tlyric?: string
  rlyric?: string
  lxlyric?: string
}

export interface LocalSongMetadataRequest {
  filePath: string
  rootFolderPath?: string
  skipExternalFallback?: boolean
}

export interface LocalSongMetadataDetail {
  song: Song
  filePath: string
  fileName: string
  directoryPath: string
  rootFolderPath?: string
  fileSize?: number
  modifiedAt?: string
  duration: number
  cover?: string
  format?: string
  codec?: string
  bitrate?: number
  sampleRate?: number
  bitsPerSample?: number
  lossless?: boolean
  tags: LocalSongEmbeddedTags
}

export interface LocalSongMetadataUpdatePayload extends LocalSongMetadataRequest {
  tags: LocalSongEmbeddedTags
}

export interface Artist {
  id: string
  name: string
  avatar?: string
  platform: Platform
}

export interface Album {
  id: string
  name: string
  artist: string
  artistId?: string
  cover?: string
  releaseDate?: string
  songs?: Song[]
  platform: Platform
}

export interface AlbumDetail extends Album {
  description?: string
  songs: Song[]
}

// Playlist Types
export interface Playlist {
  id: string
  name: string
  description?: string
  cover?: string
  creator?: User
  songs: Song[]
  songCount: number
  playCount?: number
  platform?: Platform
  createdAt: string
  updatedAt: string
  isPublic: boolean
}

export interface PlaylistSummary {
  id: string
  name: string
  creator?: string
  cover?: string
  trackCount?: number
  playCount?: number
  platform: Platform
}

// Online Playlist (imported from external platforms)
export interface OnlinePlaylist {
  id: string
  sourceId: string // Original external resource ID when available
  source: Platform // Primary source platform
  name: string
  description?: string
  author?: string
  cover?: string
  songs: OnlinePlaylistSong[]
  songCount: number
  importedAt: string
  externalType?: string | null
  autoUpdate?: boolean
  lastSyncedAt?: string | null
  lastSyncError?: string | null
}

// Song info from online playlist API (minimal info, needs enrichment)
export interface OnlinePlaylistSong {
  id: string
  name: string
  artist: string
  album: string
  duration: number
  cover?: string
  url?: string
  platform: Platform
  types: string[] // Available quality types like ["flac", "320k", "128k"]
}

// User Types
export interface User {
  id: string
  username: string
  email?: string
  avatar?: string
  nickname?: string
  createdAt: string
  role: 'user' | 'admin'
  preferences: UserPreferences
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  quality: AudioQuality
  language: 'zh-CN' | 'en-US'
  autoPlay: boolean
  showLyrics: boolean
}

// Player Types
export type PlayMode = 'sequence' | 'loop' | 'single' | 'shuffle'

export interface PlayerState {
  currentSong: Song | null
  playlist: Song[]
  playlistId?: string
  /** Display name for the queue origin (playlist / list title). */
  playlistName?: string
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  playMode: PlayMode
  isLoading: boolean
}

export interface AudioEffectsState {
  audioVisualizationEnabled: boolean
  eqEnabled: boolean
  eqPresetId: string
  eqGains: Record<number, number>
  reverbEnabled: boolean
  reverbPresetId: string
  reverbMainGain: number
  reverbSendGain: number
  spatialAudioEnabled: boolean
  spatialAudioRadius: number
  spatialAudioSpeed: number
  playbackRate: number
}

// Search Types
export interface SearchResult {
  songs: Song[]
  artists?: Artist[]
  albums?: Album[]
  playlists?: PlaylistSummary[]
  hasMore: boolean
  total: number
}

export interface AggregateSearchResult {
  keyword: string
  total: number
  results: {
    platform: Platform
    songs: Song[]
  }[]
}

// Toplist Types
export interface Toplist {
  id: string
  name: string
  description?: string
  cover?: string
  updateTime?: string
  platform: Platform
}

// Recommend Playlist Types
export interface RecommendPlaylist {
  id: string
  name: string
  cover: string
  playCount?: number
  description?: string
  platform: Platform
}

export interface PlaylistSortOption {
  id: string
  name: string
}

export interface PlaylistTagItem {
  id: string
  name: string
  parentId?: string
  parentName?: string
  platform: Platform
}

export interface PlaylistTagGroup {
  name: string
  list: PlaylistTagItem[]
}

export interface PlaylistTagInfo {
  hotTag: PlaylistTagItem[]
  tags: PlaylistTagGroup[]
  platform: Platform
}

export interface RecommendPlaylistPage {
  playlists: RecommendPlaylist[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

// Playlist Detail (from API with full info)
export interface PlaylistDetail {
  id: string
  name: string
  description: string
  cover: string
  author: string
  playCount?: number
  songs: Song[]
  platform: Platform
}

export interface PaginatedSongsResult {
  songs: Song[]
  total: number
  page: number
  limit: number
  hasMore: boolean
  info?: PlaylistDetail
}

export interface LyricWord {
  startTime: number
  endTime: number
  text: string
}

export interface LyricData {
  lyric: string
  tlyric?: string
  rlyric?: string
  lxlyric?: string
}

export interface SongCommentUser {
  id?: string
  name: string
  avatar?: string
}

export interface SongComment {
  id: string
  rootId?: string
  text: string
  time?: number
  timeStr?: string
  location?: string
  images?: string[]
  likedCount?: number
  liked?: boolean
  replyNum?: number
  user: SongCommentUser
  reply?: SongComment[]
}

export interface SongCommentPage {
  source: 'wy' | 'tx' | 'kw' | 'kg' | 'mg'
  comments: SongComment[]
  total: number
  page: number
  limit: number
  maxPage: number
}

// API Response Types
export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

// Local Storage Types
export interface UserLibrary {
  favorites: Song[]
  recentlyPlayed: Song[]
  playlists: Playlist[]
  downloadedSongs: Song[]
}

// Admin Stats Types
export interface PlatformStats {
  platform: Platform
  requests: number
  successRate: number
}

export interface DailyStats {
  date: string
  totalRequests: number
  byPlatform: PlatformStats[]
  byType: {
    type: string
    count: number
  }[]
}

export interface AdminStats {
  today: DailyStats
  week: DailyStats[]
  month: DailyStats[]
  qps: number
}
