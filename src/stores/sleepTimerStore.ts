import { create } from 'zustand'

// The sleep-timer countdown ticks once per second while a timer runs. It lives
// outside the persisted player store so each tick doesn't re-run partialize
// (which maps and serializes the whole playlist) or starve the storage debounce.
type SleepTimerCountdownState = {
  remainingSeconds: number
  setRemainingSeconds: (seconds: number) => void
}

export const useSleepTimerCountdownStore = create<SleepTimerCountdownState>((set) => ({
  remainingSeconds: 0,
  setRemainingSeconds: (seconds) => set({ remainingSeconds: seconds }),
}))
