import { contextBridge, ipcRenderer } from 'electron'

type HttpRequestOptions = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

type HttpRequestResponse = {
  status: number
  headers: Record<string, string>
  setCookies: string[]
  bodyText: string
  bodyBase64?: string
}

type LxSourceRequestPayload = {
  sourceId?: string | null
  source: 'wy' | 'tx' | 'kw' | 'kg' | 'mg'
  action: 'musicUrl'
  info: {
    type: string
    musicInfo: any
  }
}

type DesktopLyricsPayload = {
  song: {
    id: string
    name: string
    artist: string
    album?: string
    platform: string
  } | null
  lyricData: {
    lyric: string
    tlyric?: string
    rlyric?: string
    lxlyric?: string
  } | null
  lyrics: string | null
  currentTime: number
  isPlaying: boolean
}

type DesktopLyricsPayloadPatch = Partial<DesktopLyricsPayload>

type DownloadEventPayload = {
  taskId: string
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  progress: number
  filePath?: string
  error?: string
  warning?: string
}

type SongDownloadPayload = {
  taskId: string
  source: string
  sourceType: 'local' | 'remote'
  targetDirectory: string
  song: {
    title: string
    artist: string
    album: string
    songId: string
    quality?: string
  }
  lyricData?: {
    lyric: string
    tlyric?: string
    rlyric?: string
    lxlyric?: string
  } | null
  lyrics?: string | null
  coverUrl?: string | null
  fileNameRule?: {
    enabled: boolean
    parts: Array<'artist' | 'album' | 'title'>
    separator: string
  }
  saveExternalMetadataFiles?: boolean
}

type LocalSongMetadataRequest = {
  filePath: string
  rootFolderPath?: string
}

type LocalSongEmbeddedTags = {
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
}

type LocalSongMetadataDetail = {
  song: {
    id: string
    name: string
    artist: string
    album: string
    duration: number
    cover?: string
    url?: string
    lrc?: string
    platform: 'local'
    localPath?: string
    localFolder?: string
    localFileSize?: number
    localModifiedAt?: string
    localTrackNo?: number
    localDiscNo?: number
  }
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

type LocalSongMetadataUpdatePayload = LocalSongMetadataRequest & {
  tags: LocalSongEmbeddedTags
}

type GlobalShortcutAction = 'playPause' | 'previous' | 'next'

type GlobalShortcutConfig = Record<GlobalShortcutAction, string | null>

type GlobalShortcutRegistrationStatus = {
  accelerator: string | null
  registered: boolean
  error?: string
}

type GlobalShortcutState = {
  config: GlobalShortcutConfig
  status: Record<GlobalShortcutAction, GlobalShortcutRegistrationStatus>
}

const LX_SOURCE_PUBLIC_IPC = {
  getStatus: 'lx-source:get-status',
  setScriptPath: 'lx-source:set-script-path',
  pickScriptPath: 'lx-source:pick-script-path',
  importScriptUrl: 'lx-source:import-script-url',
  exportBackupState: 'lx-source:export-backup-state',
  restoreBackupState: 'lx-source:restore-backup-state',
  setAllowUpdateAlert: 'lx-source:set-allow-update-alert',
  setSourceAllowUpdateAlert: 'lx-source:set-source-allow-update-alert',
  setActiveSource: 'lx-source:set-active-source',
  removeSource: 'lx-source:remove-source',
  consumeUpdateAlerts: 'lx-source:consume-update-alerts',
  updateAlert: 'lx-source:update-alert',
  request: 'lx-source:request',
  httpRequest: 'music:http-request',
} as const

const electronAPI = {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  setMiniMode: (enabled: boolean) => ipcRenderer.invoke('window:set-mini-mode', enabled),
  setWindowAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('window:set-always-on-top', enabled),
  setWindowOpacity: (opacity: number) => ipcRenderer.invoke('window:set-opacity', opacity),
  close: () => ipcRenderer.send('window:close'),
  quit: () => ipcRenderer.send('window:quit'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  getPlatform: () => ipcRenderer.invoke('system:platform'),
  getVersion: () => ipcRenderer.invoke('system:version'),
  getGlobalShortcutState: () => ipcRenderer.invoke('global-shortcuts:get-state'),
  setGlobalShortcutConfig: (config: GlobalShortcutConfig) => ipcRenderer.invoke('global-shortcuts:set-config', config),

  // Persistent app data store (~/.sollin/store)
  storeGet: (name: string) => ipcRenderer.invoke('store:get', name) as Promise<unknown | null>,
  storeSet: (name: string, value: unknown) => ipcRenderer.invoke('store:set', name, value) as Promise<{ ok: boolean; error?: string }>,
  storeRemove: (name: string) => ipcRenderer.invoke('store:remove', name) as Promise<{ ok: boolean; error?: string }>,
  storeGetMany: (names: string[]) => ipcRenderer.invoke('store:getMany', names) as Promise<Record<string, unknown | null>>,
  storeFlush: () => ipcRenderer.invoke('store:flush') as Promise<{ ok: boolean }>,
  storeGetRootPath: () => ipcRenderer.invoke('store:getRootPath') as Promise<string>,
  storeOpenRootPath: () => ipcRenderer.invoke('store:openRootPath') as Promise<string>,

  updatePlayerInfo: (info: { title: string; artist: string; isPlaying?: boolean }) => {
    ipcRenderer.send('player:update-info', info)
  },

  updatePlayerState: (state: { isPlaying?: boolean; empty?: boolean; title?: string; artist?: string }) => {
    ipcRenderer.send('player:update-state', state)
  },

  onPlayPause: (callback: () => void) => {
    ipcRenderer.on('tray:play-pause', callback)
    return () => ipcRenderer.removeListener('tray:play-pause', callback)
  },
  onPrevious: (callback: () => void) => {
    ipcRenderer.on('tray:previous', callback)
    return () => ipcRenderer.removeListener('tray:previous', callback)
  },
  onNext: (callback: () => void) => {
    ipcRenderer.on('tray:next', callback)
    return () => ipcRenderer.removeListener('tray:next', callback)
  },

  onShowCloseDialog: (callback: () => void) => {
    ipcRenderer.on('window:show-close-dialog', callback)
    return () => ipcRenderer.removeListener('window:show-close-dialog', callback)
  },

  updateLyric: (lyric: string) => ipcRenderer.send('lyrics:update', lyric),
  syncDesktopLyrics: (payload: DesktopLyricsPayloadPatch) => ipcRenderer.send('desktop-lyrics:sync-state', payload),
  toggleDesktopLyrics: () => ipcRenderer.send('desktop-lyrics:toggle'),
  getDesktopLyricsStatus: () => ipcRenderer.invoke('desktop-lyrics:status'),
  getDesktopLyricsLockStatus: () => ipcRenderer.invoke('desktop-lyrics:lock-status'),
  lockDesktopLyrics: () => ipcRenderer.send('desktop-lyrics:lock'),
  unlockDesktopLyrics: () => ipcRenderer.send('desktop-lyrics:unlock'),
  onDesktopLyricsStatus: (callback: (enabled: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled)
    ipcRenderer.on('desktop-lyrics:status', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:status', handler)
  },
  onDesktopLyricsLockStatus: (callback: (locked: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, locked: boolean) => callback(locked)
    ipcRenderer.on('desktop-lyrics:lock-status', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:lock-status', handler)
  },
  toggleMenuBarLyrics: () => ipcRenderer.send('menu-bar-lyrics:toggle'),
  getMenuBarLyricsStatus: () => ipcRenderer.invoke('menu-bar-lyrics:status'),
  onMenuBarLyricsStatus: (callback: (enabled: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled)
    ipcRenderer.on('menu-bar-lyrics:status', handler)
    return () => ipcRenderer.removeListener('menu-bar-lyrics:status', handler)
  },
  onLyricUpdate: (callback: (lyric: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, lyric: string) => callback(lyric)
    ipcRenderer.on('lyrics:update', handler)
    return () => ipcRenderer.removeListener('lyrics:update', handler)
  },
  onDesktopLyricsState: (callback: (payload: DesktopLyricsPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: DesktopLyricsPayload) => callback(payload)
    ipcRenderer.on('desktop-lyrics:state', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:state', handler)
  },
  onDesktopLyricsTiming: (callback: (patch: { currentTime: number; isPlaying: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, patch: { currentTime: number; isPlaying: boolean }) => callback(patch)
    ipcRenderer.on('desktop-lyrics:timing', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:timing', handler)
  },
  onDesktopLyricsVisibility: (callback: (visible: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean) => callback(visible)
    ipcRenderer.on('desktop-lyrics:visibility', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:visibility', handler)
  },
  onDesktopLyricsLock: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('desktop-lyrics:lock', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:lock', handler)
  },
  onDesktopLyricsUnlock: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('desktop-lyrics:unlock', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:unlock', handler)
  },
  setDesktopLyricsPosition: (x: number, y: number) => ipcRenderer.send('desktop-lyrics:set-position', { x, y }),
  setDesktopLyricsIgnoreMouse: (ignore: boolean) => ipcRenderer.send('desktop-lyrics:set-ignore-mouse', ignore),
  setDesktopLyricsInteractive: (interactive: boolean) => ipcRenderer.send('desktop-lyrics:set-interactive', interactive),
  setDesktopLyricsLockStatus: (locked: boolean) => ipcRenderer.send('desktop-lyrics:set-lock-status', locked),
  setDesktopLyricsAlwaysOnTop: (alwaysOnTop: boolean) => ipcRenderer.send('desktop-lyrics:set-always-on-top', alwaysOnTop),
  setDesktopLyricsHasShadow: (hasShadow: boolean) => ipcRenderer.send('desktop-lyrics:set-has-shadow', hasShadow),

  getPlayerState: () => ipcRenderer.invoke('player-state:get'),
  setPlayerState: (state: unknown) => ipcRenderer.send('player-state:set', state),
  pickBackgroundImage: () => ipcRenderer.invoke('background:pick-image'),
  pickLocalMusicFolders: () => ipcRenderer.invoke('local-music:pick-folders'),
  scanLocalMusicFolders: (folders: string[]) => ipcRenderer.invoke('local-music:scan-folders', folders),
  setLocalMusicTagPriority: (priority: string) => ipcRenderer.invoke('local-music:set-tag-priority', priority),
  getLocalSongMetadata: (payload: LocalSongMetadataRequest) => ipcRenderer.invoke('local-music:get-metadata', payload),
  updateLocalSongMetadata: (payload: LocalSongMetadataUpdatePayload) => ipcRenderer.invoke('local-music:update-metadata', payload),
  prepareLocalMusicPlayback: (filePath: string) => ipcRenderer.invoke('local-music:prepare-playback', filePath),
  prepareRemoteMusicPlayback: (url: string) => ipcRenderer.invoke('music:prepare-remote-playback', url),
  getDownloadDefaultDirectory: () => ipcRenderer.invoke('downloads:get-default-directory'),
  pickDownloadDirectory: () => ipcRenderer.invoke('downloads:pick-directory'),
  openDownloadDirectory: (directoryPath: string) => ipcRenderer.invoke('downloads:open-directory', directoryPath),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('downloads:show-item-in-folder', filePath),
  startSongDownload: (payload: SongDownloadPayload) => ipcRenderer.invoke('downloads:start', payload),
  cancelDownload: (taskId: string) => ipcRenderer.invoke('downloads:cancel', taskId),
  deleteDownloadTempFile: (directory: string, taskId: string) => ipcRenderer.invoke('downloads:delete-temp-file', directory, taskId),
  onDownloadEvent: (callback: (payload: DownloadEventPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: DownloadEventPayload) => callback(payload)
    ipcRenderer.on('downloads:event', handler)
    return () => ipcRenderer.removeListener('downloads:event', handler)
  },

  resolvePlayUrl: (url: string, headers?: Record<string, string>) =>
    ipcRenderer.invoke('music:resolve-play-url', { url, headers }),
  fetchImageAsDataUrl: (url: string) => ipcRenderer.invoke('image:fetch-data-url', url),

  decodeTxLyric: (payload: { lrc: string; tlrc: string; rlrc: string }) =>
    ipcRenderer.invoke('music:decode-tx-lyric', payload),
  decodeKwLyric: (payload: { lrcBase64: string; isGetLyricx: boolean }) =>
    ipcRenderer.invoke('music:decode-kw-lyric', payload),
  decodeKrcLyric: (data: string) => ipcRenderer.invoke('music:decode-krc-lyric', data),

  getLxSourceStatus: () => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.getStatus),
  setLxSourceScriptPath: (path: string) => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.setScriptPath, path),
  pickLxSourceScriptPath: () => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.pickScriptPath),
  importLxSourceScriptUrl: (url: string) => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.importScriptUrl, url),
  exportLxSourceBackupState: () => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.exportBackupState),
  restoreLxSourceBackupState: (payload: unknown) => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.restoreBackupState, payload),
  setLxSourceAllowUpdateAlert: (enable: boolean) => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.setAllowUpdateAlert, enable),
  setLxSourceItemAllowUpdateAlert: (sourceId: string, enable: boolean) =>
    ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.setSourceAllowUpdateAlert, { sourceId, enable }),
  setLxSourceActiveSource: (sourceId: string | null) => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.setActiveSource, sourceId),
  removeLxSourceItem: (sourceId: string) => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.removeSource, sourceId),
  consumeLxSourceUpdateAlerts: () => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.consumeUpdateAlerts),
  onLxSourceUpdateAlert: (callback: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on(LX_SOURCE_PUBLIC_IPC.updateAlert, handler)
    return () => ipcRenderer.removeListener(LX_SOURCE_PUBLIC_IPC.updateAlert, handler)
  },
  requestLxSource: (payload: LxSourceRequestPayload) => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.request, payload),
  httpRequest: (options: HttpRequestOptions) => ipcRenderer.invoke(LX_SOURCE_PUBLIC_IPC.httpRequest, options),
  getDataSyncStatus: () => ipcRenderer.invoke('data-sync:get-status'),
  getDataSyncSnapshot: () => ipcRenderer.invoke('data-sync:get-snapshot'),
  updateDataSyncConfig: (patch: Partial<{ enabled: boolean; mode: 'server' | 'client'; serverPort: number; clientHost: string; connectionCode: string }>) =>
    ipcRenderer.invoke('data-sync:update-config', patch),
  connectDataSyncClient: (code: string) => ipcRenderer.invoke('data-sync:connect-client', code),
  disconnectDataSync: () => ipcRenderer.invoke('data-sync:disconnect'),
  refreshDataSyncCode: () => ipcRenderer.invoke('data-sync:refresh-code'),
  removeDataSyncDevice: (deviceId: string) => ipcRenderer.invoke('data-sync:remove-device', deviceId),
  pushDataSyncSnapshot: (snapshot: unknown) => ipcRenderer.send('data-sync:push-snapshot', snapshot),
  onDataSyncStatus: (callback: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('data-sync:status', handler)
    return () => ipcRenderer.removeListener('data-sync:status', handler)
  },
  onDataSyncSnapshot: (callback: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('data-sync:snapshot', handler)
    return () => ipcRenderer.removeListener('data-sync:snapshot', handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
ipcRenderer.send('debug:preload-ready', {
  scope: 'main-window',
  methods: Object.keys(electronAPI),
  hasLxSourceStatus: typeof electronAPI.getLxSourceStatus === 'function',
  hasPickLxSourceScriptPath: typeof electronAPI.pickLxSourceScriptPath === 'function',
})

declare global {
  interface Window {
    electronAPI: {
      minimize: () => void
      maximize: () => void
      setMiniMode: (enabled: boolean) => Promise<boolean>
      setWindowAlwaysOnTop: (enabled: boolean) => Promise<boolean>
      setWindowOpacity: (opacity: number) => Promise<number>
      close: () => void
      quit: () => void
      isMaximized: () => Promise<boolean>
      getPlatform: () => Promise<NodeJS.Platform>
      getVersion: () => Promise<string>
      storeGet: (name: string) => Promise<unknown | null>
      storeSet: (name: string, value: unknown) => Promise<{ ok: boolean; error?: string }>
      storeRemove: (name: string) => Promise<{ ok: boolean; error?: string }>
      storeGetMany: (names: string[]) => Promise<Record<string, unknown | null>>
      storeFlush: () => Promise<{ ok: boolean }>
      storeGetRootPath: () => Promise<string>
      storeOpenRootPath: () => Promise<string>
      getGlobalShortcutState: () => Promise<GlobalShortcutState>
      setGlobalShortcutConfig: (config: GlobalShortcutConfig) => Promise<GlobalShortcutState>
      updatePlayerInfo: (info: { title: string; artist: string; isPlaying?: boolean }) => void
      updatePlayerState: (state: { isPlaying?: boolean; empty?: boolean; title?: string; artist?: string }) => void
      onPlayPause: (callback: () => void) => () => void
      onPrevious: (callback: () => void) => () => void
      onNext: (callback: () => void) => () => void
      onShowCloseDialog: (callback: () => void) => () => void
      updateLyric: (lyric: string) => void
      syncDesktopLyrics: (payload: DesktopLyricsPayloadPatch) => void
      toggleDesktopLyrics: () => void
      getDesktopLyricsStatus: () => Promise<boolean>
      getDesktopLyricsLockStatus: () => Promise<boolean>
      lockDesktopLyrics: () => void
      unlockDesktopLyrics: () => void
      onDesktopLyricsStatus: (callback: (enabled: boolean) => void) => () => void
      onDesktopLyricsLockStatus: (callback: (locked: boolean) => void) => () => void
      toggleMenuBarLyrics: () => void
      getMenuBarLyricsStatus: () => Promise<boolean>
      onMenuBarLyricsStatus: (callback: (enabled: boolean) => void) => () => void
      onLyricUpdate: (callback: (lyric: string) => void) => () => void
      onDesktopLyricsState: (callback: (payload: DesktopLyricsPayload) => void) => () => void
      onDesktopLyricsLock: (callback: () => void) => () => void
      onDesktopLyricsUnlock: (callback: () => void) => () => void
      setDesktopLyricsPosition: (x: number, y: number) => void
      setDesktopLyricsIgnoreMouse: (ignore: boolean) => void
      setDesktopLyricsInteractive: (interactive: boolean) => void
      setDesktopLyricsLockStatus: (locked: boolean) => void
      setDesktopLyricsAlwaysOnTop: (alwaysOnTop: boolean) => void
      setDesktopLyricsHasShadow: (hasShadow: boolean) => void
      getPlayerState: () => Promise<unknown>
      setPlayerState: (state: unknown) => void
      pickLocalMusicFolders: () => Promise<string[]>
      scanLocalMusicFolders: (folders: string[]) => Promise<{
        folders: string[]
        songs: Array<{
          id: string
          name: string
          artist: string
          album: string
          duration: number
          cover?: string
          url?: string
          lrc?: string
          platform: 'local'
          localPath?: string
          localFolder?: string
          localFileSize?: number
          localModifiedAt?: string
          localTrackNo?: number
          localDiscNo?: number
        }>
        scannedAt: string
      }>
      prepareLocalMusicPlayback: (filePath: string) => Promise<string>
      setLocalMusicTagPriority: (priority: string) => Promise<void>
      prepareRemoteMusicPlayback: (url: string) => Promise<string>
      getDownloadDefaultDirectory: () => Promise<string>
      pickDownloadDirectory: () => Promise<string | null>
      openDownloadDirectory: (directoryPath: string) => Promise<boolean>
      showItemInFolder: (filePath: string) => Promise<boolean>
      startSongDownload: (payload: SongDownloadPayload) => Promise<{
        taskId: string
        filePath: string
        warning?: string
        metadataEmbedded: boolean
      }>
      cancelDownload: (taskId: string) => Promise<boolean>
      deleteDownloadTempFile: (directory: string, taskId: string) => Promise<boolean>
      onDownloadEvent: (callback: (payload: DownloadEventPayload) => void) => () => void
      resolvePlayUrl: (url: string, headers?: Record<string, string>) => Promise<string | null>
      decodeTxLyric: (payload: { lrc: string; tlrc: string; rlrc: string }) => Promise<{ lyric: string; tlyric: string; rlyric: string }>
      decodeKwLyric: (payload: { lrcBase64: string; isGetLyricx: boolean }) => Promise<string>
      decodeKrcLyric: (data: string) => Promise<string>
      getLxSourceStatus: () => Promise<any>
      setLxSourceScriptPath: (path: string) => Promise<any>
      pickLxSourceScriptPath: () => Promise<string | null>
      importLxSourceScriptUrl: (url: string) => Promise<any>
      exportLxSourceBackupState: () => Promise<any>
      restoreLxSourceBackupState: (payload: unknown) => Promise<any>
      setLxSourceAllowUpdateAlert: (enable: boolean) => Promise<any>
      setLxSourceItemAllowUpdateAlert: (sourceId: string, enable: boolean) => Promise<any>
      setLxSourceActiveSource: (sourceId: string | null) => Promise<any>
      removeLxSourceItem: (sourceId: string) => Promise<any>
      consumeLxSourceUpdateAlerts: () => Promise<any[]>
      onLxSourceUpdateAlert: (callback: (payload: unknown) => void) => () => void
      requestLxSource: (payload: LxSourceRequestPayload) => Promise<any>
      httpRequest: (options: HttpRequestOptions) => Promise<HttpRequestResponse>
    }
  }
}
