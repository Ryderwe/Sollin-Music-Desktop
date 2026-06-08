import { useEffect, useRef, memo } from 'react'
import { readAudioAnalyserData } from '@/utils/audioEffects'
import { usePlayerStore } from '@/stores/playerStore'

type AudioVisualizerProps = {
  className?: string
  barColor?: string
  glowColor?: string
  barCount?: number
}

export default memo(function AudioVisualizer({
  className,
  barColor = 'rgba(255,255,255,0.72)',
  glowColor = 'rgba(255,255,255,0.2)',
  barCount = 88,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isPlaying = usePlayerStore((s) => s.isPlaying)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    // Don't run the animation loop when not playing
    if (!isPlaying) {
      // Clear canvas when paused
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      context.clearRect(0, 0, width, height)
      return
    }

    let frameId = 0
    let analyserData = new Uint8Array(128)

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const render = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) {
        frameId = window.requestAnimationFrame(render)
        return
      }

      if (analyserData.length !== 128) {
        analyserData = new Uint8Array(128)
      }
      readAudioAnalyserData(analyserData)

      context.clearRect(0, 0, width, height)
      context.fillStyle = barColor
      // Removed expensive shadowBlur - use simple opacity for glow effect instead
      context.shadowColor = 'transparent'
      context.shadowBlur = 0

      const bars = Math.max(24, barCount)
      const step = Math.max(1, Math.floor(analyserData.length / bars))
      const gap = width < 520 ? 1.5 : 2
      const barWidth = Math.max(1.2, (width - gap * (bars - 1)) / bars)
      const centerIndex = (bars - 1) / 2

      for (let index = 0; index < bars; index += 1) {
        const sample = analyserData[Math.min(analyserData.length - 1, index * step)]
        const normalized = sample / 255
        const distanceFromCenter = Math.abs(index - centerIndex) / Math.max(centerIndex, 1)
        const centerWeight = 1 - Math.pow(distanceFromCenter, 1.35)
        const heightWeight = 0.22 + centerWeight * 1.28
        const alphaWeight = 0.16 + centerWeight * 0.84
        const eased = Math.pow(normalized, 0.82)
        const barHeight = Math.max(3, eased * height * 0.74 * heightWeight)
        const x = index * (barWidth + gap)
        const y = height - barHeight
        context.globalAlpha = alphaWeight
        context.fillRect(x, y, barWidth, barHeight)
      }

      context.globalAlpha = 1

      frameId = window.requestAnimationFrame(render)
    }

    resize()
    frameId = window.requestAnimationFrame(render)
    window.addEventListener('resize', resize)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
    }
  }, [barColor, glowColor, barCount, isPlaying])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
})
