import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Song, PlayMode, AudioQuality, Platform, SongPlatform, LyricData, AudioEffectsState } from '@/types'
import { QUALITY_NAMES } from '@/constants/audio'
import api from '@/services/api'
import { playerCore, type PlayerCoreEvent } from '@/services/playerCore'
import { buildLocalSongPlaybackLyrics, clearCachedSongUrl, resolveSongPlaybackFallbackUrl, resolveSongPlaybackLyrics, resolveSongPlaybackResource } from '@/services/songPlayback'
import { toggleSourceRegistry } from '@/services/toggleSourceRegistry'
import { songRegistry } from '@/services/songRegistry'
import { useSourceSwitchSettingsStore } from '@/stores/sourceSwitchSettingsStore'
import { usePlaybackProgressStore } from '@/stores/playbackProgressStore'
import { useUserStore } from '@/stores/userStore'
import { useUIStore } from '@/stores/uiStore'
import { useFeatureStore } from '@/stores/featureStore'
import { analytics } from '@/services/analytics'
import { filterDislikedSongs, isDislikedSong } from '@/services/dislikeRules'
import { audioCache } from '@/services/audioCache'
import { getSongIdentityKey, isSamePlayableSong } from '@/utils/songIdentity'
import {
  DEFAULT_AUDIO_EFFECTS_SETTINGS,
  EQ_FREQUENCIES,
  EQ_PRESETS,
  attachAudioEffectsEngine,
  applyAudioEffectsSettings,
  resumeAudioEffectsEngine,
  setAudioEffectsOutputDevice,
} from '@/utils/audioEffects'

async function safePlayerStorageGet(name: string): Promise<string | null> {
  try {
    return window.localStorage?.getItem(name) ?? null
  } catch {
    return null
  }
}

async function safePlayerStorageSet(name: string, value: string): Promise<void> {
  try {
    window.localStorage?.setItem(name, value)
  } catch {
    // ignore
  }
}

// Debounced storage write to avoid serializing large playlist on every state change
let pendingWrite: { name: string; value: string } | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null
const PERSIST_DEBOUNCE_MS = 2000

async function debouncedPlayerStorageSet(name: string, value: string): Promise<void> {
  pendingWrite = { name, value }
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    if (pendingWrite) {
      safePlayerStorageSet(pendingWrite.name, pendingWrite.value)
      pendingWrite = null
    }
    writeTimer = null
  }, PERSIST_DEBOUNCE_MS)
}

// Flush pending writes immediately (called on beforeunload)
function flushPendingPlayerStorage() {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (pendingWrite) {
    try {
      window.localStorage?.setItem(pendingWrite.name, pendingWrite.value)
    } catch { /* ignore */ }
    pendingWrite = null
  }
}

// Ensure pending writes are flushed on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingPlayerStorage)
}

async function safePlayerStorageRemove(name: string): Promise<void> {
  try {
    window.localStorage?.removeItem(name)
  } catch {
    // ignore
  }
}

// Apply a persisted audio output device to the live <audio> element without going through the
// user-initiated setAudioOutputDevice action.  That action short-circuits when the stored id
// already equals the target (which is exactly the case on hydration), so we cannot rely on it
// to restore the device; instead we push the id straight into setSinkId / the audio effects
// context so the hardware output actually follows the saved preference on app restart.
async function applySavedAudioOutputDeviceToElement(
  audio: HTMLAudioElement | null,
  deviceId: string | null | undefined,
): Promise<void> {
  if (!audio || !deviceId || deviceId === 'default') return

  try {
    const audioEffectsSwitch = await setAudioEffectsOutputDevice(deviceId)
    if (audioEffectsSwitch.supported) return

    const mediaElement = audio as HTMLAudioElement & {
      setSinkId?: (sinkId: string) => Promise<void>
    }
    if (typeof mediaElement.setSinkId === 'function') {
      await mediaElement.setSinkId(deviceId)
    }
  } catch (error) {
    console.warn('[PlayerStore] Restore audio output device failed:', error)
  }
}

function stripSongRuntimeFields(song: Song): Song {
  const { url, ...rest } = song as any
  return rest as Song
}

function isSameSong(a: Song, b: Song): boolean {
  return isSamePlayableSong(a, b)
}

function getSongKey(song: Song): string {
  return getSongIdentityKey(song) ?? `${song.platform}:${song.id}`
}

function normalizePlaybackSrc(src: string): string {
  if (!src) return ''
  try {
    return new URL(src, window.location.href).href
  } catch {
    return src
  }
}

function describeMediaError(mediaError: MediaError | null | undefined): string | null {
  if (!mediaError) return null

  switch (mediaError.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'media aborted'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'media network error'
    case MediaError.MEDIA_ERR_DECODE:
      return 'media decode error'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'media source not supported'
    default:
      return `media error code ${mediaError.code}`
  }
}

function formatPlaybackError(error: unknown, audio?: HTMLAudioElement | null): string {
  const parts: string[] = []

  if (error instanceof DOMException) {
    parts.push(`${error.name}: ${error.message}`)
  } else if (error instanceof Error) {
    parts.push(`${error.name}: ${error.message}`)
  } else if (typeof error === 'string' && error.trim()) {
    parts.push(error.trim())
  } else if (error && typeof error === 'object') {
    try {
      parts.push(JSON.stringify(error))
    } catch {
      parts.push(String(error))
    }
  } else if (error != null) {
    parts.push(String(error))
  }

  const mediaErrorDescription = describeMediaError(audio?.error)
  if (mediaErrorDescription) {
    parts.push(mediaErrorDescription)
  }

  if (audio?.currentSrc) {
    parts.push(`src=${audio.currentSrc}`)
  }

  if (audio) {
    parts.push(`networkState=${audio.networkState}`)
    parts.push(`readyState=${audio.readyState}`)
  }

  return parts.join(' | ') || 'Unknown playback error'
}

function isInternalPlaybackError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'UnknownError' || /internal error/i.test(error.message)
  }
  if (error instanceof Error) {
    return /internal error/i.test(error.message)
  }
  return false
}

// AbortError gets thrown by audio.play() whenever a second setResource / play call happens
// before the previous one settles.  That is a completely normal interruption in our code path
// (e.g. the user clicked next while the previous song was still loading), and should not kick
// off the error-recovery flow.
function isPlaybackAborted(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError'
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' || /The play\(\) request was interrupted/i.test(error.message)
  }
  return false
}

export const MAX_PRELOAD_SONG_COUNT = 3

function normalizePreloadSongCount(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) return 0
  return Math.max(0, Math.min(MAX_PRELOAD_SONG_COUNT, Math.round(numericValue)))
}

function getNextSongAfterFailure(
  playlist: Song[],
  failedSong: Song,
  playMode: PlayMode,
  attemptedSongKeys: string[],
): Song | null {
  if (playlist.length === 0) return null

  const attemptedKeys = new Set(attemptedSongKeys)
  attemptedKeys.add(getSongKey(failedSong))

  if (attemptedKeys.size >= playlist.length) {
    return null
  }

  if (playMode === 'shuffle') {
    const candidates = playlist.filter((song) => !attemptedKeys.has(getSongKey(song)))
    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  const failedIndex = playlist.findIndex((item) => isSameSong(item, failedSong))
  const startIndex = failedIndex >= 0 ? failedIndex : -1

  for (let offset = 1; offset <= playlist.length; offset++) {
    const nextIndex = startIndex >= 0 ? (startIndex + offset) % playlist.length : offset - 1
    const candidate = playlist[nextIndex]

    if (candidate && !attemptedKeys.has(getSongKey(candidate))) {
      return candidate
    }
  }

  return null
}

interface PlaybackAttemptContext {
  attemptedSongKeys: string[]
}

interface PendingAudioCacheJob {
  key: string
  platform: string
  songId: string
  songName: string
  artist: string
  audioUrl: string
}

interface StartPlaybackOptions {
  playlist?: Song[]
  playlistId?: string
  attemptContext?: PlaybackAttemptContext
  startTime?: number
  requestedQuality?: AudioQuality
  refresh?: boolean
  allowTempSourceFallback?: boolean
  preserveRetryState?: boolean
  skipHistory?: boolean
  suppressInfoToasts?: boolean
  explicitSourceSwitch?: string | null
  explicitSourceSwitchInfo?: SourceSwitchInfo | null
  failedSongKeys?: string[]
  preserveUpcomingPlaybackPlan?: boolean
}

// Audio output device type
interface AudioOutputDevice {
  deviceId: string
  label: string
  kind: string
}

interface AudioOutputSwitchResult {
  success: boolean
  message?: string
}

type SleepTimerMode = 'timer' | 'songEnd'

// Structured payload backing the "临时换源" badge in the player UI.  The tag only shows when a
// fallback happened; the tooltip uses this structure so the user sees exactly which platform +
// song are backing the current playback.
export interface SourceSwitchInfo {
  fromPlatform: SongPlatform
  toPlatform: SongPlatform
  toSongId: string
  toSongName: string
  toSongArtist: string
  toSongAlbum?: string
}

// Additional replacement candidates surfaced by findMusic when the automatic winner may be
// wrong.  Let the UI offer a quick "pick another" fallback so the user does not have to wait
// for the retry loop to try the remaining candidates on its own.
export interface SourceSwitchAlternative {
  platform: SongPlatform
  id: string
  name: string
  artist: string
  album?: string
  duration: number
}

interface PlayerStore {
  // State
  currentSong: Song | null
  playbackSessionId: number
  playbackSessionKey: string | null
  playbackSessionSrc: string | null
  playlist: Song[]
  playlistId: string | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  playMode: PlayMode
  isLoading: boolean
  quality: AudioQuality
  preloadSongCount: number
  currentQuality: AudioQuality | null // Actual quality of currently playing song
  manualQualityOverride: boolean // Whether currentQuality was set by manual user switch
  sourceSwitch: string | null // Source switch info (e.g., "netease -> kuwo")
  sourceSwitchInfo: SourceSwitchInfo | null
  sourceSwitchAlternatives: SourceSwitchAlternative[]
  autoTemporarySourceSwitch: boolean
  lyrics: string | null
  lyricData: LyricData | null
  currentLyricIndex: number
  audioEffects: AudioEffectsState
  sleepTimerMode: SleepTimerMode | null
  sleepTimerEndAt: number | null
  sleepTimerRemainingSeconds: number

  // Audio output device
  audioOutputDeviceId: string // 'default' or device ID
  availableAudioDevices: AudioOutputDevice[]
  isSwitchingAudioOutputDevice: boolean

  // Audio element ref
  audioRef: HTMLAudioElement | null

  // Actions
  setAudioRef: (ref: HTMLAudioElement) => void
  playSong: (
    song: Song,
    playlist?: Song[],
    playlistId?: string,
    attemptContext?: PlaybackAttemptContext,
  ) => Promise<void>
  togglePlay: () => void
  pause: () => void
  resume: () => void
  playNext: () => void
  playPrevious: () => void
  setCurrentTime: (time: number) => void
  seek: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setPlayMode: (mode: PlayMode) => void
  setQuality: (quality: AudioQuality) => void
  setPreloadSongCount: (count: number) => void
  setAutoTemporarySourceSwitch: (enabled: boolean) => void
  setPlaylist: (songs: Song[], playlistId?: string) => void
  addToQueue: (song: Song) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  shufflePlaylist: () => void
  switchSource: (platform: Platform) => Promise<void>
  switchQuality: (quality: AudioQuality) => Promise<AudioQuality | undefined>
  // Operations the "临时换源" popover uses to let the user overrule the automatic pick.
  rejectSourceSwitch: () => Promise<void>
  pickSourceSwitchAlternative: (alternative: SourceSwitchAlternative) => Promise<void>
  // Audio output device actions
  loadAudioDevices: () => Promise<void>
  setAudioOutputDevice: (deviceId: string) => Promise<AudioOutputSwitchResult>
  setAudioVisualizationEnabled: (enabled: boolean) => void
  setEqEnabled: (enabled: boolean) => void
  setEqPreset: (presetId: string) => void
  setEqGain: (frequency: number, gain: number) => void
  resetEq: () => void
  setReverbEnabled: (enabled: boolean) => void
  setReverbPreset: (presetId: string) => void
  setReverbMainGain: (gain: number) => void
  setReverbSendGain: (gain: number) => void
  setSpatialAudioEnabled: (enabled: boolean) => void
  setSpatialAudioRadius: (radius: number) => void
  setSpatialAudioSpeed: (speed: number) => void
  setPlaybackRate: (rate: number) => void
  startSleepTimer: (seconds: number) => void
  stopAfterCurrentSong: () => void
  stopSleepTimer: () => void
}

export const usePlayerStore = create<PlayerStore>()(
  persist(
    (set, get) => {
      let playerCoreUnsubscribe: (() => void) | null = null
      let activePlaybackRequestId = 0
      let requestIdAtLoadStart = 0
      let activeRequestedQuality: AudioQuality = '320k'
      let activeAllowTempSourceFallback = true
      let activeAttemptContext: PlaybackAttemptContext = { attemptedSongKeys: [] }
      let activeRetrySongKey: string | null = null
      let activeRetryCount = 0
      let activeFailedSongKeys = new Set<string>()
      // Tracks which alternative source (if any) was selected on the last resolution round.
      // When audio playback fails mid-stream we need both the origin song key and the active
      // toggle key so findMusic can pick a different candidate on the next attempt.
      let activeToggleSong: Song | null = null
      let activeOriginSong: Song | null = null
      let loadTimeoutId: number | null = null
      let sleepTimeoutId: number | null = null
      let sleepIntervalId: number | null = null
      let upcomingPlaybackPlan: Song[] = []
      let upcomingPlaybackPlanOriginKey: string | null = null
      let upcomingPlaybackPlanMode: PlayMode | null = null
      let upcomingPlaybackPlanPlaylistSignature: string | null = null
      let activePreloadRunId = 0
      const pendingAudioCacheJobs = new Map<string, PendingAudioCacheJob>()
      let flushPendingAudioCachePromise: Promise<void> | null = null

      const clearLoadTimeout = () => {
        if (loadTimeoutId == null) return
        window.clearTimeout(loadTimeoutId)
        loadTimeoutId = null
      }

      const getPlaylistSignature = (songs: Song[]) => songs.map(getSongKey).join('|')

      const clearUpcomingPlaybackPlan = () => {
        upcomingPlaybackPlan = []
        upcomingPlaybackPlanOriginKey = null
        upcomingPlaybackPlanMode = null
        upcomingPlaybackPlanPlaylistSignature = null
        activePreloadRunId += 1
      }

      const getAllowedSongs = (songs: Song[]) => (
        filterDislikedSongs(songs, useFeatureStore.getState().dislikeRules)
      )

      const isSongBlockedByRules = (song: Song) => (
        isDislikedSong(song, useFeatureStore.getState().dislikeRules)
      )

      const findNextAllowedSong = (songs: Song[], currentSong: Song, playMode: PlayMode) => {
        const allowedSongs = getAllowedSongs(songs)
        if (allowedSongs.length === 0) return null

        const currentIndex = allowedSongs.findIndex((item) => isSameSong(item, currentSong))
        if (playMode === 'shuffle') {
          const candidates = currentIndex >= 0 && allowedSongs.length > 1
            ? allowedSongs.filter((_, index) => index !== currentIndex)
            : allowedSongs
          return candidates[Math.floor(Math.random() * candidates.length)] || null
        }

        if (playMode === 'single' && currentIndex >= 0) {
          return allowedSongs[currentIndex] || null
        }

        const startIndex = currentIndex >= 0 ? currentIndex : -1
        return allowedSongs[(startIndex + 1) % allowedSongs.length] || null
      }

      const isUpcomingPlaybackPlanValid = (
        currentSong: Song,
        playlist: Song[],
        playMode: PlayMode,
      ) => (
        upcomingPlaybackPlanOriginKey === getSongKey(currentSong)
        && upcomingPlaybackPlanMode === playMode
        && upcomingPlaybackPlanPlaylistSignature === getPlaylistSignature(playlist)
      )

      const resetUpcomingPlaybackPlan = (
        currentSong: Song,
        playlist: Song[],
        playMode: PlayMode,
        upcomingSongs: Song[] = [],
      ) => {
        upcomingPlaybackPlan = upcomingSongs
        upcomingPlaybackPlanOriginKey = getSongKey(currentSong)
        upcomingPlaybackPlanMode = playMode
        upcomingPlaybackPlanPlaylistSignature = getPlaylistSignature(playlist)
      }

      const pickShuffleNextSong = (playlist: Song[]) => {
        if (playlist.length === 0) return null
        return playlist[Math.floor(Math.random() * playlist.length)] || null
      }

      const getNextSongForPlayback = (
        playlist: Song[],
        currentSong: Song,
        playMode: PlayMode,
      ) => {
        if (playlist.length === 0) return null

        if (playMode === 'shuffle') {
          return pickShuffleNextSong(playlist)
        }

        const currentIndex = playlist.findIndex((song) => isSameSong(song, currentSong))

        if (playMode === 'single') {
          return currentIndex >= 0 ? playlist[currentIndex] : currentSong
        }

        return playlist[(currentIndex + 1) % playlist.length] || null
      }

      const fillUpcomingPlaybackPlan = (
        currentSong: Song,
        playlist: Song[],
        playMode: PlayMode,
        count: number,
      ) => {
        if (count <= 0) {
          resetUpcomingPlaybackPlan(currentSong, playlist, playMode, [])
          return []
        }

        if (!isUpcomingPlaybackPlanValid(currentSong, playlist, playMode)) {
          resetUpcomingPlaybackPlan(currentSong, playlist, playMode, [])
        }

        if (upcomingPlaybackPlan.length > count) {
          upcomingPlaybackPlan = upcomingPlaybackPlan.slice(0, count)
        }

        while (upcomingPlaybackPlan.length < count) {
          const cursorSong = upcomingPlaybackPlan[upcomingPlaybackPlan.length - 1] || currentSong
          const nextSong = getNextSongForPlayback(playlist, cursorSong, playMode)
          if (!nextSong) break
          upcomingPlaybackPlan = [...upcomingPlaybackPlan, nextSong]
        }

        return upcomingPlaybackPlan
      }

      const consumeUpcomingPlaybackPlan = (
        currentSong: Song,
        playlist: Song[],
        playMode: PlayMode,
      ) => {
        if (!isUpcomingPlaybackPlanValid(currentSong, playlist, playMode)) {
          clearUpcomingPlaybackPlan()
          return null
        }

        const [nextSong, ...remainingSongs] = upcomingPlaybackPlan
        if (!nextSong) return null

        resetUpcomingPlaybackPlan(nextSong, playlist, playMode, remainingSongs)
        return nextSong
      }

      const clearSleepTimerHandles = () => {
        if (sleepTimeoutId != null) {
          window.clearTimeout(sleepTimeoutId)
          sleepTimeoutId = null
        }
        if (sleepIntervalId != null) {
          window.clearInterval(sleepIntervalId)
          sleepIntervalId = null
        }
      }

      const clearSleepTimerState = () => {
        clearSleepTimerHandles()
        set({
          sleepTimerMode: null,
          sleepTimerEndAt: null,
          sleepTimerRemainingSeconds: 0,
        })
      }

      const stopPlaybackBySleepTimer = (message: string) => {
        clearSleepTimerState()
        playerCore.pause()
        set({ isPlaying: false, isLoading: false })
        useUIStore.getState().addToast({ type: 'success', message })
      }

      const syncDurationFromPlayerCore = () => {
        const duration = playerCore.getDuration()
        if (Number.isFinite(duration)) {
          usePlaybackProgressStore.getState().setDuration(duration)
        }
      }

      const getPlaybackSessionKey = (requestId: number, song: Song) => (
        `${requestId}:${getSongKey(song)}`
      )

      const isCurrentPlaybackEvent = (event: PlayerCoreEvent) => {
        const { playbackSessionSrc } = get()
        if (!playbackSessionSrc) {
          return !event.currentSrc
        }
        if (!event.currentSrc) return false
        return normalizePlaybackSrc(event.currentSrc) === normalizePlaybackSrc(playbackSessionSrc)
      }

      const pushSongRuntimeState = (
        song: Song,
        requestedQuality: AudioQuality,
        options: StartPlaybackOptions,
        requestId: number,
      ) => {
        const localLyrics = song.platform === 'local'
          ? buildLocalSongPlaybackLyrics(song.lrc)
          : { lyricData: null, lyrics: null }
        const sessionKey = getPlaybackSessionKey(requestId, song)

        set({
          currentSong: song,
          playbackSessionId: requestId,
          playbackSessionKey: sessionKey,
          playbackSessionSrc: null,
          isPlaying: false,
          isLoading: true,
          currentTime: options.startTime ?? 0,
          duration: 0,
          currentQuality: song.platform === 'local' ? null : requestedQuality,
          manualQualityOverride: false,
          sourceSwitch: null,
          sourceSwitchInfo: null,
          sourceSwitchAlternatives: [],
          lyricData: localLyrics.lyricData,
          lyrics: localLyrics.lyrics,
          currentLyricIndex: 0,
        })
        usePlaybackProgressStore.getState().reset(options.startTime ?? 0, 0)
      }

      const resetRecoveryState = (song: Song, options?: { preserveRetryState?: boolean }) => {
        const songKey = getSongKey(song)
        if (!options?.preserveRetryState || activeRetrySongKey !== songKey) {
          activeRetryCount = 0
          activeFailedSongKeys = new Set<string>()
          activeToggleSong = null
        }
        activeRetrySongKey = songKey
        activeOriginSong = song
        clearLoadTimeout()
      }

      const startLoadTimeout = () => {
        clearLoadTimeout()
        const currentSong = get().currentSong
        if (!currentSong) return

        const requestId = activePlaybackRequestId
        const songKey = getSongKey(currentSong)
        loadTimeoutId = window.setTimeout(() => {
          const latestSong = get().currentSong
          if (!latestSong || getSongKey(latestSong) !== songKey || requestId !== activePlaybackRequestId) {
            return
          }
          void recoverCurrentSongPlayback(new Error('Playback loading timeout'))
        }, 25000)
      }

      const flushPendingAudioCache = async() => {
        if (flushPendingAudioCachePromise || get().isPlaying || pendingAudioCacheJobs.size === 0) return

        const jobs = Array.from(pendingAudioCacheJobs.values())
        pendingAudioCacheJobs.clear()

        flushPendingAudioCachePromise = (async() => {
          for (const job of jobs) {
            try {
              await audioCache.cache(job.platform, job.songId, job.songName, job.artist, job.audioUrl)
            } catch (error) {
              console.error('Failed to cache audio after playback pause:', error)
            }
          }
        })().finally(() => {
          flushPendingAudioCachePromise = null
          if (!get().isPlaying && pendingAudioCacheJobs.size > 0) {
            void flushPendingAudioCache()
          }
        })

        await flushPendingAudioCachePromise
      }

      const loadLyricsForSong = async(song: Song, requestId: number) => {
        try {
          const { lyricData, lyrics } = await resolveSongPlaybackLyrics(song)
          if (requestId !== activePlaybackRequestId) return

          const currentSong = get().currentSong
          if (!currentSong || !isSameSong(currentSong, song)) return

          set({ lyricData, lyrics })
        } catch (error) {
          console.error('Load lyrics failed:', error)
        }
      }

      const preloadUpcomingSongUrls = async(requestId: number) => {
        const state = get()
        const currentSong = state.currentSong
        const preloadCount = normalizePreloadSongCount(state.preloadSongCount)
        const playlist = getAllowedSongs(state.playlist)

        if (!currentSong || preloadCount <= 0 || playlist.length === 0) {
          activePreloadRunId += 1
          return
        }

        const songsToPreload = fillUpcomingPlaybackPlan(currentSong, playlist, state.playMode, preloadCount)
        if (songsToPreload.length === 0) return

        const preloadRunId = ++activePreloadRunId
        const requestedQuality = state.quality
        const allowTempSourceFallback = state.autoTemporarySourceSwitch
        const originSongKey = getSongKey(currentSong)

        for (const song of songsToPreload) {
          const latestState = get()
          const latestSong = latestState.currentSong
          if (
            preloadRunId !== activePreloadRunId
            || requestId !== activePlaybackRequestId
            || !latestSong
            || getSongKey(latestSong) !== originSongKey
          ) {
            return
          }

          if (song.platform === 'local') continue

          try {
            await resolveSongPlaybackResource(song, {
              quality: requestedQuality,
              allowTempSourceFallback,
            })
          } catch (error) {
            console.warn('[PlayerStore] Preload song URL failed:', song.name, error)
          }
        }
      }

      const updateTrayInfo = (song: Song) => {
        if (!window.electronAPI) return
        window.electronAPI.updatePlayerInfo({
          title: song.name,
          artist: song.artist,
        })
      }

      const maybeShowPlaybackInfo = (
        song: Song,
        requestedQuality: AudioQuality,
        actualQuality: AudioQuality | null,
        sourceSwitch: string | null,
        suppressInfoToasts?: boolean,
      ) => {
        if (suppressInfoToasts || song.platform === 'local') return

        if (actualQuality && actualQuality !== requestedQuality) {
          useUIStore.getState().addToast({
            type: 'info',
            message: `当前音质无法播放，已自动降级至 ${QUALITY_NAMES[actualQuality]}`,
          })
        }

        if (sourceSwitch) {
          useUIStore.getState().addToast({
            type: 'info',
            message: `已临时切换音源：${sourceSwitch}`,
          })
        }
      }

      const advanceAfterPlaybackFailure = async(failedSong: Song) => {
        const playlist = getAllowedSongs(get().playlist)
        const attemptedSongKeys = [...activeAttemptContext.attemptedSongKeys, getSongKey(failedSong)]
        const nextSong = getNextSongAfterFailure(playlist, failedSong, get().playMode, attemptedSongKeys)

        if (nextSong) {
          useUIStore.getState().addToast({
            type: 'warning',
            message: `《${failedSong.name}》播放失败，已自动跳到下一首`,
          })
          await startPlayback(nextSong, {
            playlist,
            playlistId: get().playlistId || undefined,
            attemptContext: { attemptedSongKeys },
          })
          return
        }

        useUIStore.getState().addToast({
          type: 'error',
          message: playlist.length > 1
            ? '播放列表中的歌曲都尝试过了，但都播放失败'
            : `《${failedSong.name}》播放失败`,
        })
        set({ isLoading: false, isPlaying: false })
        playerCore.pause()
      }

      const recoverCurrentSongPlayback = async(error: unknown) => {
        const currentSong = get().currentSong
        if (!currentSong) {
          set({ isLoading: false, isPlaying: false })
          return
        }

        const songKey = getSongKey(currentSong)
        if (activeRetrySongKey !== songKey) {
          activeRetrySongKey = songKey
          activeRetryCount = 0
          activeFailedSongKeys = new Set<string>()
        }

        // Mark the source that just failed so the resolver skips its cache and, more importantly,
        // knows to route around it via findMusic on the next attempt.  We track both the origin
        // key (user-clicked song) and whichever toggle produced the URL we just tried.
        const originFallback = activeOriginSong && getSongKey(activeOriginSong) === songKey
          ? activeOriginSong
          : currentSong
        const failedSongs: Array<Song | null> = [originFallback, activeToggleSong]
        for (const entry of failedSongs) {
          if (!entry?.platform || !entry.id) continue
          activeFailedSongKeys.add(`${entry.platform}:${entry.id}`)
          clearCachedSongUrl(entry)
        }
        // Evict the sticky toggle for the origin song so findMusic is free to pick a different
        // replacement.  If the toggle itself was the thing that failed, this also prevents us
        // from reselecting it on the retry.
        if (originFallback?.platform && originFallback.id) {
          toggleSourceRegistry.clear(originFallback.platform, originFallback.id)
        }
        activeToggleSong = null

        if (activeRetryCount < 2) {
          activeRetryCount += 1
          const retrySong = originFallback ?? currentSong
          await startPlayback(retrySong, {
            startTime: playerCore.getCurrentTime(),
            requestedQuality: activeRequestedQuality,
            refresh: true,
            allowTempSourceFallback: activeAllowTempSourceFallback,
            preserveRetryState: true,
            skipHistory: true,
            suppressInfoToasts: true,
            attemptContext: activeAttemptContext,
            failedSongKeys: Array.from(activeFailedSongKeys),
          })
          return
        }

        console.error('Playback recovery exhausted:', formatPlaybackError(error, get().audioRef), error)

        if (isInternalPlaybackError(error)) {
          useUIStore.getState().addToast({
            type: 'error',
            message: '当前歌曲播放链路异常，已停止继续刷新播放链接',
          })
        }

        await advanceAfterPlaybackFailure(originFallback ?? currentSong)
      }

      const handlePlayerCoreEvent = (event: PlayerCoreEvent) => {
        switch (event.type) {
          case 'loadstart':
            if (!isCurrentPlaybackEvent(event)) break
            set({ isLoading: true })
            startLoadTimeout()
            break
          case 'loadeddata':
          case 'canplay':
          case 'durationchange':
            if (!isCurrentPlaybackEvent(event)) break
            syncDurationFromPlayerCore()
            break
          case 'playing':
            if (!isCurrentPlaybackEvent(event)) break
            clearLoadTimeout()
            syncDurationFromPlayerCore()
            set({ isPlaying: true, isLoading: false })
            void preloadUpcomingSongUrls(activePlaybackRequestId)
            break
          case 'pause':
            if (!isCurrentPlaybackEvent(event)) break
            set({ isPlaying: false })
            if (!get().isLoading) {
              void flushPendingAudioCache()
            }
            break
          case 'waiting':
            if (!isCurrentPlaybackEvent(event)) break
            if (get().currentSong) {
              set({ isLoading: true })
            }
            break
          case 'emptied':
            if (isCurrentPlaybackEvent(event)) {
              clearLoadTimeout()
            }
            break
          case 'ended':
            if (!isCurrentPlaybackEvent(event)) break
            clearLoadTimeout()
            if (requestIdAtLoadStart !== activePlaybackRequestId) break
            set({ isPlaying: false, isLoading: false })
            if (get().sleepTimerMode === 'songEnd') {
              stopPlaybackBySleepTimer('已在当前歌曲结束后暂停播放')
              break
            }
            void get().playNext()
            break
          case 'timeupdate':
            if (!isCurrentPlaybackEvent(event)) break
            usePlaybackProgressStore.getState().setCurrentTime(event.currentTime)
            break
          case 'error':
            if (!isCurrentPlaybackEvent(event)) break
            clearLoadTimeout()
            console.error('[PlayerCore] audio error:', event)
            void recoverCurrentSongPlayback(event.error || new Error(`Audio element error: ${event.currentSrc}`))
            break
        }
      }

      const startPlayback = async(song: Song, options: StartPlaybackOptions = {}) => {
        if (!playerCore.getAudio()) return

        const requestId = ++activePlaybackRequestId
        const requestedQuality = options.requestedQuality ?? get().quality
        const allowTempSourceFallback = options.allowTempSourceFallback ?? get().autoTemporarySourceSwitch

        activeRequestedQuality = requestedQuality
        activeAllowTempSourceFallback = allowTempSourceFallback
        activeAttemptContext = options.attemptContext ?? { attemptedSongKeys: [] }
        activePreloadRunId += 1
        if (!options.preserveUpcomingPlaybackPlan) {
          clearUpcomingPlaybackPlan()
        }
        resetRecoveryState(song, { preserveRetryState: options.preserveRetryState })
        if (Array.isArray(options.failedSongKeys)) {
          for (const key of options.failedSongKeys) activeFailedSongKeys.add(key)
        }

        if (options.playlist) {
          set({ playlist: options.playlist, playlistId: options.playlistId || null })
        }

        pushSongRuntimeState(song, requestedQuality, options, requestId)
        requestIdAtLoadStart = requestId

        try {
          const resource = await resolveSongPlaybackResource(song, {
            quality: requestedQuality,
            refresh: options.refresh,
            allowTempSourceFallback,
            excludeFailedSongKeys: Array.from(activeFailedSongKeys),
          })

          if (requestId !== activePlaybackRequestId) return

          let streamUrl = resource.streamUrl
          try {
            set({
              playbackSessionId: requestId,
              playbackSessionKey: getPlaybackSessionKey(requestId, song),
              playbackSessionSrc: streamUrl,
            })
            await playerCore.setResource(streamUrl, {
              autoplay: true,
              startTime: options.startTime,
            })
          } catch (playError) {
            if (isPlaybackAborted(playError)) {
              // Another startPlayback superseded us.  Do not trigger any retry chain - the new
              // playback is already in flight.
              return
            }
            if (requestId !== activePlaybackRequestId) return

            if (song.platform !== 'local') {
              console.warn('Remote audio direct streaming failed, retrying with resolved playback URL:', playError)
              const fallbackUrl = await resolveSongPlaybackFallbackUrl(resource.requestUrl)
              if (requestId !== activePlaybackRequestId) return
              if (fallbackUrl && fallbackUrl !== streamUrl) {
                streamUrl = fallbackUrl
                set({
                  playbackSessionId: requestId,
                  playbackSessionKey: getPlaybackSessionKey(requestId, song),
                  playbackSessionSrc: streamUrl,
                })
                try {
                  await playerCore.setResource(streamUrl, {
                    autoplay: true,
                    startTime: options.startTime,
                  })
                } catch (retryError) {
                  if (isPlaybackAborted(retryError)) return
                  throw retryError
                }
              } else {
                throw playError
              }
            } else if (song.localPath && window.electronAPI?.prepareLocalMusicPlayback) {
              console.warn('Local audio direct playback failed, retrying with converted source:', playError)
              streamUrl = await window.electronAPI.prepareLocalMusicPlayback(song.localPath)
              if (requestId !== activePlaybackRequestId) return
              set({
                playbackSessionId: requestId,
                playbackSessionKey: getPlaybackSessionKey(requestId, song),
                playbackSessionSrc: streamUrl,
              })
              try {
                await playerCore.setResource(streamUrl, {
                  autoplay: true,
                  startTime: options.startTime,
                })
              } catch (retryError) {
                if (isPlaybackAborted(retryError)) return
                throw retryError
              }
            } else {
              throw playError
            }
          }

          await resumeAudioEffectsEngine()

          if (requestId !== activePlaybackRequestId) return

          const sourceSwitch = options.explicitSourceSwitch ?? resource.sourceSwitch
          const playbackSong = {
            ...song,
            url: song.platform === 'local' ? streamUrl : resource.requestUrl,
          }

          activeToggleSong = resource.toggleSong ?? null

          const sourceSwitchInfo: SourceSwitchInfo | null = options.explicitSourceSwitchInfo
            ?? (resource.toggleSong
              ? {
                fromPlatform: song.platform,
                toPlatform: resource.toggleSong.platform,
                toSongId: resource.toggleSong.id,
                toSongName: resource.toggleSong.name,
                toSongArtist: resource.toggleSong.artist,
                toSongAlbum: resource.toggleSong.album || undefined,
              }
              : null)

          const alternativesForUi: SourceSwitchAlternative[] = sourceSwitchInfo
            ? (resource.toggleAlternatives || []).map((candidate) => ({
              platform: candidate.platform,
              id: candidate.id,
              name: candidate.name,
              artist: candidate.artist,
              album: candidate.album || undefined,
              duration: candidate.duration || 0,
            }))
            : []

          set({
            currentSong: playbackSong,
            playbackSessionId: requestId,
            playbackSessionKey: getPlaybackSessionKey(requestId, playbackSong),
            playbackSessionSrc: streamUrl,
            isPlaying: true,
            isLoading: false,
            currentQuality: resource.actualQuality,
            manualQualityOverride: false,
            sourceSwitch,
            sourceSwitchInfo,
            sourceSwitchAlternatives: alternativesForUi,
            currentTime: options.startTime ?? 0,
          })
          usePlaybackProgressStore.getState().setCurrentTime(options.startTime ?? 0)

          maybeShowPlaybackInfo(song, requestedQuality, resource.actualQuality, sourceSwitch, options.suppressInfoToasts)

          if (!options.skipHistory) {
            useUserStore.getState().addToRecentlyPlayed(playbackSong)
            useUserStore.getState().addToPlayHistory(playbackSong)
            analytics.trackSongPlay(song.id, song.platform)
            updateTrayInfo(song)
          }

          void loadLyricsForSong(song, requestId)
        } catch (error) {
          if (requestId !== activePlaybackRequestId) return
          if (isPlaybackAborted(error)) {
            // Superseded by the next startPlayback.  Let the newer request drive the UI.
            return
          }
          console.error('Error playing song:', formatPlaybackError(error, get().audioRef), error)
          set({ isLoading: false, isPlaying: false })
          await recoverCurrentSongPlayback(error)
        }
      }

      return {
      // Initial state
      currentSong: null,
      playbackSessionId: 0,
      playbackSessionKey: null,
      playbackSessionSrc: null,
      playlist: [],
      playlistId: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 0.8,
      isMuted: false,
      playMode: 'sequence',
      isLoading: false,
      quality: '320k',
      preloadSongCount: 0,
      currentQuality: null,
      manualQualityOverride: false,
      sourceSwitch: null,
      sourceSwitchInfo: null,
      sourceSwitchAlternatives: [],
      autoTemporarySourceSwitch: true,
      lyrics: null,
      lyricData: null,
      currentLyricIndex: 0,
      audioEffects: DEFAULT_AUDIO_EFFECTS_SETTINGS,
      sleepTimerMode: null,
      sleepTimerEndAt: null,
      sleepTimerRemainingSeconds: 0,
      audioRef: null,
      audioOutputDeviceId: 'default',
      availableAudioDevices: [],
      isSwitchingAudioOutputDevice: false,

      setAudioRef: (ref) => {
        ref.crossOrigin = 'anonymous'
        ref.setAttribute('crossorigin', 'anonymous')
        playerCore.bind(ref)
        playerCoreUnsubscribe?.()
        playerCoreUnsubscribe = playerCore.subscribe(handlePlayerCoreEvent)
        set({ audioRef: ref })
        try {
          attachAudioEffectsEngine(ref)
        } catch (error) {
          console.warn('[PlayerStore] Audio effects engine init failed, fallback to direct audio playback:', error)
        }

        // Apply persisted volume immediately
        const { volume, isMuted, audioEffects } = get()
        console.log('[PlayerStore] setAudioRef - applying volume:', { volume, isMuted })
        ref.volume = isMuted ? 0 : volume
        console.log('[PlayerStore] Audio ref volume set to:', ref.volume)
        applyAudioEffectsSettings(audioEffects)

        // Apply saved audio output device when audio ref is set.  Route through the low-level
        // helper (not the guarded setAudioOutputDevice action) because the action short-circuits
        // when the state id already matches the target, which is exactly the situation after
        // store hydration.
        const { audioOutputDeviceId } = get()
        void applySavedAudioOutputDeviceToElement(ref, audioOutputDeviceId)
      },

      loadAudioDevices: async () => {
        try {
          const previousDevices = get().availableAudioDevices
          const previousLabels = new Map(previousDevices.map((device) => [device.deviceId, device.label]))
          const devices = await navigator.mediaDevices.enumerateDevices()
          const audioOutputs = devices
            .filter(device => device.kind === 'audiooutput')
            .map(device => ({
              deviceId: device.deviceId,
              label: device.label || previousLabels.get(device.deviceId) || `音频输出 ${device.deviceId.slice(0, 8)}`,
              kind: device.kind,
            }))
          const devicesWithDefault = audioOutputs.some((device) => device.deviceId === 'default')
            ? audioOutputs
            : [{ deviceId: 'default', label: '系统默认', kind: 'audiooutput' }, ...audioOutputs]

          set({ availableAudioDevices: devicesWithDefault })
        } catch (error) {
          console.error('Failed to load audio devices:', error)
          set({
            availableAudioDevices: [{ deviceId: 'default', label: '系统默认', kind: 'audiooutput' }],
          })
        }
      },

      setAudioOutputDevice: async (deviceId: string) => {
        const { audioRef, audioOutputDeviceId, isSwitchingAudioOutputDevice } = get()
        if (!audioRef) {
          return { success: false, message: '播放器尚未初始化，暂时无法切换音频设备' }
        }

        if (audioOutputDeviceId === deviceId) {
          return { success: true }
        }

        if (isSwitchingAudioOutputDevice) {
          return { success: false, message: '正在切换音频设备，请稍后再试' }
        }

        const mediaElement = audioRef as HTMLAudioElement & {
          setSinkId?: (sinkId: string) => Promise<void>
        }

        const canSwitchMediaElementOutput = typeof mediaElement.setSinkId === 'function'
        const wasPlaying = !audioRef.paused && !audioRef.ended
        let playbackPausedForSwitch = false

        const pausePlaybackForSwitch = async () => {
          if (!wasPlaying) return
          playbackPausedForSwitch = true
          audioRef.pause()
          await new Promise((resolve) => window.setTimeout(resolve, 120))
        }

        const resumePlaybackAfterSwitch = async () => {
          if (!playbackPausedForSwitch) return
          playbackPausedForSwitch = false
          await audioRef.play()
          await resumeAudioEffectsEngine()
        }

        const trySetSinkId = async () => {
          await pausePlaybackForSwitch()

          const audioEffectsSwitch = await setAudioEffectsOutputDevice(deviceId)
          if (!audioEffectsSwitch.supported) {
            if (!canSwitchMediaElementOutput) {
              throw new DOMException('setSinkId is not supported', 'NotSupportedError')
            }
            await mediaElement.setSinkId!(deviceId)
          }

          set({ audioOutputDeviceId: deviceId })
          await resumePlaybackAfterSwitch()
          return { success: true } satisfies AudioOutputSwitchResult
        }

        set({ isSwitchingAudioOutputDevice: true })

        try {
          return await trySetSinkId()
        } catch (error) {
          const domError = error as DOMException | undefined

          if (domError?.name === 'AbortError') {
            try {
              await new Promise((resolve) => window.setTimeout(resolve, 150))
              return await trySetSinkId()
            } catch (retryError) {
              console.error('Failed to set audio output device after retry:', retryError)
              const retryDomError = retryError as DOMException | undefined
              const message = retryDomError?.name === 'AbortError'
                ? '设备切换被中断，请先关闭高级音效或暂停播放后重试'
                : retryDomError?.name === 'NotFoundError'
                  ? '所选音频设备已不可用，请刷新列表后重试'
                  : retryDomError?.name === 'NotSupportedError'
                    ? '当前音频链路不支持切换输出设备'
                  : '切换音频设备失败，请稍后重试'
              if (playbackPausedForSwitch) {
                void resumePlaybackAfterSwitch().catch(() => {})
              }
              void get().loadAudioDevices()
              return { success: false, message }
            }
          }

          console.error('Failed to set audio output device:', error)
          void get().loadAudioDevices()

          const message = domError?.name === 'NotFoundError'
            ? '所选音频设备已不可用，请刷新列表后重试'
            : domError?.name === 'SecurityError' || domError?.name === 'NotAllowedError'
              ? '当前系统或浏览器未允许切换音频设备'
              : domError?.name === 'NotSupportedError'
                ? '当前音频链路不支持切换输出设备'
              : '切换音频设备失败，请稍后重试'

          if (playbackPausedForSwitch) {
            void resumePlaybackAfterSwitch().catch(() => {})
          }
          return { success: false, message }
        } finally {
          set({ isSwitchingAudioOutputDevice: false })
        }
      },

      playSong: async (song, playlist, playlistId, attemptContext) => {
        const nextPlaylist = playlist ? getAllowedSongs(playlist) : undefined

        if (isSongBlockedByRules(song)) {
          const candidate = playlist
            ? findNextAllowedSong(playlist, song, get().playMode)
            : null

          if (candidate) {
            useUIStore.getState().addToast({
              type: 'warning',
              message: `《${song.name}》已匹配屏蔽规则，已跳过`,
            })
            await startPlayback(candidate, {
              playlist: nextPlaylist,
              playlistId,
              attemptContext,
            })
            return
          }

          if (nextPlaylist) {
            set({ playlist: nextPlaylist, playlistId: playlistId || null })
          }

          useUIStore.getState().addToast({
            type: 'warning',
            message: `《${song.name}》已匹配屏蔽规则，无法播放`,
          })
          return
        }

        await startPlayback(song, {
          playlist: nextPlaylist,
          playlistId,
          attemptContext,
        })
        return
/*
        const { audioRef, quality, autoTemporarySourceSwitch } = get()
        if (!audioRef) return

        // Don't update currentSong yet - wait until we successfully get the URL
        set({ isLoading: true })

        try {
          // Get song URL if not present
          const isProbablyUrl = (value: any): value is string => {
            if (typeof value !== 'string') return false
            const v = value.trim()
            if (!v) return false
            if (v.startsWith('//')) return true
            return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)
          }

          let url: string | undefined = isProbablyUrl(song.url) ? song.url : undefined
          let actualQuality: AudioQuality = quality
          let sourceSwitch: string | null = null
          let isFromCache = false
          let lyricData: LyricData | null = null
          let lyrics: string | null = null

          if (song.platform === 'local') {
            url = url || toFileUrlFromLocalPath(song.localPath) || undefined
            if (!url) {
              useUIStore.getState().addToast({ type: 'error', message: '本地文件路径无效，无法播放' })
              set({ isLoading: false })
              return
            }

            const localLyrics = buildLocalSongPlaybackLyrics(song.lrc)
            lyricData = localLyrics.lyricData
            lyrics = localLyrics.lyrics
          }

          // Check cache first
          if (!url && song.platform !== 'local') {
            const cachedUrl = await audioCache.get(song.platform, song.id)
            if (cachedUrl) {
              url = cachedUrl
              isFromCache = true
              console.log('Playing from cache:', song.name)
            }
          }

          // Original URL to cache later
          let originalUrl: string | undefined

          if (!url && song.platform !== 'local') {
            const result = await api.getSongUrl(song.platform, song.id, quality, {
              song,
              allowTempSourceFallback: autoTemporarySourceSwitch,
            })
            console.log('getSongUrl result:', result)
            if (result) {
              if (result.error) {
                console.error('API returned error:', result.error)
                const errorMessage = result.error.type === 'RATE_LIMIT'
                  ? '请求过于频繁，请稍后再试'
                  : result.error.message || '无法获取播放链接，请检查网络或会员状态'
                useUIStore.getState().addToast({ type: 'error', message: errorMessage })
                set({ isLoading: false })
                return
              }
              url = result.url
              originalUrl = result.url
              actualQuality = result.quality
              sourceSwitch = result.sourceSwitch || null

              if (actualQuality !== quality) {
                useUIStore.getState().addToast({
                  type: 'info',
                  message: `当前音质无法播放，已自动降级至 ${QUALITY_NAMES[actualQuality]}` ,
                })
              }

              if (sourceSwitch) {
                useUIStore.getState().addToast({
                  type: 'info',
                  message: `已临时切换音源：${sourceSwitch}`,
                })
              }
            }
          }

          if (!url) {
            console.error('Failed to get song URL')
            useUIStore.getState().addToast({ type: 'error', message: '无法获取播放链接，请检查网络或会员状态' })
            set({ isLoading: false })
            return
          }

          if (song.platform !== 'local') {
            lyricData = await api.getLyricData(song)
            lyrics = lyricData?.lyric || null
          }

          // Update playlist if provided
          if (playlist) {
            set({ playlist, playlistId: playlistId || null })
          }

          const playableUrl = song.platform === 'local'
            ? url
            : await resolvePlaybackUrl(url)

          const finalPlaybackUrl = await playAudioSource(audioRef, playableUrl, {
            localPath: song.platform === 'local' ? song.localPath : undefined,
          })
          await resumeAudioEffectsEngine()

          revokePlaybackBlobUrl(get().currentSong?.url)

          const updatedSong = {
            ...song,
            url: finalPlaybackUrl,
          }

          set({
            currentSong: updatedSong,
            isPlaying: true,
            isLoading: false,
            currentQuality: song.platform === 'local' ? null : actualQuality,
            manualQualityOverride: false,
            sourceSwitch: song.platform === 'local' ? null : sourceSwitch,
            lyrics,
            lyricData,
            currentTime: 0,
          })
          usePlaybackProgressStore.getState().reset(0, 0)

          // Avoid fetching and writing the whole remote track on the renderer hot path.
          if (song.platform !== 'local' && !isFromCache && originalUrl) {
            const key = `${song.platform}:${song.id}`
            pendingAudioCacheJobs.set(key, {
              key,
              platform: song.platform,
              songId: song.id,
              songName: song.name,
              artist: song.artist,
              audioUrl: originalUrl,
            })
          }

          // Add to recently played (local storage)
          useUserStore.getState().addToRecentlyPlayed(updatedSong)
          useUserStore.getState().addToPlayHistory(updatedSong)

          // Track song play
          analytics.trackSongPlay(song.id, song.platform)

          // Update electron tray
          if (window.electronAPI) {
            window.electronAPI.updatePlayerInfo({
              title: song.name,
              artist: song.artist,
            })
          }
        } catch (error) {
          console.error('Error playing song:', formatPlaybackError(error, audioRef), error)
          if (isInternalPlaybackError(error)) {
            useUIStore.getState().addToast({
              type: 'error',
              message: '当前播放链路在桌面端初始化失败，已停止自动重试',
            })
            audioRef.pause()
            set({ isLoading: false, isPlaying: false })
            return
          }
          const effectivePlaylist = playlist || get().playlist
          const attemptedSongKeys = [...(attemptContext?.attemptedSongKeys || []), getSongKey(song)]
          const nextSong = getNextSongAfterFailure(effectivePlaylist, song, get().playMode, attemptedSongKeys)

          if (nextSong) {
            useUIStore.getState().addToast({
              type: 'warning',
              message: `《${song.name}》播放失败，已自动跳到下一首`,
            })
            set({ isLoading: false, isPlaying: false })
            await get().playSong(
              nextSong,
              effectivePlaylist,
              playlistId || get().playlistId || undefined,
              { attemptedSongKeys },
            )
            return
          }

          useUIStore.getState().addToast({
            type: 'error',
            message: effectivePlaylist.length > 1
              ? '播放列表中的歌曲都尝试过了，但都播放失败'
              : `《${song.name}》播放失败`,
          })
          audioRef.pause()
          set({ isLoading: false, isPlaying: false })
        }
*/
      },

      togglePlay: () => {
        const storeState = get()
        const currentSongForToggle = storeState.currentSong
        const playlistForToggle = storeState.playlist
        if (!playerCore.getAudio()) return

        if (!currentSongForToggle && playlistForToggle.length > 0) {
          void storeState.playSong(playlistForToggle[0], playlistForToggle)
          return
        }

        if (!currentSongForToggle) return

        if (!storeState.isPlaying && playerCore.isEmpty()) {
          void storeState.playSong(currentSongForToggle, playlistForToggle)
          return
        }

        if (storeState.isPlaying) {
          playerCore.pause()
          set({ isPlaying: false })
          return
        }

        void playerCore.play().then(async() => {
          await resumeAudioEffectsEngine()
          set({ isPlaying: true })
        }).catch((error) => {
          console.error('Resume playback failed:', error)
        })
        return
/*
        const { audioRef, isPlaying, currentSong, playlist, playSong } = get()
        if (!audioRef) return

        // If no current song but have playlist, play the first song
        if (!currentSong && playlist.length > 0) {
          playSong(playlist[0], playlist)
          return
        }

        if (!currentSong) return

        // If we have a song but the audio element has no source (fresh launch), re-fetch URL and start playback.
        if (!isPlaying && (!audioRef.src || audioRef.readyState === 0)) {
          playSong(currentSong, playlist)
          return
        }

        if (isPlaying) {
          audioRef.pause()
          set({ isPlaying: false })
        } else {
          audioRef.play()
          void resumeAudioEffectsEngine()
          set({ isPlaying: true })
        }
*/
      },

      pause: () => {
        if (playerCore.getAudio()) {
          playerCore.pause()
          set({ isPlaying: false })
          return
        }
/*
        const { audioRef } = get()
        if (audioRef) {
          audioRef.pause()
          set({ isPlaying: false })
        }
*/
      },

      resume: () => {
        if (playerCore.getAudio()) {
          void playerCore.play().then(async() => {
            await resumeAudioEffectsEngine()
            set({ isPlaying: true })
          }).catch((error) => {
            console.error('Resume playback failed:', error)
          })
          return
        }
/*
        const { audioRef } = get()
        if (audioRef) {
          audioRef.play()
          void resumeAudioEffectsEngine()
          set({ isPlaying: true })
        }
*/
      },

      playNext: () => {
        const { currentSong, playMode } = get()
        const playlist = getAllowedSongs(get().playlist)
        if (playlist.length === 0 || !currentSong) return

        const plannedNextSong = consumeUpcomingPlaybackPlan(currentSong, playlist, playMode)
        const nextSong = plannedNextSong ?? getNextSongForPlayback(playlist, currentSong, playMode)
        if (nextSong) {
          void startPlayback(nextSong, {
            playlist,
            playlistId: get().playlistId || undefined,
            preserveUpcomingPlaybackPlan: Boolean(plannedNextSong),
          })
        }
      },

      playPrevious: () => {
        const { currentSong, playMode } = get()
        const playlist = getAllowedSongs(get().playlist)
        if (playlist.length === 0 || !currentSong) return

        const currentIndex = playlist.findIndex((song) => isSameSong(song, currentSong))

        let prevIndex: number

        if (playMode === 'shuffle') {
          prevIndex = Math.floor(Math.random() * playlist.length)
        } else if (playMode === 'single') {
          prevIndex = currentIndex >= 0 ? currentIndex : 0
        } else {
          prevIndex = currentIndex - 1 < 0 ? playlist.length - 1 : currentIndex - 1
        }

        const prevSong = playlist[prevIndex]
        if (prevSong) {
          get().playSong(prevSong, playlist, get().playlistId || undefined)
        }
      },

      setCurrentTime: (time) => {
        usePlaybackProgressStore.getState().setCurrentTime(time)
        set({ currentTime: time })
      },

      seek: (time) => {
        const { audioRef } = get()
        if (audioRef) {
          audioRef.currentTime = time
          usePlaybackProgressStore.getState().setCurrentTime(time)
          set({ currentTime: time })
        }
      },

      setDuration: (duration) => {
        usePlaybackProgressStore.getState().setDuration(duration)
        set({ duration })
      },

      setVolume: (volume) => {
        const { audioRef } = get()
        console.log('[PlayerStore] setVolume called:', volume)
        if (audioRef) {
          audioRef.volume = volume
          console.log('[PlayerStore] Audio element volume updated to:', audioRef.volume)
        }
        set({ volume, isMuted: volume === 0 })
      },

      toggleMute: () => {
        const { audioRef, isMuted, volume } = get()
        if (audioRef) {
          if (isMuted) {
            audioRef.volume = volume || 0.8
            set({ isMuted: false })
          } else {
            audioRef.volume = 0
            set({ isMuted: true })
          }
        }
      },

      setPlayMode: (mode) => {
        clearUpcomingPlaybackPlan()
        set({ playMode: mode })
        if (get().isPlaying) {
          void preloadUpcomingSongUrls(activePlaybackRequestId)
        }
      },

      setQuality: (quality) => {
        activePreloadRunId += 1
        set({ quality })
        if (get().isPlaying) {
          void preloadUpcomingSongUrls(activePlaybackRequestId)
        }
      },
      setPreloadSongCount: (count) => {
        const preloadSongCount = normalizePreloadSongCount(count)
        clearUpcomingPlaybackPlan()
        set({ preloadSongCount })
        if (get().isPlaying) {
          void preloadUpcomingSongUrls(activePlaybackRequestId)
        }
      },
      setAutoTemporarySourceSwitch: (enabled) => {
        activePreloadRunId += 1
        set({ autoTemporarySourceSwitch: enabled })
        if (get().isPlaying) {
          void preloadUpcomingSongUrls(activePlaybackRequestId)
        }
        // Keep the structured source-switch settings in sync so UI toggles in either panel
        // (legacy single switch or new pipeline panel) stay consistent.
        try {
          useSourceSwitchSettingsStore.getState().setEnabled(enabled)
        } catch (error) {
          console.warn('[playerStore] sync sourceSwitchSettings.enabled failed:', error)
        }
      },

      setPlaylist: (songs, playlistId) => {
        clearUpcomingPlaybackPlan()
        set({ playlist: getAllowedSongs(songs), playlistId: playlistId || null })
        if (get().isPlaying) {
          void preloadUpcomingSongUrls(activePlaybackRequestId)
        }
      },

      addToQueue: (song) => {
        if (isSongBlockedByRules(song)) {
          useUIStore.getState().addToast({
            type: 'warning',
            message: `《${song.name}》已匹配屏蔽规则，未加入播放队列`,
          })
          return
        }

        const { playlist, currentSong } = get()
        const currentIndex = currentSong
          ? playlist.findIndex((song) => isSameSong(song, currentSong))
          : -1

        const newPlaylist = [...playlist]
        newPlaylist.splice(currentIndex + 1, 0, song)
        clearUpcomingPlaybackPlan()
        set({ playlist: newPlaylist })
        if (get().isPlaying) {
          void preloadUpcomingSongUrls(activePlaybackRequestId)
        }
      },

      removeFromQueue: (index) => {
        const { playlist } = get()
        const newPlaylist = [...playlist]
        newPlaylist.splice(index, 1)
        clearUpcomingPlaybackPlan()
        set({ playlist: newPlaylist })
        if (get().isPlaying) {
          void preloadUpcomingSongUrls(activePlaybackRequestId)
        }
      },

      clearQueue: () => {
        clearUpcomingPlaybackPlan()
        set({ playlist: [], playlistId: null })
      },

      shufflePlaylist: () => {
        const { currentSong } = get()
        const playlist = getAllowedSongs(get().playlist)
        if (playlist.length <= 1) return

        const shuffled = [...playlist]
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
            ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
        }

        // Move current song to front if exists
        if (currentSong) {
          const currentIndex = shuffled.findIndex((song) => isSameSong(song, currentSong))
          if (currentIndex > 0) {
            const [current] = shuffled.splice(currentIndex, 1)
            shuffled.unshift(current)
          }
        }

        clearUpcomingPlaybackPlan()
        set({ playlist: shuffled })
        if (get().isPlaying) {
          void preloadUpcomingSongUrls(activePlaybackRequestId)
        }
      },

      switchSource: async (platform: Platform) => {
        const storeState = get()
        const currentSongForSwitch = storeState.currentSong
        if (!currentSongForSwitch) return
        if (currentSongForSwitch.platform === 'local') return

        set({ isLoading: true })

        try {
          const searchResult = await api.search(platform, `${currentSongForSwitch.name} ${currentSongForSwitch.artist}`, 5)
          if (searchResult.songs.length === 0) {
            set({ isLoading: false })
            return
          }

          const matchedSong = searchResult.songs[0]
          const updatedSong: Song = {
            ...currentSongForSwitch,
            ...matchedSong,
            platform,
          }

          await startPlayback(updatedSong, {
            startTime: usePlaybackProgressStore.getState().currentTime,
            requestedQuality: storeState.quality,
            allowTempSourceFallback: false,
            explicitSourceSwitch: `${currentSongForSwitch.platform} -> ${platform}`,
            explicitSourceSwitchInfo: {
              fromPlatform: currentSongForSwitch.platform,
              toPlatform: platform,
              toSongId: matchedSong.id,
              toSongName: matchedSong.name,
              toSongArtist: matchedSong.artist,
              toSongAlbum: matchedSong.album || undefined,
            },
          })
          return
        } catch (error) {
          console.error('Switch source error:', error)
          set({ isLoading: false })
          return
        }
/*
        const { audioRef, currentSong, currentTime, quality } = get()
        if (!audioRef || !currentSong) return
        if (currentSong.platform === 'local') return

        set({ isLoading: true })

        try {
          // Search for the same song on the new platform
          const searchResult = await api.search(platform, `${currentSong.name} ${currentSong.artist}`, 5)

          if (searchResult.songs.length === 0) {
            set({ isLoading: false })
            return
          }

          // Find the best match (first result for now)
          const matchedSong = searchResult.songs[0]

          // Get URL from new platform
          const result = await api.getSongUrl(platform, matchedSong.id, quality, { song: matchedSong })

          if (!result) {
            set({ isLoading: false })
            return
          }

          const playableUrl = await resolvePlaybackUrl(result.url)

          // Update song with new platform info
          const updatedSong: Song = {
            ...currentSong,
            ...matchedSong,
            platform,
            url: playableUrl,
          }

          const lyricData = await api.getLyricData(updatedSong)
          const lyrics = lyricData?.lyric || get().lyrics

          const finalPlaybackUrl = await playAudioSource(audioRef, playableUrl, { startTime: currentTime })
          await resumeAudioEffectsEngine()
          revokePlaybackBlobUrl(get().currentSong?.url)

          set({
            currentSong: { ...updatedSong, url: finalPlaybackUrl },
            isPlaying: true,
            isLoading: false,
            currentQuality: result.quality,
            manualQualityOverride: false,
            sourceSwitch: `${currentSong.platform} -> ${platform}`,
            lyrics,
            lyricData: lyricData || get().lyricData,
          })
        } catch (error) {
          console.error('Switch source error:', error)
          set({ isLoading: false })
        }
*/
      },

      rejectSourceSwitch: async () => {
        const storeState = get()
        const currentSong = storeState.currentSong
        const rejectedInfo = storeState.sourceSwitchInfo
        if (!currentSong || !rejectedInfo) return

        // Treat the current toggle just like a playback error: mark it failed, evict the sticky
        // entry, and rerun resolution so findMusic gets a fresh shot at the remaining candidates.
        const originKey = `${rejectedInfo.fromPlatform}:${currentSong.id}`
        const toggleKey = `${rejectedInfo.toPlatform}:${rejectedInfo.toSongId}`
        const failedKeys = Array.from(new Set([originKey, toggleKey]))

        // 清 songUrl 缓存 + 清粘性 toggle，下次 startPlayback 会完全重跑 findMusic
        clearCachedSongUrl(currentSong)
        const rejectedStub: Song = {
          id: rejectedInfo.toSongId,
          name: rejectedInfo.toSongName,
          artist: rejectedInfo.toSongArtist,
          album: rejectedInfo.toSongAlbum || '',
          duration: 0,
          platform: rejectedInfo.toPlatform,
        }
        clearCachedSongUrl(rejectedStub)
        toggleSourceRegistry.clear(rejectedInfo.fromPlatform, currentSong.id)

        useUIStore.getState().addToast({
          type: 'info',
          message: '已记录「不是这首歌」，正在重新寻找可用音源',
        })

        const originSong: Song = activeOriginSong && getSongKey(activeOriginSong) === getSongKey(currentSong)
          ? activeOriginSong
          : { ...currentSong, platform: rejectedInfo.fromPlatform, id: currentSong.id }

        await startPlayback(originSong, {
          startTime: playerCore.getCurrentTime(),
          requestedQuality: storeState.quality,
          refresh: true,
          allowTempSourceFallback: true,
          preserveRetryState: false,
          skipHistory: true,
          suppressInfoToasts: false,
          failedSongKeys: failedKeys,
        })
      },

      pickSourceSwitchAlternative: async (alternative: SourceSwitchAlternative) => {
        const storeState = get()
        const currentSong = storeState.currentSong
        const switchInfo = storeState.sourceSwitchInfo
        if (!currentSong || !alternative) return

        const fromPlatform = switchInfo?.fromPlatform ?? currentSong.platform
        const originSong: Song = activeOriginSong && getSongKey(activeOriginSong) === getSongKey(currentSong)
          ? activeOriginSong
          : { ...currentSong, platform: fromPlatform, id: currentSong.id }

        // Pre-register the picked alternative as the sticky toggle so the next resolution round
        // reuses it without running findMusic again.  api.getSongUrl will overwrite this on its
        // own if the alternative cannot actually play back.
        const alternativeAsSong: Song = {
          id: alternative.id,
          name: alternative.name,
          artist: alternative.artist,
          album: alternative.album || '',
          duration: alternative.duration || 0,
          platform: alternative.platform,
        }
        toggleSourceRegistry.set(fromPlatform, currentSong.id, alternativeAsSong)
        songRegistry.rememberSong(alternativeAsSong)
        // Clear any cached URL so we force a fresh LX source request for the picked song.
        clearCachedSongUrl(originSong)
        clearCachedSongUrl(alternativeAsSong)

        useUIStore.getState().addToast({
          type: 'info',
          message: `已切换至《${alternative.name}》`,
        })

        await startPlayback(originSong, {
          startTime: playerCore.getCurrentTime(),
          requestedQuality: storeState.quality,
          refresh: true,
          allowTempSourceFallback: true,
          preserveRetryState: false,
          skipHistory: true,
          suppressInfoToasts: true,
        })
      },

      switchQuality: async (newQuality: AudioQuality) => {
        const storeState = get()
        const currentSongForQuality = storeState.currentSong
        if (!currentSongForQuality) return
        if (currentSongForQuality.platform === 'local') {
          set({ currentQuality: null })
          throw new Error('本地歌曲不支持切换在线音质')
        }

        if (storeState.currentQuality === newQuality) {
          return newQuality
        }

        set({ isLoading: true })

        try {
          const previousQuality = storeState.currentQuality
          await startPlayback(currentSongForQuality, {
            startTime: usePlaybackProgressStore.getState().currentTime,
            requestedQuality: newQuality,
            refresh: true,
            skipHistory: true,
          })
          set({ manualQualityOverride: true })

          const actualQuality = get().currentQuality
          if (!actualQuality || actualQuality === previousQuality) {
            set({ isLoading: false })
            throw new Error(`该歌曲无法切换到 ${QUALITY_NAMES[newQuality]}，当前已是可用音质`)
          }

          return actualQuality
        } catch (error) {
          console.error('Switch quality error:', error)
          set({ isLoading: false })
          throw error
        }
/*
        const { audioRef, currentSong, currentTime } = get()
        if (!audioRef || !currentSong) return
        if (currentSong.platform === 'local') {
          set({ quality: newQuality, currentQuality: null })
          throw new Error('本地歌曲不支持切换在线音质')
        }

        set({ isLoading: true })

        try {
          // Get URL with new quality
          const result = await api.getSongUrl(currentSong.platform, currentSong.id, newQuality, { song: currentSong })

          if (!result) {
            set({ isLoading: false })
            throw new Error('获取音源失败')
          }

          // Check if we actually got the requested quality
          const actualQuality = result.quality
          const qualityChanged = actualQuality !== get().currentQuality

          if (!qualityChanged) {
            set({ isLoading: false })
            throw new Error(`该歌曲不支持${newQuality}音质，当前已是最高可用音质`)
          }

          const playableUrl = await resolvePlaybackUrl(result.url)

          // Update song with new URL
          const updatedSong: Song = {
            ...currentSong,
            url: playableUrl,
          }

          const finalPlaybackUrl = await playAudioSource(audioRef, playableUrl, { startTime: currentTime })
          await resumeAudioEffectsEngine()
          revokePlaybackBlobUrl(get().currentSong?.url)

          set({
            currentSong: { ...updatedSong, url: finalPlaybackUrl },
            isPlaying: true,
            isLoading: false,
            currentQuality: actualQuality,
            quality: newQuality, // Update the default quality setting
          })

          // Return actual quality for feedback
          return actualQuality
        } catch (error) {
          console.error('Switch quality error:', error)
          set({ isLoading: false })
          throw error
        }
*/
      },

      setAudioVisualizationEnabled: (enabled) => {
        const nextAudioEffects = { ...get().audioEffects, audioVisualizationEnabled: enabled }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setEqEnabled: (enabled) => {
        const nextAudioEffects = { ...get().audioEffects, eqEnabled: enabled }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setEqPreset: (presetId) => {
        const preset = EQ_PRESETS.find((item) => item.id === presetId) || EQ_PRESETS[0]
        const nextAudioEffects = {
          ...get().audioEffects,
          eqPresetId: preset.id,
          eqEnabled: preset.id !== 'default',
          eqGains: { ...preset.gains },
        }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setEqGain: (frequency, gain) => {
        const nextAudioEffects = {
          ...get().audioEffects,
          eqEnabled: true,
          eqPresetId: 'custom',
          eqGains: { ...get().audioEffects.eqGains, [frequency]: gain },
        }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      resetEq: () => {
        const nextAudioEffects = {
          ...get().audioEffects,
          eqEnabled: false,
          eqPresetId: 'default',
          eqGains: { ...DEFAULT_AUDIO_EFFECTS_SETTINGS.eqGains },
        }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setReverbEnabled: (enabled) => {
        const nextAudioEffects = { ...get().audioEffects, reverbEnabled: enabled }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setReverbPreset: (presetId) => {
        const nextAudioEffects = { ...get().audioEffects, reverbEnabled: true, reverbPresetId: presetId }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setReverbMainGain: (gain) => {
        const nextAudioEffects = { ...get().audioEffects, reverbEnabled: true, reverbMainGain: gain }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setReverbSendGain: (gain) => {
        const nextAudioEffects = { ...get().audioEffects, reverbEnabled: true, reverbSendGain: gain }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setSpatialAudioEnabled: (enabled) => {
        const nextAudioEffects = { ...get().audioEffects, spatialAudioEnabled: enabled }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setSpatialAudioRadius: (radius) => {
        const nextAudioEffects = { ...get().audioEffects, spatialAudioEnabled: true, spatialAudioRadius: radius }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setSpatialAudioSpeed: (speed) => {
        const nextAudioEffects = { ...get().audioEffects, spatialAudioEnabled: true, spatialAudioSpeed: speed }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      setPlaybackRate: (rate) => {
        const normalizedRate = Math.max(0.5, Math.min(1.5, Number(rate.toFixed(2))))
        const nextAudioEffects = { ...get().audioEffects, playbackRate: normalizedRate }
        applyAudioEffectsSettings(nextAudioEffects)
        set({ audioEffects: nextAudioEffects })
      },

      startSleepTimer: (seconds) => {
        const normalizedSeconds = Math.max(60, Math.round(seconds))
        const endAt = Date.now() + normalizedSeconds * 1000

        clearSleepTimerHandles()
        set({
          sleepTimerMode: 'timer',
          sleepTimerEndAt: endAt,
          sleepTimerRemainingSeconds: normalizedSeconds,
        })

        sleepIntervalId = window.setInterval(() => {
          const remainingSeconds = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
          set({ sleepTimerRemainingSeconds: remainingSeconds })
        }, 1000)

        sleepTimeoutId = window.setTimeout(() => {
          stopPlaybackBySleepTimer('定时停止时间已到，已暂停播放')
        }, normalizedSeconds * 1000)
      },

      stopAfterCurrentSong: () => {
        clearSleepTimerHandles()
        set({
          sleepTimerMode: 'songEnd',
          sleepTimerEndAt: null,
          sleepTimerRemainingSeconds: 0,
        })
      },

      stopSleepTimer: () => {
        clearSleepTimerState()
      },
    }
    },
    {
      name: 'player-storage',
      storage: createJSONStorage(() => ({
        getItem: async (name) => {
          return safePlayerStorageGet(name)
        },
        setItem: async (name, value) => {
          await debouncedPlayerStorageSet(name, value)
        },
        removeItem: async (name) => {
          await safePlayerStorageRemove(name)
        },
      })),
      partialize: (state) => ({
        volume: state.volume,
        isMuted: state.isMuted,
        playMode: state.playMode,
        quality: state.quality,
        preloadSongCount: state.preloadSongCount,
        autoTemporarySourceSwitch: state.autoTemporarySourceSwitch,
        audioEffects: state.audioEffects,
        audioOutputDeviceId: state.audioOutputDeviceId,
        playlistId: state.playlistId,
        // Don't persist runtime-only URLs; they can expire and also waste storage.
        playlist: state.playlist.map(stripSongRuntimeFields),
        currentSong: state.currentSong ? stripSongRuntimeFields(state.currentSong) : null,
      }),
      onRehydrateStorage: () => {
        console.log('[PlayerStore] Starting hydration...')
        return (state, error) => {
          if (error) {
            console.error('[PlayerStore] Hydration error:', error)
          } else {
            console.log('[PlayerStore] Hydration complete:', state?.volume)
            // Apply volume to audio element after hydration
            if (state?.audioRef) {
              const volume = state.isMuted ? 0 : state.volume
              state.audioRef.volume = volume
              console.log('[PlayerStore] Applied volume after hydration:', volume)
            }
            if (state?.audioEffects) {
              const normalizedEqGains = { ...DEFAULT_AUDIO_EFFECTS_SETTINGS.eqGains }
              EQ_FREQUENCIES.forEach((frequency) => {
                const value = state.audioEffects.eqGains?.[frequency]
                if (typeof value === 'number') {
                  normalizedEqGains[frequency] = value
                }
              })
              state.audioEffects = {
                ...DEFAULT_AUDIO_EFFECTS_SETTINGS,
                ...state.audioEffects,
                eqGains: normalizedEqGains,
              }
              // Re-apply the normalized effects to the live audio graph so EQ / reverb / spatial
              // settings take effect immediately after restart without waiting for the user to
              // touch a slider.
              applyAudioEffectsSettings(state.audioEffects)
            }
            if (state) {
              state.preloadSongCount = normalizePreloadSongCount(state.preloadSongCount)
            }
            // Player storage uses an async adapter, so setAudioRef (called during App mount) can
            // run before the persisted device id lands in the store.  Re-apply it here to cover
            // that race.
            if (state?.audioRef && state.audioOutputDeviceId && state.audioOutputDeviceId !== 'default') {
              void applySavedAudioOutputDeviceToElement(state.audioRef, state.audioOutputDeviceId)
            }
          }
        }
      },
    }
  )
)
