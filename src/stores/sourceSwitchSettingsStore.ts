import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Platform } from '@/types'

// Structured preferences for the automatic source-switch pipeline.  Persisted separately from
// playerStore so it can be imported/exported independently and so legacy migrations do not get
// tangled up with live playback state.

export type SourceSwitchStageId = 'origin' | 'findMusic' | 'scripts'

export const ALL_PLATFORMS: Platform[] = ['netease', 'qq', 'kuwo', 'kugou', 'migu']

// lx-music-desktop ships with kw/kg first because their public APIs are the most permissive and
// least likely to rate limit.  We follow the same ordering by default so the average user gets
// better odds out of the box.
const DEFAULT_PLATFORM_ORDER: Platform[] = ['kuwo', 'kugou', 'migu', 'netease', 'qq']

export interface SourceSwitchStage {
  id: SourceSwitchStageId
  enabled: boolean
}

const DEFAULT_STAGES: SourceSwitchStage[] = [
  { id: 'origin', enabled: true },
  { id: 'findMusic', enabled: true },
  { id: 'scripts', enabled: true },
]

export interface SourceSwitchSettingsState {
  enabled: boolean
  rememberToggleChoices: boolean
  stages: SourceSwitchStage[]
  platformOrder: Platform[]
  platformEnabled: Record<Platform, boolean>
  scriptOrder: string[]
  scriptEnabled: Record<string, boolean>

  setEnabled: (enabled: boolean) => void
  setRememberToggleChoices: (enabled: boolean) => void
  setStageEnabled: (id: SourceSwitchStageId, enabled: boolean) => void
  moveStage: (id: SourceSwitchStageId, direction: -1 | 1) => void
  setPlatformEnabled: (platform: Platform, enabled: boolean) => void
  movePlatform: (platform: Platform, direction: -1 | 1) => void
  resetPlatformOrder: () => void
  setScriptEnabled: (scriptId: string, enabled: boolean) => void
  moveScript: (scriptId: string, direction: -1 | 1) => void
  syncScriptList: (scriptIds: string[]) => void
  reset: () => void
}

const buildDefaultPlatformEnabled = (): Record<Platform, boolean> => ({
  netease: true,
  qq: true,
  kuwo: true,
  kugou: true,
  migu: true,
})

const sanitizePlatformOrder = (candidate: unknown): Platform[] => {
  if (!Array.isArray(candidate)) return [...DEFAULT_PLATFORM_ORDER]
  const seen = new Set<Platform>()
  const result: Platform[] = []
  for (const value of candidate) {
    if (typeof value === 'string' && ALL_PLATFORMS.includes(value as Platform) && !seen.has(value as Platform)) {
      seen.add(value as Platform)
      result.push(value as Platform)
    }
  }
  // Append any platform we forgot about so new first-party platforms never silently disappear.
  for (const platform of DEFAULT_PLATFORM_ORDER) {
    if (!seen.has(platform)) result.push(platform)
  }
  return result
}

const sanitizeStageOrder = (candidate: unknown): SourceSwitchStage[] => {
  const seen = new Set<SourceSwitchStageId>()
  const result: SourceSwitchStage[] = []
  if (Array.isArray(candidate)) {
    for (const entry of candidate) {
      if (!entry || typeof entry !== 'object') continue
      const id = (entry as { id?: unknown }).id
      if (typeof id !== 'string') continue
      if (!(DEFAULT_STAGES.some((stage) => stage.id === id))) continue
      if (seen.has(id as SourceSwitchStageId)) continue
      seen.add(id as SourceSwitchStageId)
      result.push({
        id: id as SourceSwitchStageId,
        enabled: typeof (entry as { enabled?: unknown }).enabled === 'boolean' ? (entry as { enabled: boolean }).enabled : true,
      })
    }
  }
  for (const stage of DEFAULT_STAGES) {
    if (!seen.has(stage.id)) result.push({ ...stage })
  }
  return result
}

const moveItem = <T,>(list: T[], predicate: (item: T) => boolean, direction: -1 | 1): T[] => {
  const index = list.findIndex(predicate)
  if (index === -1) return list
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= list.length) return list
  const copy = list.slice()
  const [target] = copy.splice(index, 1)
  copy.splice(nextIndex, 0, target)
  return copy
}

export const useSourceSwitchSettingsStore = create<SourceSwitchSettingsState>()(
  persist(
    (set, get) => ({
      enabled: true,
      rememberToggleChoices: true,
      stages: DEFAULT_STAGES.map((stage) => ({ ...stage })),
      platformOrder: [...DEFAULT_PLATFORM_ORDER],
      platformEnabled: buildDefaultPlatformEnabled(),
      scriptOrder: [],
      scriptEnabled: {},

      setEnabled: (enabled) => {
        const nextValue = Boolean(enabled)
        if (get().enabled === nextValue) return
        set({ enabled: nextValue })
      },
      setRememberToggleChoices: (enabled) => set({ rememberToggleChoices: Boolean(enabled) }),
      setStageEnabled: (id, enabled) => {
        const stages = get().stages.map((stage) => (
          stage.id === id ? { ...stage, enabled: Boolean(enabled) } : stage
        ))
        set({ stages })
      },
      moveStage: (id, direction) => {
        set({ stages: moveItem(get().stages, (stage) => stage.id === id, direction) })
      },
      setPlatformEnabled: (platform, enabled) => {
        set({ platformEnabled: { ...get().platformEnabled, [platform]: Boolean(enabled) } })
      },
      movePlatform: (platform, direction) => {
        set({ platformOrder: moveItem(get().platformOrder, (item) => item === platform, direction) })
      },
      resetPlatformOrder: () => {
        set({
          platformOrder: [...DEFAULT_PLATFORM_ORDER],
          platformEnabled: buildDefaultPlatformEnabled(),
        })
      },
      setScriptEnabled: (scriptId, enabled) => {
        if (!scriptId) return
        set({ scriptEnabled: { ...get().scriptEnabled, [scriptId]: Boolean(enabled) } })
      },
      moveScript: (scriptId, direction) => {
        set({ scriptOrder: moveItem(get().scriptOrder, (item) => item === scriptId, direction) })
      },
      syncScriptList: (scriptIds) => {
        const validIds = Array.isArray(scriptIds) ? scriptIds.filter((id) => typeof id === 'string' && id) : []
        const current = get()
        const nextOrder: string[] = []
        const seen = new Set<string>()
        for (const id of current.scriptOrder) {
          if (validIds.includes(id) && !seen.has(id)) {
            seen.add(id)
            nextOrder.push(id)
          }
        }
        for (const id of validIds) {
          if (!seen.has(id)) {
            seen.add(id)
            nextOrder.push(id)
          }
        }
        const nextEnabled: Record<string, boolean> = {}
        for (const id of nextOrder) {
          nextEnabled[id] = typeof current.scriptEnabled[id] === 'boolean' ? current.scriptEnabled[id] : true
        }
        const orderChanged = nextOrder.length !== current.scriptOrder.length
          || nextOrder.some((id, idx) => current.scriptOrder[idx] !== id)
        const enabledChanged = Object.keys(nextEnabled).length !== Object.keys(current.scriptEnabled).length
          || nextOrder.some((id) => current.scriptEnabled[id] !== nextEnabled[id])
        if (!orderChanged && !enabledChanged) return
        set({ scriptOrder: nextOrder, scriptEnabled: nextEnabled })
      },
      reset: () => set({
        enabled: true,
        rememberToggleChoices: true,
        stages: DEFAULT_STAGES.map((stage) => ({ ...stage })),
        platformOrder: [...DEFAULT_PLATFORM_ORDER],
        platformEnabled: buildDefaultPlatformEnabled(),
        scriptOrder: [],
        scriptEnabled: {},
      }),
    }),
    {
      name: 'sollin.sourceSwitchSettings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        rememberToggleChoices: state.rememberToggleChoices,
        stages: state.stages,
        platformOrder: state.platformOrder,
        platformEnabled: state.platformEnabled,
        scriptOrder: state.scriptOrder,
        scriptEnabled: state.scriptEnabled,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<SourceSwitchSettingsState>
        return {
          ...currentState,
          ...persisted,
          enabled: typeof persisted.enabled === 'boolean' ? persisted.enabled : currentState.enabled,
          rememberToggleChoices: typeof persisted.rememberToggleChoices === 'boolean' ? persisted.rememberToggleChoices : currentState.rememberToggleChoices,
          stages: sanitizeStageOrder(persisted.stages),
          platformOrder: sanitizePlatformOrder(persisted.platformOrder),
          platformEnabled: { ...buildDefaultPlatformEnabled(), ...(persisted.platformEnabled || {}) },
          scriptOrder: Array.isArray(persisted.scriptOrder) ? persisted.scriptOrder.filter((id) => typeof id === 'string' && id) : [],
          scriptEnabled: persisted.scriptEnabled && typeof persisted.scriptEnabled === 'object' ? { ...persisted.scriptEnabled } : {},
        }
      },
    },
  ),
)

export const getSourceSwitchSnapshot = () => {
  const state = useSourceSwitchSettingsStore.getState()
  return {
    enabled: state.enabled,
    rememberToggleChoices: state.rememberToggleChoices,
    stages: state.stages.map((stage) => ({ ...stage })),
    platformOrder: [...state.platformOrder],
    platformEnabled: { ...state.platformEnabled },
    scriptOrder: [...state.scriptOrder],
    scriptEnabled: { ...state.scriptEnabled },
  }
}

export const isStageEnabled = (id: SourceSwitchStageId): boolean => {
  const state = useSourceSwitchSettingsStore.getState()
  if (!state.enabled) return false
  const stage = state.stages.find((s) => s.id === id)
  return stage?.enabled ?? true
}

export const getEnabledStagesInOrder = (): SourceSwitchStageId[] => {
  const state = useSourceSwitchSettingsStore.getState()
  if (!state.enabled) return []
  return state.stages.filter((stage) => stage.enabled).map((stage) => stage.id)
}

export const getEnabledPlatformOrder = (): Platform[] => {
  const state = useSourceSwitchSettingsStore.getState()
  return state.platformOrder.filter((platform) => state.platformEnabled[platform] !== false)
}

export const getEnabledScriptOrder = (): { order: string[]; includeUnlisted: boolean } => {
  const state = useSourceSwitchSettingsStore.getState()
  return {
    order: state.scriptOrder.filter((id) => state.scriptEnabled[id] !== false),
    // Scripts not yet synced into the settings store default to enabled so that newly-imported
    // scripts are usable immediately without waiting for the user to tweak the settings page.
    includeUnlisted: true,
  }
}
