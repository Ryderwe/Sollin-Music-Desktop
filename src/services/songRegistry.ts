import type { Song, SongPlatform } from '@/types'

class SongRegistryService {
  private songs = new Map<string, Song>()

  private getKey(platform: SongPlatform, id: string): string {
    return `${platform}:${id}`
  }

  rememberSong(song: Song | null | undefined): void {
    if (!song?.id) return
    const key = this.getKey(song.platform, String(song.id))
    const existing = this.songs.get(key)
    if (!existing) {
      this.songs.set(key, song)
      return
    }

    this.songs.set(key, {
      ...existing,
      ...song,
      lx: song.lx || existing.lx,
      cover: song.cover || existing.cover,
      albumId: song.albumId || existing.albumId,
      url: song.url || existing.url,
    })
  }

  rememberSongs(songs: Song[]): void {
    songs.forEach((song) => this.rememberSong(song))
  }

  getSong(platform: SongPlatform, id: string): Song | null {
    return this.songs.get(this.getKey(platform, id)) || null
  }

  clear(): void {
    this.songs.clear()
  }
}

export const songRegistry = new SongRegistryService()
export default songRegistry
