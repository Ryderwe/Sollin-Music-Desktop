export const LX_SOURCE_PUBLIC_IPC = {
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

export const LX_SOURCE_INTERNAL_IPC = {
  runtimeReady: 'lx-source:runtime-ready',
  initEnv: 'lx-source:init-env',
  initResult: 'lx-source:init-result',
  request: 'lx-source:runtime-request',
  response: 'lx-source:runtime-response',
  updateAlert: 'lx-source:runtime-update-alert',
} as const

export const LX_SOURCE_CANDIDATE_PATHS = [
] as const

export type LxSourceName = 'wy' | 'tx' | 'kw' | 'kg' | 'mg'
export type LxSourceAction = 'musicUrl'
export type LxManagedSourceType = 'local' | 'url'

export type LxSourceRequestPayload = {
  sourceId?: string | null
  source: LxSourceName
  action: LxSourceAction
  info: {
    type: string
    musicInfo: any
  }
}

export type LxSourceScriptInfo = {
  name: string
  description: string
  author: string
  homepage: string
  version: string
}

export type LxSourceScriptSourceInfo = {
  type: string
  actions: string[]
  qualitys: string[]
}

export type LxManagedSource = {
  id: string
  type: LxManagedSourceType
  path: string
  url: string | null
  importedAt: number
  allowShowUpdateAlert: boolean
  exists: boolean
  isActive: boolean
  scriptInfo: LxSourceScriptInfo
}

export type LxBackupSourcePayload = {
  id: string
  info: {
    name: string
    description?: string | null
    version?: string | null
    author?: string | null
    homepage?: string | null
    rawScript: string
  }
  addedAt: string
  isActive: boolean
  allowShowUpdateAlert: boolean
}

export type LxBackupStatePayload = {
  sources: LxBackupSourcePayload[]
  activeSourceId: string | null
}

export type LxSourceInitResponse = {
  sources?: Record<string, LxSourceScriptSourceInfo>
}

export type LxSourceUpdateAlertPayload = {
  sourceId: string | null
  name: string
  description: string
  version: string
  scriptUrl: string | null
  updateUrl?: string
  log: string
}

export type LxSourceStatus = {
  activeSourceId: string | null
  configuredPath: string | null
  autoDetectedPath: string | null
  scriptPath: string | null
  scriptUrl: string | null
  scriptExists: boolean
  runtimeReady: boolean
  scriptLoaded: boolean
  allowShowUpdateAlert: boolean
  scriptInfo: LxSourceScriptInfo | null
  managedSources: LxManagedSource[]
  supportedSources: Record<string, LxSourceScriptSourceInfo>
  lastError: string | null
}

export type LxSourceRuntimeInitPayload = {
  scriptPath: string
  script: string
  scriptInfo: LxSourceScriptInfo
}

export type LxSourceRuntimeInitResult = {
  ok: boolean
  data?: LxSourceInitResponse
  error?: string
}

export type LxSourceRuntimeResponse = {
  requestKey: string
  ok: boolean
  result?: {
    source: string
    action: string
    data: {
      type: string
      url: string
    }
  }
  error?: string
}
