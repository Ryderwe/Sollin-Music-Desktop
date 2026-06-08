import type { Song, SongPlatform } from '@/types'
import { useSourceSwitchSettingsStore } from '@/stores/sourceSwitchSettingsStore'

// Sticky toggleMusicInfo registry, mirrors the behavior described in lx-music-desktop
// (src/renderer/core/music/action.ts - meta.toggleMusicInfo).  When playback URL resolution for
// an online song needs to fall back to another platform, the matched alternative is remembered
// here so future plays of the same song reuse the same proxy instead of re-running findMusic.

const STORAGE_KEY = 'sollin.toggleSource.v1'
const MAX_ENTRIES = 400

type StoredPayload = {
  version: 1
  entries: Array<[string, Song]>
}

function buildKey(platform: SongPlatform, id: string): string {
  return `${platform}:${id}`
}

class ToggleSourceRegistry {
  private cache = new Map<string, Song>()
  private loaded = false

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as StoredPayload | null
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return
      for (const [key, song] of parsed.entries) {
        if (typeof key === 'string' && song && typeof song === 'object') {
          this.cache.set(key, song as Song)
        }
      }
    } catch (error) {
      console.warn('[toggleSourceRegistry] load failed:', error)
    }
  }

  private persist(): void {
    try {
      const entries = Array.from(this.cache.entries())
      // Keep the registry bounded so local storage never balloons.
      const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
      const payload: StoredPayload = { version: 1, entries: trimmed }
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (error) {
      console.warn('[toggleSourceRegistry] persist failed:', error)
    }
  }

  get(platform: SongPlatform, id: string): Song | null {
    this.load()
    return this.cache.get(buildKey(platform, id)) || null
  }

  set(platform: SongPlatform, id: string, toggle: Song): void {
    if (!toggle?.id || !toggle.platform) return
    if (toggle.platform === platform && toggle.id === id) return
    // The user can opt out of the sticky-memory behavior from the new source-switch settings
    // panel.  Skip persistence entirely so we never write to localStorage when they prefer a
    // fresh findMusic round on every play.
    try {
      if (!useSourceSwitchSettingsStore.getState().rememberToggleChoices) return
    } catch {
      /* ignore store access failures, fall through to default persist behavior */
    }
    this.load()
    this.cache.set(buildKey(platform, id), toggle)
    this.persist()
  }

  clear(platform?: SongPlatform, id?: string): void {
    this.load()
    if (platform && id) {
      this.cache.delete(buildKey(platform, id))
    } else {
      this.cache.clear()
    }
    this.persist()
  }
}

export const toggleSourceRegistry = new ToggleSourceRegistry()
export default toggleSourceRegistry
