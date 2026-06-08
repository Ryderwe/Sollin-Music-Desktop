import { create } from 'zustand'

type PlaybackProgressState = {
  currentTime: number
  duration: number
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setProgress: (currentTime: number, duration: number) => void
  reset: (currentTime?: number, duration?: number) => void
}

// Throttle currentTime updates to avoid excessive re-renders.
// The HTML audio timeupdate fires ~4 times/sec; we only need ~2 updates/sec for smooth UI.
let lastUpdateTime = 0
const THROTTLE_MS = 250 // Update at most every 250ms (4 updates/sec)

export const usePlaybackProgressStore = create<PlaybackProgressState>((set) => ({
  currentTime: 0,
  duration: 0,
  setCurrentTime: (time) => {
    const now = performance.now()
    if (now - lastUpdateTime < THROTTLE_MS) return
    lastUpdateTime = now
    set({ currentTime: time })
  },
  setDuration: (duration) => set({ duration }),
  setProgress: (currentTime, duration) => {
    lastUpdateTime = performance.now()
    set({ currentTime, duration })
  },
  reset: (currentTime = 0, duration = 0) => {
    lastUpdateTime = 0
    set({ currentTime, duration })
  },
}))
