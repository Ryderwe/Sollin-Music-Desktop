import { create } from 'zustand'
import type { LyricsPlayerMode, Platform, Song } from '@/types'
import { persist } from 'zustand/middleware'
import { isLyricsPlayerMode } from '@/constants/playerModes'

type Theme = 'light' | 'dark' | 'system'
type SearchCategory = 'songs' | 'albums' | 'playlists'
type View = 'home' | 'search' | 'library' | 'playlist' | 'admin' | 'settings' | 'lyrics'
type CloseBehavior = 'ask' | 'background' | 'quit'
type PlaylistCreateMode = 'default' | 'local'
export type BackgroundMode = 'album' | 'solid' | 'gradient' | 'image'
export type PlayerBackdropMode = 'dynamic' | 'static' | 'amll'

export interface BackgroundSettings {
  mode: BackgroundMode
  solidColor: string
  gradientColor1: string
  gradientColor2: string
  gradientAngle: number
  customImagePath: string
  overlayColor: string
  overlayOpacity: number
  blurIntensity: number
  applyToHome: boolean
}

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  mode: 'album',
  solidColor: '#1a1a2e',
  gradientColor1: '#1a1a2e',
  gradientColor2: '#16213e',
  gradientAngle: 135,
  customImagePath: '',
  overlayColor: '#000000',
  overlayOpacity: 0,
  blurIntensity: 118,
  applyToHome: true,
}

const sanitizeLyricsPlayerMode = (mode: unknown): LyricsPlayerMode => (
  isLyricsPlayerMode(mode) ? mode : 'default'
)

const sanitizePlayerBackdropMode = (mode: unknown): PlayerBackdropMode => (
  mode === 'static' || mode === 'amll' ? mode : 'dynamic'
)

interface UIStore {
  // Close behavior
  closeBehavior: CloseBehavior
  setCloseBehavior: (behavior: CloseBehavior) => void

  // Theme
  theme: Theme
  setTheme: (theme: Theme) => void

  // Font
  fontFamily: string
  customFontDataUrl: string
  setFontFamily: (font: string) => void
  setCustomFontDataUrl: (dataUrl: string) => void

  // Sidebar
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  isMiniMode: boolean
  setMiniMode: (enabled: boolean) => void
  toggleMiniMode: () => void
  mainWindowAlwaysOnTop: boolean
  setMainWindowAlwaysOnTop: (enabled: boolean) => void
  toggleMainWindowAlwaysOnTop: () => void

  // Current view
  currentView: View
  setCurrentView: (view: View) => void

  // Home view state
  homePlatform: Platform
  setHomePlatform: (platform: Platform) => void
  homeScrollTop: number
  setHomeScrollTop: (top: number) => void

  // Modals
  showSettingsModal: boolean
  setShowSettingsModal: (show: boolean) => void
  showAuthModal: boolean
  setShowAuthModal: (show: boolean) => void
  showCreatePlaylistModal: boolean
  createPlaylistMode: PlaylistCreateMode
  setShowCreatePlaylistModal: (show: boolean) => void
  setCreatePlaylistMode: (mode: PlaylistCreateMode) => void
  showAddToPlaylistModal: boolean
  setShowAddToPlaylistModal: (show: boolean) => void
  showImportPlaylistModal: boolean
  setShowImportPlaylistModal: (show: boolean) => void
  showLocalSongTagEditorModal: boolean
  localSongTagEditorSong: Song | null
  openLocalSongTagEditor: (song: Song) => void
  closeLocalSongTagEditor: () => void

  // Lyrics panel
  showLyricsPanel: boolean
  lyricsPanelTab: 'lyrics' | 'comments'
  lyricsLeftPanelCollapsed: boolean
  toggleLyricsPanel: () => void
  setShowLyricsPanel: (show: boolean) => void
  openLyricsPanel: (tab?: 'lyrics' | 'comments') => void
  setLyricsPanelTab: (tab: 'lyrics' | 'comments') => void
  setLyricsLeftPanelCollapsed: (collapsed: boolean) => void

  // Lyrics player mode
  lyricsPlayerMode: LyricsPlayerMode
  setLyricsPlayerMode: (mode: LyricsPlayerMode) => void

  // Player page backdrop
  playerBackdropMode: PlayerBackdropMode
  setPlayerBackdropMode: (mode: PlayerBackdropMode) => void

  // Queue panel
  showQueuePanel: boolean
  toggleQueuePanel: () => void

  // Loading states
  isSearching: boolean
  setIsSearching: (loading: boolean) => void

  // Search
  searchQuery: string
  setSearchQuery: (query: string) => void
  searchPlatform: Platform | 'all'
  setSearchPlatform: (platform: Platform | 'all') => void
  searchCategory: SearchCategory
  setSearchCategory: (category: SearchCategory) => void
  topBarSearchActive: boolean
  setTopBarSearchActive: (active: boolean) => void

  // Background customization
  backgroundSettings: BackgroundSettings
  setBackgroundSettings: (settings: Partial<BackgroundSettings>) => void
  resetBackgroundSettings: () => void

  // Toasts
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      // Close behavior
      closeBehavior: 'ask',
      setCloseBehavior: (behavior) => set({ closeBehavior: behavior }),

      // Theme
      theme: 'dark',
      setTheme: (theme) => {
        set({ theme })
        // Apply theme to document
        const root = document.documentElement
        if (theme === 'system') {
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
          root.classList.toggle('dark', prefersDark)
        } else {
          root.classList.toggle('dark', theme === 'dark')
        }
      },

      // Font
      fontFamily: '',
      customFontDataUrl: '',
      setFontFamily: (font) => {
        set({ fontFamily: font })
        document.documentElement.style.setProperty('--app-font-family', font || '')
      },
      setCustomFontDataUrl: (dataUrl) => {
        set({ customFontDataUrl: dataUrl })
      },

      // Sidebar
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      isMiniMode: false,
      setMiniMode: (isMiniMode) => set({ isMiniMode }),
      toggleMiniMode: () => set((state) => ({ isMiniMode: !state.isMiniMode })),
      mainWindowAlwaysOnTop: false,
      setMainWindowAlwaysOnTop: (mainWindowAlwaysOnTop) => set({ mainWindowAlwaysOnTop }),
      toggleMainWindowAlwaysOnTop: () => set((state) => ({ mainWindowAlwaysOnTop: !state.mainWindowAlwaysOnTop })),

      // Current view
      currentView: 'home',
      setCurrentView: (view) => set({ currentView: view }),

      // Home view state
      homePlatform: 'netease',
      setHomePlatform: (homePlatform) => set({ homePlatform }),
      homeScrollTop: 0,
      setHomeScrollTop: (homeScrollTop) => set({ homeScrollTop }),

      // Modals
      showSettingsModal: false,
      setShowSettingsModal: (show) => set({ showSettingsModal: show }),
      showAuthModal: false,
      setShowAuthModal: (show) => set({ showAuthModal: show }),
      showCreatePlaylistModal: false,
      createPlaylistMode: 'default',
      setShowCreatePlaylistModal: (show) => set({ showCreatePlaylistModal: show }),
      setCreatePlaylistMode: (createPlaylistMode) => set({ createPlaylistMode }),
      showAddToPlaylistModal: false,
      setShowAddToPlaylistModal: (show) => set({ showAddToPlaylistModal: show }),
      showImportPlaylistModal: false,
      setShowImportPlaylistModal: (show) => set({ showImportPlaylistModal: show }),
      showLocalSongTagEditorModal: false,
      localSongTagEditorSong: null,
      openLocalSongTagEditor: (localSongTagEditorSong) => set({
        showLocalSongTagEditorModal: true,
        localSongTagEditorSong,
      }),
      closeLocalSongTagEditor: () => set({
        showLocalSongTagEditorModal: false,
        localSongTagEditorSong: null,
      }),

      // Lyrics panel
      showLyricsPanel: false,
      lyricsPanelTab: 'lyrics',
      lyricsLeftPanelCollapsed: false,
      toggleLyricsPanel: () => set((state) => ({ showLyricsPanel: !state.showLyricsPanel })),
      setShowLyricsPanel: (show) => set({ showLyricsPanel: show }),
      openLyricsPanel: (tab = 'lyrics') => set({ showLyricsPanel: true, lyricsPanelTab: tab }),
      setLyricsPanelTab: (tab) => set({ lyricsPanelTab: tab }),
      setLyricsLeftPanelCollapsed: (lyricsLeftPanelCollapsed) => set({ lyricsLeftPanelCollapsed }),

      // Lyrics player mode
      lyricsPlayerMode: 'default',
      setLyricsPlayerMode: (lyricsPlayerMode) => set({ lyricsPlayerMode }),

      // Player page backdrop
      playerBackdropMode: 'dynamic',
      setPlayerBackdropMode: (playerBackdropMode) => set({ playerBackdropMode }),

      // Queue panel
      showQueuePanel: false,
      toggleQueuePanel: () => set((state) => ({ showQueuePanel: !state.showQueuePanel })),

      // Loading states
      isSearching: false,
      setIsSearching: (loading) => set({ isSearching: loading }),

      // Search
      searchQuery: '',
      setSearchQuery: (query) => set({ searchQuery: query }),
      searchPlatform: 'all',
      setSearchPlatform: (platform) => set({ searchPlatform: platform }),
      searchCategory: 'songs',
      setSearchCategory: (category) => set({ searchCategory: category }),
      topBarSearchActive: false,
      setTopBarSearchActive: (active) => set({ topBarSearchActive: active }),

      // Background customization
      backgroundSettings: DEFAULT_BACKGROUND_SETTINGS,
      setBackgroundSettings: (settings) =>
        set((state) => ({
          backgroundSettings: { ...state.backgroundSettings, ...settings },
        })),
      resetBackgroundSettings: () => set({ backgroundSettings: DEFAULT_BACKGROUND_SETTINGS }),

      // Toasts
      toasts: [],
      addToast: (toast) => {
        const id =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`
        set((state) => ({
          toasts: [...state.toasts, { ...toast, id }],
        }))
      },
      removeToast: (id) => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }))
      },
    }),
    {
      name: 'ui-storage',
      version: 7,
      migrate: (persistedState: any, version: number) => {
        if (persistedState?.state) {
          const legacyKeys = ['api' + 'BaseUrl', 'show' + 'Unified' + 'AuthModal']
          legacyKeys.forEach((key) => {
            delete persistedState.state[key]
          })
        }
        // v2 -> v3: add background settings
        if (version < 3 && persistedState?.state) {
          persistedState.state.backgroundSettings = { ...DEFAULT_BACKGROUND_SETTINGS, applyToHome: true }
        }
        // v4 -> v5: remove theater/focus modes
        if (version < 5 && persistedState?.state) {
          persistedState.state.lyricsPlayerMode = 'default'
        }
        // v5 -> v6: add playback page backdrop mode
        if (version < 6 && persistedState?.state) {
          persistedState.state.playerBackdropMode = 'dynamic'
        }
        // v6 -> v7: remove vinyl mode
        if (version < 7 && persistedState?.state) {
          persistedState.state.lyricsPlayerMode = 'default'
        }
        if (persistedState?.state) {
          persistedState.state.lyricsPlayerMode = sanitizeLyricsPlayerMode(persistedState.state.lyricsPlayerMode)
          persistedState.state.playerBackdropMode = sanitizePlayerBackdropMode(persistedState.state.playerBackdropMode)
        }
        return persistedState
      },
      merge: (persistedState, currentState) => {
        const nextState = (persistedState && typeof persistedState === 'object')
          ? (persistedState as Partial<UIStore>)
          : {}

        return {
          ...currentState,
          ...nextState,
          lyricsPlayerMode: sanitizeLyricsPlayerMode(nextState.lyricsPlayerMode),
          playerBackdropMode: sanitizePlayerBackdropMode(nextState.playerBackdropMode),
        }
      },
      partialize: (state) => ({
        theme: state.theme,
        fontFamily: state.fontFamily,
        customFontDataUrl: state.customFontDataUrl,
        sidebarCollapsed: state.sidebarCollapsed,
        mainWindowAlwaysOnTop: state.mainWindowAlwaysOnTop,
        currentView: state.currentView,
        homePlatform: state.homePlatform,
        homeScrollTop: state.homeScrollTop,
        closeBehavior: state.closeBehavior,
        createPlaylistMode: state.createPlaylistMode,
        lyricsPanelTab: state.lyricsPanelTab,
        lyricsLeftPanelCollapsed: state.lyricsLeftPanelCollapsed,
        lyricsPlayerMode: state.lyricsPlayerMode,
        playerBackdropMode: state.playerBackdropMode,
        backgroundSettings: state.backgroundSettings,
      }),
    }
  )
)
