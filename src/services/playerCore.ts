type PlayerCoreEventBase = {
  currentSrc: string
}

export type PlayerCoreEvent =
  | ({ type: 'loadstart' } & PlayerCoreEventBase)
  | ({ type: 'loadeddata' } & PlayerCoreEventBase)
  | ({ type: 'canplay' } & PlayerCoreEventBase)
  | ({ type: 'playing' } & PlayerCoreEventBase)
  | ({ type: 'pause' } & PlayerCoreEventBase)
  | ({ type: 'waiting' } & PlayerCoreEventBase)
  | ({ type: 'emptied' } & PlayerCoreEventBase)
  | ({ type: 'ended' } & PlayerCoreEventBase)
  | ({ type: 'timeupdate'; currentTime: number } & PlayerCoreEventBase)
  | ({ type: 'durationchange'; duration: number } & PlayerCoreEventBase)
  | {
      type: 'error'
      error: MediaError | null
      currentSrc: string
      networkState: number
      readyState: number
    }

type PlayerCoreListener = (event: PlayerCoreEvent) => void

class PlayerCoreService {
  private audio: HTMLAudioElement | null = null
  private listeners = new Set<PlayerCoreListener>()
  private unsubscribeResourceListeners: (() => void) | null = null

  bind(audio: HTMLAudioElement) {
    if (this.audio === audio) return

    this.unsubscribeResourceListeners?.()
    this.unsubscribeResourceListeners = null
    // HMR can re-run the module that owns the zustand handler while the playerCore singleton
    // survives, leaving stale listeners that fire on every DOM event.  Clearing them on each
    // bind keeps us down to the single live listener that setAudioRef is about to attach.
    this.listeners.clear()
    this.audio = audio
    audio.preload = 'auto'
    audio.crossOrigin = 'anonymous'
    audio.setAttribute('crossorigin', 'anonymous')
  }

  subscribe(listener: PlayerCoreListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getAudio() {
    return this.audio
  }

  isEmpty() {
    return !this.audio?.src
  }

  getCurrentTime() {
    return this.audio?.currentTime || 0
  }

  getDuration() {
    return this.audio?.duration || 0
  }

  setCurrentTime(time: number) {
    if (!this.audio) return
    this.audio.currentTime = time
  }

  async setResource(
    source: string,
    options?: {
      autoplay?: boolean
      startTime?: number
    },
  ) {
    const audio = this.requireAudio()
    const autoplay = options?.autoplay !== false
    const startTime = typeof options?.startTime === 'number' && Number.isFinite(options.startTime)
      ? Math.max(0, options.startTime)
      : 0

    const applySeek = () => {
      if (!startTime) return
      try {
        audio.currentTime = startTime
      } catch {
        // Ignore seek errors before metadata becomes available.
      }
    }

    const cleanupDeferredSeek = this.attachDeferredSeek(audio, applySeek)

    this.unsubscribeResourceListeners?.()
    this.unsubscribeResourceListeners = this.attachResourceListeners(audio, source)
    audio.src = source
    audio.load()
    applySeek()

    try {
      if (autoplay) {
        await audio.play()
      }
      return source
    } finally {
      cleanupDeferredSeek()
    }
  }

  async play() {
    const audio = this.requireAudio()
    await audio.play()
  }

  pause() {
    this.audio?.pause()
  }

  stop() {
    if (!this.audio) return
    this.audio.pause()
    this.unsubscribeResourceListeners?.()
    this.unsubscribeResourceListeners = null
    this.audio.src = ''
    this.audio.removeAttribute('src')
  }

  private requireAudio() {
    if (!this.audio) {
      throw new Error('Audio element has not been bound')
    }
    return this.audio
  }

  private emit(event: PlayerCoreEvent) {
    this.listeners.forEach((listener) => {
      listener(event)
    })
  }

  private attachDeferredSeek(audio: HTMLAudioElement, callback: () => void) {
    const handleLoadedMetadata = () => callback()
    const handleCanPlay = () => callback()

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('canplay', handleCanPlay)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('canplay', handleCanPlay)
    }
  }

  private attachResourceListeners(audio: HTMLAudioElement, resourceSrc: string) {
    const handleLoadStart = () => this.emit({ type: 'loadstart', currentSrc: resourceSrc })
    const handleLoadedData = () => this.emit({ type: 'loadeddata', currentSrc: resourceSrc })
    const handleCanPlay = () => this.emit({ type: 'canplay', currentSrc: resourceSrc })
    const handlePlaying = () => this.emit({ type: 'playing', currentSrc: resourceSrc })
    const handlePause = () => this.emit({ type: 'pause', currentSrc: resourceSrc })
    const handleWaiting = () => this.emit({ type: 'waiting', currentSrc: resourceSrc })
    const handleEmptied = () => this.emit({ type: 'emptied', currentSrc: resourceSrc })
    const handleEnded = () => this.emit({ type: 'ended', currentSrc: resourceSrc })
    const handleTimeUpdate = () => this.emit({ type: 'timeupdate', currentSrc: resourceSrc, currentTime: audio.currentTime || 0 })
    const handleDurationChange = () => this.emit({ type: 'durationchange', currentSrc: resourceSrc, duration: audio.duration || 0 })
    const handleError = () => {
      this.emit({
        type: 'error',
        error: audio.error,
        currentSrc: resourceSrc,
        networkState: audio.networkState,
        readyState: audio.readyState,
      })
    }

    audio.addEventListener('loadstart', handleLoadStart)
    audio.addEventListener('loadeddata', handleLoadedData)
    audio.addEventListener('canplay', handleCanPlay)
    audio.addEventListener('playing', handlePlaying)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('waiting', handleWaiting)
    audio.addEventListener('emptied', handleEmptied)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('durationchange', handleDurationChange)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('loadstart', handleLoadStart)
      audio.removeEventListener('loadeddata', handleLoadedData)
      audio.removeEventListener('canplay', handleCanPlay)
      audio.removeEventListener('playing', handlePlaying)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('waiting', handleWaiting)
      audio.removeEventListener('emptied', handleEmptied)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('durationchange', handleDurationChange)
      audio.removeEventListener('error', handleError)
    }
  }
}

export const playerCore = new PlayerCoreService()
export default playerCore
