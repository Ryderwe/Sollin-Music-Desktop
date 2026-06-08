export {}

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void
      maximize: () => void
      setMiniMode: (enabled: boolean) => Promise<boolean>
      setWindowAlwaysOnTop: (enabled: boolean) => Promise<boolean>
      setWindowOpacity: (opacity: number) => Promise<number>
      close: () => void
      quit: () => void
      isMaximized: () => Promise<boolean>
      getPlatform: () => Promise<string>
      getVersion: () => Promise<string>
      getGlobalShortcutState: () => Promise<{
        config: {
          playPause: string | null
          previous: string | null
          next: string | null
        }
        status: {
          playPause: {
            accelerator: string | null
            registered: boolean
            error?: string
          }
          previous: {
            accelerator: string | null
            registered: boolean
            error?: string
          }
          next: {
            accelerator: string | null
            registered: boolean
            error?: string
          }
        }
      }>
      setGlobalShortcutConfig: (config: {
        playPause: string | null
        previous: string | null
        next: string | null
      }) => Promise<{
        config: {
          playPause: string | null
          previous: string | null
          next: string | null
        }
        status: {
          playPause: {
            accelerator: string | null
            registered: boolean
            error?: string
          }
          previous: {
            accelerator: string | null
            registered: boolean
            error?: string
          }
          next: {
            accelerator: string | null
            registered: boolean
            error?: string
          }
        }
      }>
      updatePlayerInfo: (info: { title: string; artist: string }) => void
      onPlayPause: (callback: () => void) => () => void
      onPrevious: (callback: () => void) => () => void
      onNext: (callback: () => void) => () => void
      onShowCloseDialog: (callback: () => void) => () => void
      updateLyric: (lyric: string) => void
      syncDesktopLyrics: (payload: {
        song?: {
          id: string
          name: string
          artist: string
          album?: string
          platform: string
        } | null
        lyricData?: import('@/types').LyricData | null
        lyrics?: string | null
        currentTime?: number
        isPlaying?: boolean
      }) => void
      toggleDesktopLyrics: () => void
      getDesktopLyricsStatus: () => Promise<boolean>
      lockDesktopLyrics: () => void
      unlockDesktopLyrics: () => void
      onDesktopLyricsStatus: (callback: (enabled: boolean) => void) => () => void
      toggleMenuBarLyrics: () => void
      getMenuBarLyricsStatus: () => Promise<boolean>
      onMenuBarLyricsStatus: (callback: (enabled: boolean) => void) => () => void
      onLyricUpdate: (callback: (lyric: string) => void) => () => void
      onDesktopLyricsState: (callback: (payload: {
        song: {
          id: string
          name: string
          artist: string
          album?: string
          platform: string
        } | null
        lyricData: import('@/types').LyricData | null
        lyrics: string | null
        currentTime: number
        isPlaying: boolean
      }) => void) => () => void
      onDesktopLyricsLock: (callback: () => void) => () => void
      onDesktopLyricsUnlock: (callback: () => void) => () => void
      setDesktopLyricsPosition: (x: number, y: number) => void
      setDesktopLyricsIgnoreMouse: (ignore: boolean) => void
      setDesktopLyricsInteractive: (interactive: boolean) => void
      setDesktopLyricsAlwaysOnTop: (alwaysOnTop: boolean) => void
      setDesktopLyricsHasShadow: (hasShadow: boolean) => void
      getPlayerState: () => Promise<any>
      setPlayerState: (state: any) => void
      pickBackgroundImage: () => Promise<string | null>
      pickLocalMusicFolders: () => Promise<string[]>
      scanLocalMusicFolders: (folders: string[]) => Promise<{
        folders: string[]
        songs: import('@/types').Song[]
        scannedAt: string
      }>
      getLocalSongMetadata: (payload: import('@/types').LocalSongMetadataRequest) => Promise<import('@/types').LocalSongMetadataDetail>
      updateLocalSongMetadata: (payload: import('@/types').LocalSongMetadataUpdatePayload) => Promise<import('@/types').LocalSongMetadataDetail>
      prepareLocalMusicPlayback: (filePath: string) => Promise<string>
      setLocalMusicTagPriority: (priority: string) => Promise<void>
      prepareRemoteMusicPlayback: (url: string) => Promise<string>
      getDownloadDefaultDirectory: () => Promise<string>
      pickDownloadDirectory: () => Promise<string | null>
      openDownloadDirectory: (directoryPath: string) => Promise<boolean>
      showItemInFolder: (filePath: string) => Promise<boolean>
      startSongDownload: (payload: {
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
        lyricData?: import('@/types').LyricData | null
        lyrics?: string | null
        coverUrl?: string | null
        fileNameRule?: {
          enabled: boolean
          parts: Array<'artist' | 'album' | 'title'>
          separator: string
        }
        saveExternalMetadataFiles?: boolean
      }) => Promise<{
        taskId: string
        filePath: string
        warning?: string
        metadataEmbedded: boolean
      }>
      cancelDownload: (taskId: string) => Promise<boolean>
      deleteDownloadTempFile: (directory: string, taskId: string) => Promise<boolean>
      onDownloadEvent: (callback: (payload: {
        taskId: string
        status: 'pending' | 'downloading' | 'completed' | 'failed'
        progress: number
        filePath?: string
        error?: string
        warning?: string
      }) => void) => () => void
      resolvePlayUrl: (url: string, headers?: Record<string, string>) => Promise<string | null>
      fetchImageAsDataUrl: (url: string) => Promise<string | null>
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
      requestLxSource: (payload: {
        sourceId?: string | null
        source: 'wy' | 'tx' | 'kw' | 'kg' | 'mg'
        action: 'musicUrl'
        info: {
          type: string
          musicInfo: any
        }
      }) => Promise<any>
      httpRequest: (options: {
        url: string
        method?: string
        headers?: Record<string, string>
        body?: unknown
      }) => Promise<{
        status: number
        headers: Record<string, string>
        setCookies: string[]
        bodyText: string
        bodyBase64?: string
      }>
      getDataSyncStatus: () => Promise<import('@/types/dataSync').DataSyncStatus>
      getDataSyncSnapshot: () => Promise<import('@/types/dataSync').DataSyncSnapshot | null>
      updateDataSyncConfig: (patch: Partial<import('@/types/dataSync').DataSyncConfig>) => Promise<import('@/types/dataSync').DataSyncStatus>
      connectDataSyncClient: (code: string) => Promise<import('@/types/dataSync').DataSyncStatus>
      disconnectDataSync: () => Promise<import('@/types/dataSync').DataSyncStatus>
      refreshDataSyncCode: () => Promise<import('@/types/dataSync').DataSyncStatus>
      removeDataSyncDevice: (deviceId: string) => Promise<import('@/types/dataSync').DataSyncStatus>
      pushDataSyncSnapshot: (snapshot: import('@/types/dataSync').DataSyncSnapshotData) => Promise<void>
      onDataSyncStatus: (callback: (status: import('@/types/dataSync').DataSyncStatus) => void) => () => void
      onDataSyncSnapshot: (callback: (snapshot: import('@/types/dataSync').DataSyncSnapshot | null) => void) => () => void
    }
  }
}
