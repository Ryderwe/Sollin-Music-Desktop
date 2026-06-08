import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { usePlayerStore } from '@/stores/playerStore'
import { useSourceSwitchSettingsStore } from '@/stores/sourceSwitchSettingsStore'

// Keep the structured source-switch settings store and the legacy playerStore flag in sync.
// Running this at bootstrap means both panels (legacy single toggle and the new pipeline panel)
// see the same truth no matter which one was last persisted.
;(function bootstrapSourceSwitchSync() {
  try {
    const settings = useSourceSwitchSettingsStore.getState()
    const playerState = usePlayerStore.getState()
    if (playerState.autoTemporarySourceSwitch !== settings.enabled) {
      usePlayerStore.setState({ autoTemporarySourceSwitch: settings.enabled })
    }
    useSourceSwitchSettingsStore.subscribe((state, prev) => {
      if (state.enabled === prev.enabled) return
      const { autoTemporarySourceSwitch } = usePlayerStore.getState()
      if (autoTemporarySourceSwitch !== state.enabled) {
        usePlayerStore.setState({ autoTemporarySourceSwitch: state.enabled })
      }
    })
  } catch (error) {
    console.warn('[bootstrap] source-switch settings sync failed:', error)
  }
})()

// Expose the vendored music SDK on the window for quick DevTools experiments while we
// wire findMusic / getMusicUrl into the playback pipeline.  Dev only.
if (import.meta.env.DEV) {
  import('@/vendor/lxmusic/renderer/utils/musicSdk/index.js')
    .then((mod) => {
      ;(window as any).__lxMusicSdk = mod.default ?? mod
    })
    .catch((err) => {
      console.warn('[vendor musicSdk] dev exposure failed:', err)
    })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
