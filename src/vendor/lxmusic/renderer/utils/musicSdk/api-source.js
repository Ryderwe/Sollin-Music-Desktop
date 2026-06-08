// API source factory mirroring lx-music-desktop's api-source.js.
// Dynamic presets (kw_test/kg_test/...) are intentionally omitted; Sollin delegates playback URL
// resolution to LX scripts (user_api) by default, which matches lx-music-desktop's default behavior.

import apiSourceInfo from './api-source-info'

const allApi = {}

const apiList = {}
const supportQuality = {}

for (const api of apiSourceInfo) {
  supportQuality[api.id] = api.supportQualitys
  for (const source of Object.keys(api.supportQualitys || {})) {
    apiList[`${api.id}_api_${source}`] = allApi[`${api.id}_${source}`]
  }
}

// Runtime bindings.  The factory defers to the currently selected apiSource id and, when the active
// source is a user_api, to the adapters provided by the LX source runtime.
let activeApiSourceId = null
let userApiAdapters = null

export const setActiveApiSource = (sourceId) => {
  activeApiSourceId = typeof sourceId === 'string' && sourceId ? sourceId : null
}

export const getActiveApiSource = () => activeApiSourceId

export const setUserApiAdapters = (adapters) => {
  userApiAdapters = adapters && typeof adapters === 'object' ? adapters : null
}

export const getUserApiAdapters = () => userApiAdapters

const getAPI = source => {
  if (!activeApiSourceId) return null
  return apiList[`${activeApiSourceId}_api_${source}`] || null
}

export const apis = source => {
  if (activeApiSourceId && /^user_api/.test(activeApiSourceId)) {
    const adapter = userApiAdapters?.[source]
    if (!adapter) throw new Error('Api is not found')
    return adapter
  }
  const api = getAPI(source)
  if (api) return api
  throw new Error('Api is not found')
}

export { supportQuality }
