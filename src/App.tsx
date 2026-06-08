import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Layout from '@/components/Layout'
import { usePlayerStore } from '@/stores/playerStore'
import { useUserStore } from '@/stores/userStore'
import { useUIStore } from '@/stores/uiStore'
import CreatePlaylistModal from '@/components/modals/CreatePlaylistModal'
import ImportPlaylistModal from '@/components/modals/ImportPlaylistModal'
import UpdateModal from '@/components/modals/UpdateModal'
import LoginModal from '@/components/modals/LoginModal'
import LxSourceUpdateModal from '@/components/modals/LxSourceUpdateModal'
import GithubAnnouncementModal from '@/components/modals/GithubAnnouncementModal'
import LocalSongTagEditorModal from '@/components/modals/LocalSongTagEditorModal'
import SettingsModal from '@/components/modals/SettingsModal'
import Toast from '@/components/ui/Toast'
import { analytics } from '@/services/analytics'
import { lxSourceApi, type LxSourceUpdateAlert } from '@/services/lxSource'
import { APP_VERSION } from '@/config'
import { checkGithubUpdate } from '@/services/githubUpdate'
import {
  fetchGithubAnnouncement,
  getGithubAnnouncementFingerprint,
  GITHUB_ANNOUNCEMENT_STORAGE_KEY,
  type GithubAnnouncement,
} from '@/services/githubAnnouncement'
import { downloadManager } from '@/services/downloadManager'
import { refreshAutoUpdateOnlinePlaylists } from '@/services/onlinePlaylistAutoUpdate'
import dataSyncService from '@/services/dataSync'
import { applyDataSyncSnapshotData, buildDataSyncSnapshotData, isDataSyncSnapshotEmpty } from '@/services/dataSyncState'
import { useFeatureStore } from '@/stores/featureStore'
import { useDownloadStore } from '@/stores/downloadStore'
import { useSourceSwitchSettingsStore } from '@/stores/sourceSwitchSettingsStore'

// Route-level code splitting
const Home = lazy(() => import('@/pages/Home'))
const Search = lazy(() => import('@/pages/Search'))
const LocalMusic = lazy(() => import('@/pages/LocalMusic'))
const Library = lazy(() => import('@/pages/Library'))
const Favorites = lazy(() => import('@/pages/Favorites'))
const LocalFavorites = lazy(() => import('@/pages/LocalFavorites'))
const Recent = lazy(() => import('@/pages/Recent'))
const Downloads = lazy(() => import('@/pages/Downloads'))
const PlaylistDetail = lazy(() => import('@/pages/PlaylistDetail'))
const NeteasePlaylistDetail = lazy(() => import('@/pages/NeteasePlaylistDetail'))
const OnlinePlaylistDetail = lazy(() => import('@/pages/OnlinePlaylistDetail'))
const OnlineAlbumDetail = lazy(() => import('@/pages/OnlineAlbumDetail'))
const MyOnlinePlaylistDetail = lazy(() => import('@/pages/MyOnlinePlaylistDetail'))
const NeteaseHome = lazy(() => import('@/pages/NeteaseHome'))
const PersonalFM = lazy(() => import('@/pages/PersonalFM'))
const Toplist = lazy(() => import('@/pages/Toplist'))
const ToplistDetail = lazy(() => import('@/pages/ToplistDetail'))
const ArtistDetail = lazy(() => import('@/pages/ArtistDetail'))
const AlbumDetail = lazy(() => import('@/pages/AlbumDetail'))
const PlaylistExplore = lazy(() => import('@/pages/PlaylistExplore'))
const DailyRecommend = lazy(() => import('@/pages/DailyRecommend'))

function App() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const { setAudioRef, currentSong, isPlaying } = usePlayerStore()
  const initialize = useUserStore((state) => state.initialize)
  const {
    theme,
    showSettingsModal,
    setShowSettingsModal,
    showCreatePlaylistModal,
    showImportPlaylistModal,
    showLocalSongTagEditorModal,
    showAuthModal,
    setShowAuthModal,
    toasts,
  } = useUIStore()

  // Update modal state
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{
    hasUpdate: boolean
    needForceUpdate?: boolean
    latestVersion: string
    changelog: string[]
    downloadUrl: string
  } | null>(null)

  const [lxSourceUpdateAlert, setLxSourceUpdateAlert] = useState<LxSourceUpdateAlert | null>(null)
  const [githubAnnouncement, setGithubAnnouncement] = useState<GithubAnnouncement | null>(null)
  const [showGithubAnnouncementModal, setShowGithubAnnouncementModal] = useState(false)
  const handledLxSourceAlertsRef = useRef<Set<string>>(new Set())
  const isApplyingRemoteSnapshotRef = useRef(false)
  const pushSnapshotTimerRef = useRef<number | null>(null)

  const inferArtworkMimeType = (value?: string) => {
    if (!value) return 'image/jpeg'

    try {
      const url = new URL(value, window.location.href)
      const pathname = url.pathname.toLowerCase()
      if (pathname.endsWith('.avif')) return 'image/avif'
      if (pathname.endsWith('.webp')) return 'image/webp'
      if (pathname.endsWith('.png')) return 'image/png'
      if (pathname.endsWith('.gif')) return 'image/gif'
      if (pathname.endsWith('.bmp')) return 'image/bmp'
      if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg'
    } catch {
      // ignore invalid artwork URL
    }

    return 'image/jpeg'
  }

  // Initialize audio, user and analytics
  useEffect(() => {
    if (audioRef.current) {
      setAudioRef(audioRef.current)
    }
    initialize()

    // Start analytics
    analytics.start()

    void downloadManager.ensureInitialized()

    const scheduleSnapshotPush = () => {
      if (isApplyingRemoteSnapshotRef.current) return
      const status = dataSyncService.getStatus()
      if (!status.enabled) return
      if (pushSnapshotTimerRef.current) {
        window.clearTimeout(pushSnapshotTimerRef.current)
      }
      pushSnapshotTimerRef.current = window.setTimeout(() => {
        pushSnapshotTimerRef.current = null
        if (isApplyingRemoteSnapshotRef.current) return
        if (!dataSyncService.getStatus().enabled) return
        void dataSyncService.pushSnapshot(buildDataSyncSnapshotData())
      }, 400)
    }

    const unsubscribeSnapshot = dataSyncService.onSnapshot((snapshot) => {
      if (!snapshot) return
      if (isDataSyncSnapshotEmpty(snapshot.data)) return
      isApplyingRemoteSnapshotRef.current = true
      try {
        applyDataSyncSnapshotData(snapshot.data)
      } finally {
        window.setTimeout(() => {
          isApplyingRemoteSnapshotRef.current = false
        }, 0)
      }
    })

    const unsubscribeStatus = dataSyncService.onStatus((status) => {
      if (status.enabled) {
        scheduleSnapshotPush()
      }
    })

    const unsubscribeUser = useUserStore.subscribe(scheduleSnapshotPush)
    const unsubscribeFeature = useFeatureStore.subscribe(scheduleSnapshotPush)
    const unsubscribeUI = useUIStore.subscribe(scheduleSnapshotPush)
    const unsubscribeDownload = useDownloadStore.subscribe(scheduleSnapshotPush)
    const unsubscribeSourceSwitch = useSourceSwitchSettingsStore.subscribe(scheduleSnapshotPush)

    void dataSyncService.initialize().then(() => {
      const status = dataSyncService.getStatus()
      if (status.enabled) {
        scheduleSnapshotPush()
      }
    })

    // Refresh imported online playlists that opt in to auto update.
    void refreshAutoUpdateOnlinePlaylists().then((summary) => {
      if (summary.checked > 0) {
        console.log('[OnlinePlaylistAutoUpdate] complete:', summary)
      }
    }).catch((error) => {
      console.debug('[OnlinePlaylistAutoUpdate] failed:', error)
    })

    // Check for updates on startup
    void checkForUpdates()
    void checkAnnouncement()

    return () => {
      analytics.stop()
      unsubscribeSnapshot()
      unsubscribeStatus()
      unsubscribeUser()
      unsubscribeFeature()
      unsubscribeUI()
      unsubscribeDownload()
      unsubscribeSourceSwitch()
      if (pushSnapshotTimerRef.current) {
        window.clearTimeout(pushSnapshotTimerRef.current)
      }
    }
  }, [setAudioRef, initialize])

  useEffect(() => {
    const pushLxSourceAlert = (alert: LxSourceUpdateAlert) => {
      const alertKey = [alert.name, alert.version, alert.updateUrl || '', alert.log].join('::')
      if (handledLxSourceAlertsRef.current.has(alertKey)) return
      handledLxSourceAlertsRef.current.add(alertKey)
      setLxSourceUpdateAlert(alert)
    }

    const unsubscribe = lxSourceApi.onUpdateAlert(pushLxSourceAlert)
    void lxSourceApi.consumeUpdateAlerts().then((alerts) => {
      alerts.forEach(pushLxSourceAlert)
    }).catch((error) => {
      console.debug('Consume LX source update alerts failed:', error)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Electron: restore player state from main-process persistent storage
  useEffect(() => {
    if (!window.electronAPI?.getPlayerState) return

    let cancelled = false
    window.electronAPI.getPlayerState().then((state) => {
      if (cancelled || !state) return

      const current = usePlayerStore.getState()
      // Only restore if store is currently empty (avoid overriding a live session)
      if (current.playlist.length === 0 && !current.currentSong) {
        usePlayerStore.setState({
          playlist: Array.isArray(state.playlist) ? state.playlist : [],
          playlistId: state.playlistId ?? null,
          currentSong: state.currentSong ?? null,
          volume: typeof state.volume === 'number' ? state.volume : current.volume,
          playMode: (state.playMode as any) ?? current.playMode,
          quality: (state.quality as any) ?? current.quality,
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Electron: persist player state to main process (throttled)
  useEffect(() => {
    if (!window.electronAPI?.setPlayerState) return

    let timer: number | null = null
    const save = () => {
      const state = usePlayerStore.getState()
      // Strip runtime URLs (they can expire)
      const strip = (song: any) => {
        if (!song || typeof song !== 'object') return song
        const { url, ...rest } = song
        return rest
      }

      window.electronAPI?.setPlayerState({
        playlist: state.playlist.map(strip),
        playlistId: state.playlistId,
        currentSong: state.currentSong ? strip(state.currentSong) : null,
        volume: state.volume,
        playMode: state.playMode,
        quality: state.quality,
      })
    }

    // Only persist when relevant fields change (not on every isPlaying/isLoading toggle)
    let lastSerialized = ''
    const unsubscribe = usePlayerStore.subscribe(() => {
      const state = usePlayerStore.getState()
      const key = `${state.playlistId}|${state.volume}|${state.playMode}|${state.quality}|${state.currentSong?.id}|${state.playlist.length}`
      if (key === lastSerialized) return
      lastSerialized = key
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(save, 1500)
    })

    const onUnload = () => save()
    window.addEventListener('beforeunload', onUnload)

    return () => {
      unsubscribe()
      if (timer) window.clearTimeout(timer)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])

  // Check for updates from GitHub Releases.
  const checkForUpdates = async () => {
    try {
      const data = await checkGithubUpdate(APP_VERSION)

      if (data.hasUpdate) {
        setUpdateInfo({
          hasUpdate: data.hasUpdate,
          needForceUpdate: false,
          latestVersion: data.latestVersion,
          changelog: data.releaseNotes,
          downloadUrl: data.downloadUrl,
        })
        setShowUpdateModal(true)
      }
    } catch (error) {
      console.debug('Update check failed:', error)
    }
  }

  // Check public announcements from GitHub Issue comments.
  const checkAnnouncement = async () => {
    try {
      const announcement = await fetchGithubAnnouncement()
      if (!announcement) return

      const fingerprint = getGithubAnnouncementFingerprint(announcement)
      const dismissedFingerprint = window.localStorage.getItem(GITHUB_ANNOUNCEMENT_STORAGE_KEY)
      if (dismissedFingerprint === fingerprint) return

      setGithubAnnouncement(announcement)
      setShowGithubAnnouncementModal(true)
    } catch (error) {
      console.debug('GitHub announcement check failed:', error)
    }
  }

  const closeGithubAnnouncement = () => {
    if (githubAnnouncement) {
      window.localStorage.setItem(
        GITHUB_ANNOUNCEMENT_STORAGE_KEY,
        getGithubAnnouncementFingerprint(githubAnnouncement),
      )
    }
    setShowGithubAnnouncementModal(false)
  }

  // Apply theme
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.classList.toggle('dark', prefersDark)
    } else {
      root.classList.toggle('dark', theme === 'dark')
    }
  }, [theme])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          usePlayerStore.getState().togglePlay()
          break
        case 'ArrowLeft':
          if (e.metaKey || e.ctrlKey) {
            usePlayerStore.getState().playPrevious()
          }
          break
        case 'ArrowRight':
          if (e.metaKey || e.ctrlKey) {
            usePlayerStore.getState().playNext()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Prevent copy, context menu and drag (security measures)
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Allow context menu in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      e.preventDefault()
    }

    const handleCopy = (e: ClipboardEvent) => {
      // Allow copy in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      e.preventDefault()
    }

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault()
    }

    document.addEventListener('contextmenu', handleContextMenu)
    document.addEventListener('copy', handleCopy)
    document.addEventListener('dragstart', handleDragStart)

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('copy', handleCopy)
      document.removeEventListener('dragstart', handleDragStart)
    }
  }, [])

  // Media Session API (Hardware Media Keys)


  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        usePlayerStore.getState().togglePlay()
      })
      navigator.mediaSession.setActionHandler('pause', () => {
        usePlayerStore.getState().togglePlay()
      })
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        usePlayerStore.getState().playPrevious()
      })
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        usePlayerStore.getState().playNext()
      })
    }
  }, [])

  // Update Media Session Metadata
  useEffect(() => {
    if ('mediaSession' in navigator) {
      if (currentSong) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: currentSong.name,
            artist: currentSong.artist,
            album: currentSong.album,
            artwork: currentSong.cover ? [{
              src: currentSong.cover,
              sizes: '512x512',
              type: inferArtworkMimeType(currentSong.cover),
            }] : [],
          })
        } catch (error) {
          console.warn('Set media session artwork failed, fallback without artwork:', error)
          navigator.mediaSession.metadata = new MediaMetadata({
            title: currentSong.name,
            artist: currentSong.artist,
            album: currentSong.album,
          })
        }
      } else {
        navigator.mediaSession.metadata = null
      }

      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    }
  }, [currentSong, isPlaying])

  // Electron tray events
  useEffect(() => {
    if (window.electronAPI) {
      const unsubPlayPause = window.electronAPI.onPlayPause(() => {
        usePlayerStore.getState().togglePlay()
      })
      const unsubPrevious = window.electronAPI.onPrevious(() => {
        usePlayerStore.getState().playPrevious()
      })
      const unsubNext = window.electronAPI.onNext(() => {
        usePlayerStore.getState().playNext()
      })

      return () => {
        unsubPlayPause()
        unsubPrevious()
        unsubNext()
      }
    }
  }, [])

  return (
    <>
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" />

      {/* Main app */}
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Suspense><Home /></Suspense>} />
          <Route path="local" element={<Suspense><LocalMusic /></Suspense>} />
          <Route path="search" element={<Suspense><Search /></Suspense>} />
          <Route path="library" element={<Suspense><Library /></Suspense>} />
          <Route path="favorites" element={<Suspense><Favorites /></Suspense>} />
          <Route path="local-favorites" element={<Suspense><LocalFavorites /></Suspense>} />
          <Route path="recent" element={<Suspense><Recent /></Suspense>} />
          <Route path="downloads" element={<Suspense><Downloads /></Suspense>} />
          <Route path="playlist/:id" element={<Suspense><PlaylistDetail /></Suspense>} />
          <Route path="netease-playlist/:id" element={<Suspense><NeteasePlaylistDetail /></Suspense>} />
          <Route path="online-playlist/:platform/:id" element={<Suspense><OnlinePlaylistDetail /></Suspense>} />
          <Route path="online-album/:platform/:id" element={<Suspense><OnlineAlbumDetail /></Suspense>} />
          <Route path="my-online-playlist/:id" element={<Suspense><MyOnlinePlaylistDetail /></Suspense>} />
          <Route path="netease-home" element={<Suspense><NeteaseHome /></Suspense>} />
          <Route path="personal-fm" element={<Suspense><PersonalFM /></Suspense>} />
          <Route path="toplist" element={<Suspense><Toplist /></Suspense>} />
          <Route path="toplist-detail/:platform/:id" element={<Suspense><ToplistDetail /></Suspense>} />
          <Route path="artist/:id" element={<Suspense><ArtistDetail /></Suspense>} />
          <Route path="album/:id" element={<Suspense><AlbumDetail /></Suspense>} />
          <Route path="playlist-explore" element={<Suspense><PlaylistExplore /></Suspense>} />
          <Route path="daily-recommend" element={<Suspense><DailyRecommend /></Suspense>} />
        </Route>
      </Routes>

      {/* Modals */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />
      {showCreatePlaylistModal && <CreatePlaylistModal />}
      {showImportPlaylistModal && <ImportPlaylistModal />}
      {showLocalSongTagEditorModal && <LocalSongTagEditorModal />}

      {/* Login Modal (Netease) */}
      <LoginModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />

      {/* Update Modal */}
      <UpdateModal
        isOpen={showUpdateModal}
        onClose={() => {
          // 强制更新时不允许关闭弹窗
          if (updateInfo?.needForceUpdate) return
          setShowUpdateModal(false)
        }}
        updateInfo={updateInfo}
      />

      <LxSourceUpdateModal
        alert={lxSourceUpdateAlert}
        onClose={() => setLxSourceUpdateAlert(null)}
      />

      <GithubAnnouncementModal
        isOpen={showGithubAnnouncementModal}
        announcement={githubAnnouncement}
        onClose={closeGithubAnnouncement}
      />

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <Toast key={toast.id} {...toast} />
          ))}
        </AnimatePresence>
      </div>
    </>
  )
}

export default App
