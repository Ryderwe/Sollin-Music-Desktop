import type { Song } from '@/types'

type SongIdentityInput = Pick<Song, 'id' | 'platform'> & Partial<Pick<Song, 'localPath'>>

export function getSongIdentityKey(song: SongIdentityInput | null | undefined): string | null {
  if (!song) return null

  if (song.platform === 'local' && song.localPath) {
    return `${song.platform}:${song.localPath}`
  }

  if (!song.id || !song.platform) return null
  return `${song.platform}:${song.id}`
}

export function isSamePlayableSong(
  left: SongIdentityInput | null | undefined,
  right: SongIdentityInput | null | undefined,
): boolean {
  const leftKey = getSongIdentityKey(left)
  const rightKey = getSongIdentityKey(right)
  return Boolean(leftKey && rightKey && leftKey === rightKey)
}
