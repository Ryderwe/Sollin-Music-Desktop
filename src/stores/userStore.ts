import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Playlist, Song, OnlinePlaylist } from '@/types'
import {
  isGatewayCoverUrl,
  preparePlaylistForLibrary,
  prepareSongForLibrary,
  resolvePlaylistForLibrary,
  resolveSongForLibrary,
  resolveSongsForLibrary,
} from '@/services/officialCoverApi'

type OnlinePlaylistUpsertResult = 'created' | 'updated'
type PlaylistSection = 'custom' | 'local' | 'online'

interface UserStore {
  favorites: Song[]
  localFavorites: Song[]
  playlists: Playlist[]
  localPlaylists: Playlist[]
  onlinePlaylists: OnlinePlaylist[]
  recentlyPlayed: Song[]
  playHistory: Song[]

  initialize: () => void
  clearAllData: () => void
  refreshLibraryCovers: () => Promise<void>
  refreshSongReferences: (song: Song) => void

  addToFavorites: (song: Song) => void
  removeFromFavorites: (songId: string, platform: string) => void
  isFavorite: (songId: string, platform: string) => boolean
  addToRecentlyPlayed: (song: Song) => void
  addToPlayHistory: (song: Song) => void

  createPlaylist: (name: string, description?: string) => Playlist
  createLocalPlaylist: (name: string, description?: string) => Playlist
  updatePlaylist: (playlistId: string, updates: Partial<Playlist>) => void
  updateLocalPlaylist: (playlistId: string, updates: Partial<Playlist>) => void
  deletePlaylist: (playlistId: string) => void
  deleteLocalPlaylist: (playlistId: string) => void
  addToPlaylist: (playlistId: string, song: Song) => void
  addToLocalPlaylist: (playlistId: string, song: Song) => void
  removeFromPlaylist: (playlistId: string, songId: string, platform: string) => void
  removeFromLocalPlaylist: (playlistId: string, songId: string, platform: string) => void
  reorderPlaylists: (fromIndex: number, toIndex: number) => void
  reorderLocalPlaylists: (fromIndex: number, toIndex: number) => void
  reorderOnlinePlaylists: (fromIndex: number, toIndex: number) => void
  movePlaylistBetweenSections: (fromSection: PlaylistSection, fromId: string, toSection: PlaylistSection, toId: string) => void
  playlistSectionOrder: PlaylistSection[]
  reorderPlaylistSections: (fromIndex: number, toIndex: number) => void

  addOnlinePlaylist: (playlist: OnlinePlaylist) => void
  upsertOnlinePlaylist: (playlist: OnlinePlaylist) => OnlinePlaylistUpsertResult
  updateOnlinePlaylist: (playlistId: string, updates: Partial<OnlinePlaylist>) => void
  setOnlinePlaylistAutoUpdate: (playlistId: string, enabled: boolean) => void
  markOnlinePlaylistSyncStatus: (playlistId: string, status: Pick<OnlinePlaylist, 'lastSyncedAt' | 'lastSyncError'>) => void
  removeOnlinePlaylist: (playlistId: string) => void
  convertToLocalPlaylist: (onlinePlaylistId: string, songs: Song[]) => Playlist | null
}

const isSameSong = (left: Pick<Song, 'id' | 'platform'>, right: Pick<Song, 'id' | 'platform'>) => (
  left.id === right.id && left.platform === right.platform
)

const mergeSong = (current: Song, incoming: Song): Song => ({
  ...current,
  ...incoming,
  cover: incoming.cover || current.cover,
  lx: incoming.lx || current.lx,
  url: incoming.url || current.url,
})

const replaceSongInList = (songs: Song[], incoming: Song) => {
  let changed = false
  const nextSongs = songs.map((song) => {
    if (!isSameSong(song, incoming)) return song
    const nextSong = mergeSong(song, incoming)
    if (didSongChange(song, nextSong)) {
      changed = true
    }
    return nextSong
  })

  return { songs: nextSongs, changed }
}

const didSongChange = (left: Song, right: Song) => {
  return left.id !== right.id ||
    left.platform !== right.platform ||
    left.name !== right.name ||
    left.artist !== right.artist ||
    left.album !== right.album ||
    left.duration !== right.duration ||
    left.cover !== right.cover ||
    left.lrc !== right.lrc ||
    left.url !== right.url ||
    left.albumId !== right.albumId ||
    left.localPath !== right.localPath ||
    left.localFolder !== right.localFolder ||
    left.localFileSize !== right.localFileSize ||
    left.localModifiedAt !== right.localModifiedAt ||
    left.localTrackNo !== right.localTrackNo ||
    left.localDiscNo !== right.localDiscNo ||
    left.lx?.img !== right.lx?.img
}

const didSongListChange = (left: Song[], right: Song[]) => {
  if (left.length !== right.length) return true
  return left.some((song, index) => didSongChange(song, right[index]))
}

const didPlaylistChange = (left: Playlist, right: Playlist) => {
  return left.id !== right.id ||
    left.cover !== right.cover ||
    left.songCount !== right.songCount ||
    left.updatedAt !== right.updatedAt ||
    didSongListChange(left.songs, right.songs)
}

const didPlaylistListChange = (left: Playlist[], right: Playlist[]) => {
  if (left.length !== right.length) return true
  return left.some((playlist, index) => didPlaylistChange(playlist, right[index]))
}

const didOnlinePlaylistListChange = (left: OnlinePlaylist[], right: OnlinePlaylist[]) => {
  if (left.length !== right.length) return true
  return left.some((playlist, index) => (
    playlist.id !== right[index].id ||
    playlist.cover !== right[index].cover
  ))
}

const prepareOnlinePlaylist = (playlist: OnlinePlaylist): OnlinePlaylist => {
  const firstSongCover = playlist.songs?.[0]?.cover || ''
  const cover = !isGatewayCoverUrl(playlist.cover) && playlist.cover
    ? playlist.cover
    : firstSongCover || ''

  return {
    ...playlist,
    cover,
  }
}


const getOnlinePlaylistExternalKey = (playlist: Pick<OnlinePlaylist, 'source' | 'sourceId'> & { externalType?: string | null }) => {
  const sourceId = playlist.sourceId.trim()
  if (!sourceId) return ''
  const externalType = playlist.externalType?.trim() || 'playlist'
  return `${playlist.source}:${externalType}:${sourceId}`
}

const isSameOnlinePlaylistEntry = (left: OnlinePlaylist, right: OnlinePlaylist) => {
  const leftKey = getOnlinePlaylistExternalKey(left)
  const rightKey = getOnlinePlaylistExternalKey(right)
  if (leftKey && rightKey) return leftKey == rightKey
  return left.id === right.id
}

export const useUserStore = create<UserStore>()(
  persist(
    (set, get) => {
      let refreshPromise: Promise<void> | null = null
      let hasInitialized = false

      const buildPlaylist = (idPrefix: string, name: string, description?: string): Playlist => {
        const now = new Date().toISOString()
        return {
          id: `${idPrefix}_${Date.now()}`,
          name,
          description: description || '',
          cover: '',
          songs: [],
          songCount: 0,
          createdAt: now,
          updatedAt: now,
          isPublic: false,
        }
      }

      const refreshSongAcrossLibrary = (song: Song) => {
        void resolveSongForLibrary(song).then((resolvedSong) => {
          set((state) => {
            const favorites = replaceSongInList(state.favorites, resolvedSong)
            const localFavorites = replaceSongInList(state.localFavorites, resolvedSong)
            const recentlyPlayed = replaceSongInList(state.recentlyPlayed, resolvedSong)
            const playHistory = replaceSongInList(state.playHistory, resolvedSong)

            let playlistChanged = false
            const playlists = state.playlists.map((playlist) => {
              const updatedSongs = replaceSongInList(playlist.songs, resolvedSong)
              if (!updatedSongs.changed) return playlist
              playlistChanged = true
              return preparePlaylistForLibrary({
                ...playlist,
                songs: updatedSongs.songs,
              })
            })

            let localPlaylistChanged = false
            const localPlaylists = state.localPlaylists.map((playlist) => {
              const updatedSongs = replaceSongInList(playlist.songs, resolvedSong)
              if (!updatedSongs.changed) return playlist
              localPlaylistChanged = true
              return preparePlaylistForLibrary({
                ...playlist,
                songs: updatedSongs.songs,
              })
            })

            if (!favorites.changed && !localFavorites.changed && !recentlyPlayed.changed && !playHistory.changed && !playlistChanged && !localPlaylistChanged) {
              return state
            }

            return {
              favorites: favorites.songs,
              localFavorites: localFavorites.songs,
              recentlyPlayed: recentlyPlayed.songs,
              playHistory: playHistory.songs,
              playlists,
              localPlaylists,
            }
          })
        }).catch(() => {
          // ignore cover refresh failure
        })
      }

      const refreshPlaylistById = (playlistId: string) => {
        void (async() => {
          const playlist = get().playlists.find((item) => item.id === playlistId)
          if (!playlist) return
          const resolvedPlaylist = await resolvePlaylistForLibrary(playlist)
          if (!didPlaylistChange(playlist, resolvedPlaylist)) return
          set((state) => ({
            playlists: state.playlists.map((item) => item.id === playlistId ? resolvedPlaylist : item),
          }))
        })().catch(() => {
          // ignore playlist cover refresh failure
        })
      }

      const refreshLocalPlaylistById = (playlistId: string) => {
        void (async() => {
          const playlist = get().localPlaylists.find((item) => item.id === playlistId)
          if (!playlist) return
          const resolvedPlaylist = await resolvePlaylistForLibrary(playlist)
          if (!didPlaylistChange(playlist, resolvedPlaylist)) return
          set((state) => ({
            localPlaylists: state.localPlaylists.map((item) => item.id === playlistId ? resolvedPlaylist : item),
          }))
        })().catch(() => {
          // ignore playlist cover refresh failure
        })
      }

      const refreshLibraryCoversInternal = async() => {
        if (refreshPromise) return refreshPromise

        refreshPromise = (async() => {
          const state = get()
          const [favorites, localFavorites, recentlyPlayed, playHistory, playlists, localPlaylists] = await Promise.all([
            resolveSongsForLibrary(state.favorites),
            resolveSongsForLibrary(state.localFavorites),
            resolveSongsForLibrary(state.recentlyPlayed),
            resolveSongsForLibrary(state.playHistory),
            Promise.all(state.playlists.map((playlist) => resolvePlaylistForLibrary(playlist))),
            Promise.all(state.localPlaylists.map((playlist) => resolvePlaylistForLibrary(playlist))),
          ])
          const onlinePlaylists = state.onlinePlaylists.map((playlist) => prepareOnlinePlaylist(playlist))

          if (
            !didSongListChange(state.favorites, favorites) &&
            !didSongListChange(state.localFavorites, localFavorites) &&
            !didSongListChange(state.recentlyPlayed, recentlyPlayed) &&
            !didSongListChange(state.playHistory, playHistory) &&
            !didPlaylistListChange(state.playlists, playlists) &&
            !didPlaylistListChange(state.localPlaylists, localPlaylists) &&
            !didOnlinePlaylistListChange(state.onlinePlaylists, onlinePlaylists)
          ) {
            return
          }

          set({
            favorites,
            localFavorites,
            recentlyPlayed,
            playHistory,
            playlists,
            localPlaylists,
            onlinePlaylists,
          })
        })().finally(() => {
          refreshPromise = null
        })

        return refreshPromise
      }

      return {
        favorites: [],
        localFavorites: [],
        playlists: [],
        localPlaylists: [],
        onlinePlaylists: [],
        recentlyPlayed: [],
        playHistory: [],
        playlistSectionOrder: ['custom', 'local', 'online'],

        initialize: () => {
          if (hasInitialized) return
          hasInitialized = true
          console.log('User store initialized with local data')
          void refreshLibraryCoversInternal()
        },

        clearAllData: () => {
          set({
            favorites: [],
            localFavorites: [],
            playlists: [],
            localPlaylists: [],
            onlinePlaylists: [],
            recentlyPlayed: [],
            playHistory: [],
          })
        },

        refreshLibraryCovers: () => refreshLibraryCoversInternal(),
        refreshSongReferences: (song) => {
          refreshSongAcrossLibrary(song)
        },

        addToFavorites: (song) => {
          const preparedSong = prepareSongForLibrary(song)
          if (preparedSong.platform === 'local') {
            const { localFavorites } = get()
            set({
              localFavorites: [preparedSong, ...localFavorites.filter((item) => !isSameSong(item, preparedSong))],
            })
          } else {
            const { favorites } = get()
            set({
              favorites: [preparedSong, ...favorites.filter((item) => !isSameSong(item, preparedSong))],
            })
          }
          refreshSongAcrossLibrary(preparedSong)
        },

        removeFromFavorites: (songId, platform) => {
          if (platform === 'local') {
            const { localFavorites } = get()
            set({
              localFavorites: localFavorites.filter((song) => !(song.id === songId && song.platform === platform)),
            })
            return
          }

          const { favorites } = get()
          set({
            favorites: favorites.filter((song) => !(song.id === songId && song.platform === platform)),
          })
        },

        isFavorite: (songId, platform) => {
          if (platform === 'local') {
            const { localFavorites } = get()
            return localFavorites.some((song) => song.id === songId && song.platform === platform)
          }

          const { favorites } = get()
          return favorites.some((song) => song.id === songId && song.platform === platform)
        },

        addToRecentlyPlayed: (song) => {
          const preparedSong = prepareSongForLibrary(song)
          const { recentlyPlayed } = get()
          set({
            recentlyPlayed: [preparedSong, ...recentlyPlayed.filter((item) => !isSameSong(item, preparedSong))].slice(0, 50),
          })
          refreshSongAcrossLibrary(preparedSong)
        },

        addToPlayHistory: (song) => {
          const preparedSong = prepareSongForLibrary(song)
          const { playHistory } = get()
          set({
            playHistory: [preparedSong, ...playHistory.filter((item) => !isSameSong(item, preparedSong))].slice(0, 200),
          })
          refreshSongAcrossLibrary(preparedSong)
        },

        createPlaylist: (name, description) => {
          const { playlists } = get()
          const playlist = buildPlaylist('playlist', name, description)
          set({ playlists: [...playlists, playlist] })
          return playlist
        },

        createLocalPlaylist: (name, description) => {
          const { localPlaylists } = get()
          const playlist = buildPlaylist('local_playlist', name, description)
          set({ localPlaylists: [...localPlaylists, playlist] })
          return playlist
        },

        updatePlaylist: (playlistId, updates) => {
          const nextSongs = Array.isArray(updates.songs)
            ? updates.songs.map((song) => prepareSongForLibrary(song))
            : undefined
          const nextPlaylistCover = nextSongs?.[0]?.cover || ''

          set((state) => ({
            playlists: state.playlists.map((playlist) => {
              if (playlist.id !== playlistId) return playlist
              return preparePlaylistForLibrary({
                ...playlist,
                ...updates,
                songs: nextSongs || playlist.songs,
                songCount: nextSongs ? nextSongs.length : (updates.songCount ?? playlist.songs.length),
                cover: updates.cover || playlist.cover || nextPlaylistCover,
                updatedAt: updates.updatedAt || new Date().toISOString(),
              })
            }),
          }))

          if (nextSongs?.length || updates.cover) {
            refreshPlaylistById(playlistId)
          }
        },

        updateLocalPlaylist: (playlistId, updates) => {
          const nextSongs = Array.isArray(updates.songs)
            ? updates.songs.map((song) => prepareSongForLibrary(song))
            : undefined
          const nextPlaylistCover = nextSongs?.[0]?.cover || ''

          set((state) => ({
            localPlaylists: state.localPlaylists.map((playlist) => {
              if (playlist.id !== playlistId) return playlist
              return preparePlaylistForLibrary({
                ...playlist,
                ...updates,
                songs: nextSongs || playlist.songs,
                songCount: nextSongs ? nextSongs.length : (updates.songCount ?? playlist.songs.length),
                cover: updates.cover || playlist.cover || nextPlaylistCover,
                updatedAt: updates.updatedAt || new Date().toISOString(),
              })
            }),
          }))

          if (nextSongs?.length || updates.cover) {
            refreshLocalPlaylistById(playlistId)
          }
        },

        deletePlaylist: (playlistId) => {
          const { playlists } = get()
          set({ playlists: playlists.filter((playlist) => playlist.id !== playlistId) })
        },

        deleteLocalPlaylist: (playlistId) => {
          const { localPlaylists } = get()
          set({ localPlaylists: localPlaylists.filter((playlist) => playlist.id !== playlistId) })
        },

        addToPlaylist: (playlistId, song) => {
          const preparedSong = prepareSongForLibrary(song)
          set((state) => ({
            playlists: state.playlists.map((playlist) => {
              if (playlist.id !== playlistId) return playlist

              const exists = playlist.songs.some((item) => isSameSong(item, preparedSong))
              if (exists) return playlist

              return preparePlaylistForLibrary({
                ...playlist,
                songs: [...playlist.songs, preparedSong],
                songCount: playlist.songs.length + 1,
                cover: playlist.cover || preparedSong.cover || '',
                updatedAt: new Date().toISOString(),
              })
            }),
          }))

          refreshSongAcrossLibrary(preparedSong)
          refreshPlaylistById(playlistId)
        },

        addToLocalPlaylist: (playlistId, song) => {
          const preparedSong = prepareSongForLibrary(song)
          set((state) => ({
            localPlaylists: state.localPlaylists.map((playlist) => {
              if (playlist.id !== playlistId) return playlist

              const exists = playlist.songs.some((item) => isSameSong(item, preparedSong))
              if (exists) return playlist

              return preparePlaylistForLibrary({
                ...playlist,
                songs: [...playlist.songs, preparedSong],
                songCount: playlist.songs.length + 1,
                cover: playlist.cover || preparedSong.cover || '',
                updatedAt: new Date().toISOString(),
              })
            }),
          }))

          refreshSongAcrossLibrary(preparedSong)
          refreshLocalPlaylistById(playlistId)
        },

        removeFromPlaylist: (playlistId, songId, platform) => {
          set((state) => ({
            playlists: state.playlists.map((playlist) => {
              if (playlist.id !== playlistId) return playlist
              const songs = playlist.songs.filter((song) => !(song.id === songId && song.platform === platform))
              return preparePlaylistForLibrary({
                ...playlist,
                songs,
                songCount: songs.length,
                cover: songs[0]?.cover || '',
                updatedAt: new Date().toISOString(),
              })
            }),
          }))
        },

        removeFromLocalPlaylist: (playlistId, songId, platform) => {
          set((state) => ({
            localPlaylists: state.localPlaylists.map((playlist) => {
              if (playlist.id !== playlistId) return playlist
              const songs = playlist.songs.filter((song) => !(song.id === songId && song.platform === platform))
              return preparePlaylistForLibrary({
                ...playlist,
                songs,
                songCount: songs.length,
                cover: songs[0]?.cover || '',
                updatedAt: new Date().toISOString(),
              })
            }),
          }))
        },

        reorderPlaylists: (fromIndex, toIndex) => {
          set((state) => {
            const next = [...state.playlists]
            const [moved] = next.splice(fromIndex, 1)
            next.splice(toIndex, 0, moved)
            return { playlists: next }
          })
        },

        reorderLocalPlaylists: (fromIndex, toIndex) => {
          set((state) => {
            const next = [...state.localPlaylists]
            const [moved] = next.splice(fromIndex, 1)
            next.splice(toIndex, 0, moved)
            return { localPlaylists: next }
          })
        },

        reorderOnlinePlaylists: (fromIndex, toIndex) => {
          set((state) => {
            const next = [...state.onlinePlaylists]
            const [moved] = next.splice(fromIndex, 1)
            next.splice(toIndex, 0, moved)
            return { onlinePlaylists: next }
          })
        },

        movePlaylistBetweenSections: (fromSection, fromId, toSection, toId) => {
          if (fromSection === toSection) return
          // Only supports moves between custom and local (both Playlist[])
          const isFromPlaylist = fromSection === 'custom' || fromSection === 'local'
          const isToPlaylist = toSection === 'custom' || toSection === 'local'
          if (!isFromPlaylist || !isToPlaylist) return

          const fromKey = fromSection === 'custom' ? 'playlists' : 'localPlaylists'
          const toKey = toSection === 'custom' ? 'playlists' : 'localPlaylists'

          set((state) => {
            const fromList = [...state[fromKey]]
            const fromIndex = fromList.findIndex((p) => p.id === fromId)
            if (fromIndex === -1) return state
            const [moved] = fromList.splice(fromIndex, 1)

            const toList = fromKey === toKey ? fromList : [...state[toKey]]
            const toIndex = toList.findIndex((p) => p.id === toId)
            if (toIndex === -1) return state
            toList.splice(toIndex, 0, moved)

            if (fromKey === toKey) {
              return { [fromKey]: toList }
            }
            return { [fromKey]: fromList, [toKey]: toList }
          })
        },

        reorderPlaylistSections: (fromIndex, toIndex) => {
          set((state) => {
            const next = [...state.playlistSectionOrder]
            const [moved] = next.splice(fromIndex, 1)
            next.splice(toIndex, 0, moved)
            return { playlistSectionOrder: next }
          })
        },

        addOnlinePlaylist: (playlist) => {
          get().upsertOnlinePlaylist(playlist)
        },

        upsertOnlinePlaylist: (playlist) => {
          const { onlinePlaylists } = get()
          const existingIndex = onlinePlaylists.findIndex((item) => isSameOnlinePlaylistEntry(item, playlist))

          if (existingIndex >= 0) {
            const existing = onlinePlaylists[existingIndex]
            const nextPlaylist = prepareOnlinePlaylist({
              ...existing,
              ...playlist,
              id: existing.id,
              importedAt: playlist.importedAt || new Date().toISOString(),
              externalType: playlist.externalType ?? existing.externalType,
              autoUpdate: playlist.autoUpdate ?? existing.autoUpdate ?? true,
              lastSyncedAt: playlist.lastSyncedAt ?? existing.lastSyncedAt ?? null,
              lastSyncError: playlist.lastSyncError ?? null,
            })

            set({
              onlinePlaylists: onlinePlaylists.map((item, index) => index === existingIndex ? nextPlaylist : item),
            })
            return 'updated'
          }

          set({
            onlinePlaylists: [...onlinePlaylists, prepareOnlinePlaylist(playlist)],
          })
          return 'created'
        },

        updateOnlinePlaylist: (playlistId, updates) => {
          set((state) => ({
            onlinePlaylists: state.onlinePlaylists.map((playlist) => {
              if (playlist.id !== playlistId) return playlist
              return prepareOnlinePlaylist({
                ...playlist,
                ...updates,
              })
            }),
          }))
        },

        setOnlinePlaylistAutoUpdate: (playlistId, enabled) => {
          get().updateOnlinePlaylist(playlistId, {
            autoUpdate: enabled,
            lastSyncError: enabled ? null : get().onlinePlaylists.find((playlist) => playlist.id === playlistId)?.lastSyncError ?? null,
          })
        },

        markOnlinePlaylistSyncStatus: (playlistId, status) => {
          get().updateOnlinePlaylist(playlistId, status)
        },

        removeOnlinePlaylist: (playlistId) => {
          const { onlinePlaylists } = get()
          set({ onlinePlaylists: onlinePlaylists.filter((playlist) => playlist.id !== playlistId) })
        },

        convertToLocalPlaylist: (onlinePlaylistId, songs) => {
          const { onlinePlaylists, localPlaylists } = get()
          const onlinePlaylist = onlinePlaylists.find((playlist) => playlist.id === onlinePlaylistId)
          if (!onlinePlaylist) return null

          const preparedSongs = songs.map((song) => prepareSongForLibrary(song))
          const now = new Date().toISOString()
          const newPlaylist: Playlist = preparePlaylistForLibrary({
            id: `local_playlist_${Date.now()}`,
            name: onlinePlaylist.name,
            description: `从${onlinePlaylist.source}导入，原作者：${onlinePlaylist.author || '未知'}`,
            cover: onlinePlaylist.cover || preparedSongs[0]?.cover || '',
            songs: preparedSongs,
            songCount: preparedSongs.length,
            createdAt: now,
            updatedAt: now,
            isPublic: false,
          })

          set({
            localPlaylists: [...localPlaylists, newPlaylist],
            onlinePlaylists: onlinePlaylists.filter((playlist) => playlist.id !== onlinePlaylistId),
          })

          refreshLocalPlaylistById(newPlaylist.id)
          return newPlaylist
        },
      }
    },
    {
      name: 'Sollin-user-data',
    }
  )
)
