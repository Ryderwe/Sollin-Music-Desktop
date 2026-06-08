export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

export type EqFrequency = (typeof EQ_FREQUENCIES)[number]

export type EqPreset = {
  id: string
  name: string
  gains: Record<EqFrequency, number>
}

export type ReverbPreset = {
  id: string
  name: string
  seconds: number
  decay: number
  reverse?: boolean
  mainGain: number
  sendGain: number
}

export type AudioEffectsSettings = {
  audioVisualizationEnabled: boolean
  eqEnabled: boolean
  eqPresetId: string
  eqGains: Record<number, number>
  reverbEnabled: boolean
  reverbPresetId: string
  reverbMainGain: number
  reverbSendGain: number
  spatialAudioEnabled: boolean
  spatialAudioRadius: number
  spatialAudioSpeed: number
  playbackRate: number
}

export const EQ_PRESETS: EqPreset[] = [
  { id: 'default', name: '默认', gains: { 31: 0, 62: 0, 125: 0, 250: 0, 500: 0, 1000: 0, 2000: 0, 4000: 0, 8000: 0, 16000: 0 } },
  { id: 'pop', name: '流行', gains: { 31: 6, 62: 5, 125: -3, 250: -2, 500: 5, 1000: 4, 2000: -4, 4000: -3, 8000: 6, 16000: 4 } },
  { id: 'dance', name: '舞曲', gains: { 31: 4, 62: 3, 125: -4, 250: -6, 500: 0, 1000: 0, 2000: 3, 4000: 4, 8000: 4, 16000: 5 } },
  { id: 'rock', name: '摇滚', gains: { 31: 7, 62: 6, 125: 2, 250: 1, 500: -3, 1000: -4, 2000: 2, 4000: 1, 8000: 4, 16000: 5 } },
  { id: 'classical', name: '古典', gains: { 31: 6, 62: 7, 125: 1, 250: 2, 500: -1, 1000: 1, 2000: -4, 4000: -6, 8000: -7, 16000: -8 } },
  { id: 'vocal', name: '人声', gains: { 31: -5, 62: -6, 125: -4, 250: -3, 500: 3, 1000: 4, 2000: 5, 4000: 4, 8000: -3, 16000: -3 } },
  { id: 'electronic', name: '电子', gains: { 31: 6, 62: 5, 125: 0, 250: -5, 500: -4, 1000: 0, 2000: 6, 4000: 8, 8000: 8, 16000: 7 } },
]

export const REVERB_PRESETS: ReverbPreset[] = [
  { id: 'room', name: '小房间', seconds: 1.6, decay: 1.8, mainGain: 0.82, sendGain: 0.42 },
  { id: 'hall', name: '大厅', seconds: 2.8, decay: 2.4, mainGain: 0.7, sendGain: 0.56 },
  { id: 'church', name: '教堂', seconds: 4.6, decay: 3.1, mainGain: 0.62, sendGain: 0.68 },
  { id: 'plate', name: '金属板', seconds: 2.2, decay: 2.1, mainGain: 0.76, sendGain: 0.48, reverse: true },
]

export const DEFAULT_AUDIO_EFFECTS_SETTINGS: AudioEffectsSettings = {
  audioVisualizationEnabled: false,
  eqEnabled: false,
  eqPresetId: 'default',
  eqGains: EQ_PRESETS[0].gains,
  reverbEnabled: false,
  reverbPresetId: 'room',
  reverbMainGain: 82,
  reverbSendGain: 42,
  spatialAudioEnabled: false,
  spatialAudioRadius: 50,
  spatialAudioSpeed: 50,
  playbackRate: 1,
}

type EngineNodes = {
  context: AudioContext
  source: MediaElementAudioSourceNode
  analyser: AnalyserNode
  filters: Map<EqFrequency, BiquadFilterNode>
  panner: PannerNode
  dryGain: GainNode
  wetInputGain: GainNode
  wetOutputGain: GainNode
  convolver: ConvolverNode
  masterGain: GainNode
}

type PassiveAnalyserNodes = {
  context: AudioContext
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  sink: GainNode
  hasLiveAudio: () => boolean
}

type PassiveAnalyserListeners = {
  audio: HTMLAudioElement
  ensureWhenPlaying: () => void
  cleanupWhenEmptied: () => void
}

let engineNodes: EngineNodes | null = null
let currentAudioElement: HTMLAudioElement | null = null
let passiveAnalyserNodes: PassiveAnalyserNodes | null = null
let passiveAnalyserElement: HTMLAudioElement | null = null
let passiveAnalyserListeners: PassiveAnalyserListeners | null = null
let pannerTimer: number | null = null
let pannerAngle = 0
const reverbBufferCache = new Map<string, AudioBuffer>()

const shouldInitAudioEngine = (settings: AudioEffectsSettings) => (
  settings.audioVisualizationEnabled
  || settings.eqEnabled
  || settings.reverbEnabled
  || settings.spatialAudioEnabled
)

const disconnectNode = (node: AudioNode) => {
  try {
    node.disconnect()
  } catch {
    // Ignore reconnect cleanup errors from partially connected nodes.
  }
}

const createImpulseBuffer = (context: AudioContext, preset: ReverbPreset) => {
  const cacheKey = `${preset.id}:${context.sampleRate}`
  const cached = reverbBufferCache.get(cacheKey)
  if (cached) return cached

  const length = Math.max(1, Math.floor(context.sampleRate * preset.seconds))
  const impulse = context.createBuffer(2, length, context.sampleRate)

  for (let channelIndex = 0; channelIndex < impulse.numberOfChannels; channelIndex += 1) {
    const channel = impulse.getChannelData(channelIndex)
    for (let index = 0; index < length; index += 1) {
      const impulseIndex = preset.reverse ? length - index : index
      const decay = Math.pow(1 - impulseIndex / length, preset.decay)
      channel[index] = (Math.random() * 2 - 1) * decay
    }
  }

  reverbBufferCache.set(cacheKey, impulse)
  return impulse
}

const clearPannerAnimation = () => {
  if (pannerTimer != null) {
    window.clearInterval(pannerTimer)
    pannerTimer = null
  }
}

const updatePannerPosition = (radius: number) => {
  if (!engineNodes) return
  const normalizedRadius = Math.max(0, Math.min(radius / 100, 1))
  const x = Math.sin(pannerAngle) * normalizedRadius
  const z = Math.cos(pannerAngle) * normalizedRadius
  engineNodes.panner.positionX.value = x
  engineNodes.panner.positionY.value = 0
  engineNodes.panner.positionZ.value = z
}

const startPannerAnimation = (radius: number, speed: number) => {
  if (!engineNodes) return
  clearPannerAnimation()
  const interval = Math.max(16, 150 - speed)
  updatePannerPosition(radius)
  pannerTimer = window.setInterval(() => {
    pannerAngle += Math.max(0.025, speed / 1600)
    if (pannerAngle >= Math.PI * 2) pannerAngle -= Math.PI * 2
    updatePannerPosition(radius)
  }, interval)
}

const stopPannerAnimation = () => {
  clearPannerAnimation()
  if (!engineNodes) return
  engineNodes.panner.positionX.value = 0
  engineNodes.panner.positionY.value = 0
  engineNodes.panner.positionZ.value = 0
}

const cleanupPassiveAnalyser = () => {
  if (!passiveAnalyserNodes) return

  try {
    passiveAnalyserNodes.sink.disconnect()
    passiveAnalyserNodes.analyser.disconnect()
    passiveAnalyserNodes.source.disconnect()
  } catch {
    // ignore passive analyser cleanup errors
  }

  void passiveAnalyserNodes.context.close().catch(() => {})
  passiveAnalyserNodes = null
  passiveAnalyserElement = null
}

const detachPassiveAnalyserListeners = () => {
  if (!passiveAnalyserListeners) return

  passiveAnalyserListeners.audio.removeEventListener('play', passiveAnalyserListeners.ensureWhenPlaying)
  passiveAnalyserListeners.audio.removeEventListener('playing', passiveAnalyserListeners.ensureWhenPlaying)
  passiveAnalyserListeners.audio.removeEventListener('emptied', passiveAnalyserListeners.cleanupWhenEmptied)
  passiveAnalyserListeners = null
}

const ensurePassiveAnalyser = (audio: HTMLAudioElement) => {
  if (passiveAnalyserNodes && passiveAnalyserElement === audio && passiveAnalyserNodes.hasLiveAudio()) {
    return passiveAnalyserNodes
  }

  cleanupPassiveAnalyser()

  const streamSourceAudio = audio as HTMLAudioElement & {
    captureStream?: () => MediaStream
    mozCaptureStream?: () => MediaStream
  }

  const captureStream = streamSourceAudio.captureStream || streamSourceAudio.mozCaptureStream
  if (typeof captureStream !== 'function') return null

  try {
    const stream = captureStream.call(streamSourceAudio)
    const hasLiveAudio = () => (
      stream.active
      && stream.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled)
    )

    if (!hasLiveAudio()) {
      return null
    }

    const context = new AudioContext({ latencyHint: 'interactive' })
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.84

    const sink = context.createGain()
    sink.gain.value = 0

    source.connect(analyser)
    analyser.connect(sink)
    sink.connect(context.destination)

    passiveAnalyserNodes = {
      context,
      stream,
      source,
      analyser,
      sink,
      hasLiveAudio,
    }
    passiveAnalyserElement = audio
    return passiveAnalyserNodes
  } catch (error) {
    console.debug('[AudioEffects] Passive analyser init failed:', error)
    cleanupPassiveAnalyser()
    return null
  }
}

const rebuildAudioRouting = (settings: AudioEffectsSettings) => {
  if (!engineNodes) return

  const { source, analyser, filters, panner, dryGain, wetInputGain, wetOutputGain, convolver, masterGain, context } = engineNodes

  disconnectNode(source)
  disconnectNode(analyser)
  filters.forEach(disconnectNode)
  disconnectNode(panner)
  disconnectNode(dryGain)
  disconnectNode(wetInputGain)
  disconnectNode(wetOutputGain)
  disconnectNode(convolver)
  disconnectNode(masterGain)

  source.connect(analyser)

  let outputTail: AudioNode = source
  if (settings.eqEnabled) {
    const firstFilter = filters.get(EQ_FREQUENCIES[0])
    const lastFilter = filters.get(EQ_FREQUENCIES[EQ_FREQUENCIES.length - 1])
    if (firstFilter && lastFilter) {
      outputTail.connect(firstFilter)
      for (let index = 1; index < EQ_FREQUENCIES.length; index += 1) {
        filters.get(EQ_FREQUENCIES[index - 1])!.connect(filters.get(EQ_FREQUENCIES[index])!)
      }
      outputTail = lastFilter
    }
  }

  if (settings.reverbEnabled) {
    outputTail.connect(dryGain)
    outputTail.connect(wetInputGain)
    wetInputGain.connect(convolver)
    convolver.connect(wetOutputGain)

    if (settings.spatialAudioEnabled) {
      dryGain.connect(panner)
      wetOutputGain.connect(panner)
      panner.connect(masterGain)
    } else {
      dryGain.connect(masterGain)
      wetOutputGain.connect(masterGain)
    }
  } else if (settings.spatialAudioEnabled) {
    outputTail.connect(panner)
    panner.connect(masterGain)
  } else {
    outputTail.connect(masterGain)
  }

  masterGain.connect(context.destination)
}

const ensureEngine = (audio: HTMLAudioElement) => {
  if (engineNodes) {
    currentAudioElement = audio
    return engineNodes
  }

  const context = new AudioContext({ latencyHint: 'playback' })
  const source = context.createMediaElementSource(audio)
  const analyser = context.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.82

  const filters = new Map<EqFrequency, BiquadFilterNode>()
  EQ_FREQUENCIES.forEach((frequency) => {
    const filter = context.createBiquadFilter()
    filter.type = 'peaking'
    filter.frequency.value = frequency
    filter.Q.value = 1.4
    filter.gain.value = 0
    filters.set(frequency, filter)
  })

  const panner = context.createPanner()
  panner.panningModel = 'HRTF'
  panner.distanceModel = 'inverse'
  panner.refDistance = 1
  panner.maxDistance = 32
  panner.rolloffFactor = 0.4
  panner.coneInnerAngle = 360
  panner.coneOuterAngle = 0
  panner.positionY.value = 0
  panner.positionZ.value = 0

  const dryGain = context.createGain()
  const wetInputGain = context.createGain()
  const wetOutputGain = context.createGain()
  const convolver = context.createConvolver()
  const masterGain = context.createGain()

  dryGain.gain.value = 1
  wetInputGain.gain.value = 0
  wetOutputGain.gain.value = 0
  masterGain.gain.value = 1

  engineNodes = { context, source, analyser, filters, panner, dryGain, wetInputGain, wetOutputGain, convolver, masterGain }
  currentAudioElement = audio
  rebuildAudioRouting(DEFAULT_AUDIO_EFFECTS_SETTINGS)
  return engineNodes
}

export const attachAudioEffectsEngine = (audio: HTMLAudioElement) => {
  currentAudioElement = audio
  if (passiveAnalyserListeners?.audio === audio) {
    return engineNodes
  }

  detachPassiveAnalyserListeners()

  const ensurePassiveAnalyserWhenPlaying = () => {
    ensurePassiveAnalyser(audio)
    void resumeAudioEffectsEngine()
  }
  const cleanupPassiveAnalyserWhenEmptied = () => cleanupPassiveAnalyser()

  audio.addEventListener('play', ensurePassiveAnalyserWhenPlaying)
  audio.addEventListener('playing', ensurePassiveAnalyserWhenPlaying)
  audio.addEventListener('emptied', cleanupPassiveAnalyserWhenEmptied)
  passiveAnalyserListeners = {
    audio,
    ensureWhenPlaying: ensurePassiveAnalyserWhenPlaying,
    cleanupWhenEmptied: cleanupPassiveAnalyserWhenEmptied,
  }
  return engineNodes
}

export const resumeAudioEffectsEngine = async() => {
  if (!passiveAnalyserNodes && currentAudioElement) {
    ensurePassiveAnalyser(currentAudioElement)
  }

  if (passiveAnalyserNodes && passiveAnalyserNodes.context.state !== 'running') {
    await passiveAnalyserNodes.context.resume().catch(() => {})
  }

  if (!engineNodes) return
  if (engineNodes.context.state !== 'running') {
    await engineNodes.context.resume().catch(() => {})
  }
}

export const setAudioEffectsOutputDevice = async(deviceId: string) => {
  if (!engineNodes) {
    return { supported: false, switched: false as const }
  }

  const context = engineNodes.context as AudioContext & {
    setSinkId?: (sinkId: string) => Promise<void>
  }

  if (typeof context.setSinkId !== 'function') {
    return { supported: false, switched: false as const }
  }

  const shouldResume = context.state === 'running'

  if (shouldResume) {
    await context.suspend().catch(() => {})
  }

  try {
    await context.setSinkId(deviceId)
  } finally {
    if (shouldResume) {
      await context.resume().catch(() => {})
    }
  }

  return { supported: true, switched: true as const }
}

export const getAudioAnalyser = () => {
  if (engineNodes?.analyser) return engineNodes.analyser
  if (!passiveAnalyserNodes && currentAudioElement) {
    ensurePassiveAnalyser(currentAudioElement)
  } else if (passiveAnalyserNodes && !passiveAnalyserNodes.hasLiveAudio() && currentAudioElement) {
    ensurePassiveAnalyser(currentAudioElement)
  }
  return passiveAnalyserNodes?.analyser || null
}

export const readAudioAnalyserData = (target: Uint8Array) => {
  const analyser = getAudioAnalyser()
  if (!analyser) {
    target.fill(0)
    return target
  }
  const temp = new Uint8Array(Math.max(target.length, analyser.frequencyBinCount))
  analyser.getByteFrequencyData(temp)
  target.set(temp.subarray(0, target.length))
  return target
}

export const applyAudioEffectsSettings = (settings: AudioEffectsSettings) => {
  if (!currentAudioElement) return

  currentAudioElement.playbackRate = settings.playbackRate
  currentAudioElement.defaultPlaybackRate = settings.playbackRate

  if (!engineNodes) {
    if (!shouldInitAudioEngine(settings)) return
    ensureEngine(currentAudioElement)
  }

  if (!engineNodes) return

  EQ_FREQUENCIES.forEach((frequency) => {
    const filter = engineNodes?.filters.get(frequency)
    if (!filter) return
    filter.gain.value = settings.eqEnabled ? settings.eqGains[frequency] : 0
  })

  if (settings.reverbEnabled) {
    const preset = REVERB_PRESETS.find((item) => item.id === settings.reverbPresetId) || REVERB_PRESETS[0]
    engineNodes.convolver.buffer = createImpulseBuffer(engineNodes.context, preset)
    engineNodes.dryGain.gain.value = Math.max(0, Math.min(settings.reverbMainGain / 100, 1.4))
    engineNodes.wetInputGain.gain.value = Math.max(0, Math.min(settings.reverbMainGain / 100, 1.4))
    engineNodes.wetOutputGain.gain.value = Math.max(0, Math.min(settings.reverbSendGain / 100, 1.4))
  } else {
    engineNodes.convolver.buffer = null
    engineNodes.dryGain.gain.value = 1
    engineNodes.wetInputGain.gain.value = 0
    engineNodes.wetOutputGain.gain.value = 0
  }

  if (settings.spatialAudioEnabled) {
    startPannerAnimation(settings.spatialAudioRadius, settings.spatialAudioSpeed)
  } else {
    stopPannerAnimation()
  }

  rebuildAudioRouting(settings)
}

export const cleanupAudioEffectsEngine = () => {
  clearPannerAnimation()
  detachPassiveAnalyserListeners()
  cleanupPassiveAnalyser()
  if (!engineNodes) return
  engineNodes.masterGain.disconnect()
  engineNodes.panner.disconnect()
  engineNodes.convolver.disconnect()
  engineNodes.wetInputGain.disconnect()
  engineNodes.wetOutputGain.disconnect()
  engineNodes.dryGain.disconnect()
  engineNodes.filters.forEach((filter) => filter.disconnect())
  engineNodes.analyser.disconnect()
  engineNodes.source.disconnect()
  engineNodes.context.close().catch(() => {})
  engineNodes = null
  currentAudioElement = null
}

// Build a short sine-wave WAV in memory.  Used for the device test button so the tone reliably
// follows the same setSinkId path our real playback uses, without needing any asset file.
function buildTestToneWavBlob(
  frequency = 440,
  durationSec = 0.6,
  sampleRate = 44100,
  volume = 0.25,
): Blob {
  const totalSamples = Math.max(1, Math.floor(sampleRate * durationSec))
  const bytesPerSample = 2
  const dataBytes = totalSamples * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  // RIFF / WAVE header
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // format = PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataBytes, true)

  // Fade in / out (~20ms each) to avoid click artifacts.
  const fadeSamples = Math.min(Math.floor(sampleRate * 0.02), Math.floor(totalSamples / 4))
  for (let i = 0; i < totalSamples; i += 1) {
    let env = 1
    if (i < fadeSamples) env = i / fadeSamples
    else if (i > totalSamples - fadeSamples) env = (totalSamples - i) / fadeSamples
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * volume * env
    view.setInt16(44 + i * bytesPerSample, Math.max(-1, Math.min(1, sample)) * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export type TestToneResult = {
  success: boolean
  reason?: 'no-sink-support' | 'device-not-found' | 'not-allowed' | 'playback-failed' | 'unknown'
  message?: string
}

// Play a short beep through the given audio output device.  Returns once playback completes or
// errors out so the caller can show a toast with the final result.  We deliberately use a fresh
// <audio> element (not the main player) so that triggering the test never interrupts the song
// the user is listening to.
export const playAudioOutputTestTone = async(deviceId: string): Promise<TestToneResult> => {
  const targetDevice = deviceId || 'default'
  const audio = document.createElement('audio') as HTMLAudioElement & {
    setSinkId?: (sinkId: string) => Promise<void>
  }
  audio.preload = 'auto'
  audio.volume = 0.6

  const blob = buildTestToneWavBlob()
  const objectUrl = URL.createObjectURL(blob)
  audio.src = objectUrl

  const cleanup = () => {
    try {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    } catch {
      // ignore
    }
    URL.revokeObjectURL(objectUrl)
  }

  try {
    if (targetDevice !== 'default') {
      if (typeof audio.setSinkId !== 'function') {
        cleanup()
        return { success: false, reason: 'no-sink-support', message: '当前环境不支持切换音频输出设备' }
      }
      try {
        await audio.setSinkId(targetDevice)
      } catch (error) {
        cleanup()
        const domError = error as DOMException | undefined
        if (domError?.name === 'NotFoundError') {
          return { success: false, reason: 'device-not-found', message: '所选音频设备已不可用' }
        }
        if (domError?.name === 'SecurityError' || domError?.name === 'NotAllowedError') {
          return { success: false, reason: 'not-allowed', message: '当前系统或浏览器未允许切换音频设备' }
        }
        return { success: false, reason: 'unknown', message: domError?.message || '设备切换失败' }
      }
    }

    await new Promise<void>((resolve, reject) => {
      const onEnded = () => {
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        resolve()
      }
      const onError = () => {
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        reject(new Error('播放测试音失败'))
      }
      audio.addEventListener('ended', onEnded)
      audio.addEventListener('error', onError)
      audio.play().catch(reject)
    })

    cleanup()
    return { success: true }
  } catch (error) {
    cleanup()
    const message = error instanceof Error ? error.message : '播放测试音失败'
    return { success: false, reason: 'playback-failed', message }
  }
}
