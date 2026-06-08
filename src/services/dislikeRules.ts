import type { Song } from '@/types'

export const DISLIKE_NAME_SPLIT = '@'
export const DISLIKE_NAME_ALIAS = '#'

export interface ParsedDislikeRules {
  names: Set<string>
  musicNames: Set<string>
  singerNames: Set<string>
  rules: string
  count: number
}

const normalizeName = (value?: string | null) => (
  (value || '')
    .split(DISLIKE_NAME_SPLIT)
    .join(DISLIKE_NAME_ALIAS)
    .toLocaleLowerCase()
    .trim()
)

export const formatDislikeRule = (name?: string | null, singer?: string | null) => {
  const normalizedName = (name || '').split(DISLIKE_NAME_SPLIT).join(DISLIKE_NAME_ALIAS).trim()
  const normalizedSinger = (singer || '').split(DISLIKE_NAME_SPLIT).join(DISLIKE_NAME_ALIAS).trim()

  if (normalizedName && normalizedSinger) return `${normalizedName}${DISLIKE_NAME_SPLIT}${normalizedSinger}`
  if (normalizedName) return normalizedName
  if (normalizedSinger) return `${DISLIKE_NAME_SPLIT}${normalizedSinger}`
  return ''
}

export const parseDislikeRules = (rules: string): ParsedDislikeRules => {
  const names = new Set<string>()
  const musicNames = new Set<string>()
  const singerNames = new Set<string>()
  const normalizedRules: string[] = []

  rules.split('\n').forEach((rawItem) => {
    if (!rawItem) return

    const [rawName = '', rawSinger = ''] = rawItem.split(DISLIKE_NAME_SPLIT)
    const name = normalizeName(rawName)
    const singer = normalizeName(rawSinger)

    if (name) {
      if (singer) {
        const rule = `${name}${DISLIKE_NAME_SPLIT}${singer}`
        names.add(rule)
        normalizedRules.push(rule)
        return
      }

      musicNames.add(name)
      normalizedRules.push(name)
      return
    }

    if (singer) {
      singerNames.add(singer)
      normalizedRules.push(`${DISLIKE_NAME_SPLIT}${singer}`)
    }
  })

  const uniqueRules = Array.from(new Set(normalizedRules))

  return {
    names,
    musicNames,
    singerNames,
    rules: uniqueRules.join('\n'),
    count: musicNames.size + singerNames.size + names.size,
  }
}

export const isDislikedSong = (song: Pick<Song, 'name' | 'artist'>, rules: string | ParsedDislikeRules) => {
  const info = typeof rules === 'string' ? parseDislikeRules(rules) : rules
  if (info.count === 0) return false

  const name = normalizeName(song.name)
  const singer = normalizeName(song.artist)

  return info.musicNames.has(name) ||
    info.singerNames.has(singer) ||
    info.names.has(`${name}${DISLIKE_NAME_SPLIT}${singer}`)
}

export const filterDislikedSongs = <T extends Pick<Song, 'name' | 'artist'>>(songs: T[], rules: string | ParsedDislikeRules) => {
  const info = typeof rules === 'string' ? parseDislikeRules(rules) : rules
  if (info.count === 0) return songs
  return songs.filter((song) => !isDislikedSong(song, info))
}
