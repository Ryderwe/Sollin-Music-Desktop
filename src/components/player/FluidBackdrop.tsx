import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildCoverBackdropTheme, type CoverPalette, useCoverBackdrop } from '@/hooks/useCoverBackdrop'
import { cn } from '@/utils/cn'

type FluidBackdropProps = {
  cover?: string | null
  animated?: boolean
  className?: string
}

type BlobConfig = {
  color: { r: number; g: number; b: number }
  anchorX: number
  anchorY: number
  swingX: number
  swingY: number
  radius: number
  speed: number
  phase: number
  pulse: number
  alpha: number
}

const DEFAULT_PALETTE: CoverPalette = {
  primary: { r: 58, g: 91, b: 180 },
  secondary: { r: 18, g: 36, b: 82 },
  accent: { r: 230, g: 66, b: 114 },
  average: { r: 28, g: 40, b: 76 },
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const mixColor = (
  source: { r: number; g: number; b: number },
  target: { r: number; g: number; b: number },
  ratio: number,
) => ({
  r: source.r * (1 - ratio) + target.r * ratio,
  g: source.g * (1 - ratio) + target.g * ratio,
  b: source.b * (1 - ratio) + target.b * ratio,
})

const luminance = (color: { r: number; g: number; b: number }) => (
  (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255
)

const tuneGlowColor = (color: { r: number; g: number; b: number }) => {
  const darkAnchor = { r: 10, g: 14, b: 22 }
  const lightness = luminance(color)
  const darkenRatio = clamp((lightness - 0.34) * 1.65, 0.1, 0.58)
  return mixColor(color, darkAnchor, darkenRatio)
}

const rgba = (color: { r: number; g: number; b: number }, alpha: number) => (
  `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`
)

const clonePalette = (palette: CoverPalette): CoverPalette => ({
  primary: { ...palette.primary },
  secondary: { ...palette.secondary },
  accent: { ...palette.accent },
  average: { ...palette.average },
})

const mixPalette = (from: CoverPalette, to: CoverPalette, ratio: number): CoverPalette => ({
  primary: mixColor(from.primary, to.primary, ratio),
  secondary: mixColor(from.secondary, to.secondary, ratio),
  accent: mixColor(from.accent, to.accent, ratio),
  average: mixColor(from.average, to.average, ratio),
})

const easeInOutCubic = (value: number) => (
  value < 0.5
    ? 4 * value * value * value
    : 1 - ((-2 * value + 2) ** 3) / 2
)

const drawSoftEllipse = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
  color: { r: number; g: number; b: number },
  alpha: number,
) => {
  if (alpha <= 0) return

  context.save()
  context.translate(x, y)
  context.rotate(rotation)
  context.scale(Math.max(1, radiusX), Math.max(1, radiusY))

  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1)
  gradient.addColorStop(0, rgba(color, alpha))
  gradient.addColorStop(0.42, rgba(color, alpha * 0.52))
  gradient.addColorStop(0.72, rgba(color, alpha * 0.16))
  gradient.addColorStop(1, rgba(color, 0))

  context.fillStyle = gradient
  context.beginPath()
  context.arc(0, 0, 1, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

const palettesEqual = (left: CoverPalette, right: CoverPalette) => (
  left.primary.r === right.primary.r
  && left.primary.g === right.primary.g
  && left.primary.b === right.primary.b
  && left.secondary.r === right.secondary.r
  && left.secondary.g === right.secondary.g
  && left.secondary.b === right.secondary.b
  && left.accent.r === right.accent.r
  && left.accent.g === right.accent.g
  && left.accent.b === right.accent.b
  && left.average.r === right.average.r
  && left.average.g === right.average.g
  && left.average.b === right.average.b
)

const createBlobConfigs = (palette: CoverPalette): BlobConfig[] => {
  const primaryGlow = tuneGlowColor(mixColor(palette.primary, palette.average, 0.18))
  const secondaryGlow = tuneGlowColor(mixColor(palette.secondary, palette.average, 0.16))
  const accentGlow = tuneGlowColor(mixColor(palette.accent, palette.primary, 0.22))
  const bridgeGlow = tuneGlowColor(mixColor(palette.average, palette.accent, 0.36))

  return [
    {
      color: primaryGlow,
      anchorX: 0.18,
      anchorY: 0.2,
      swingX: 0.18,
      swingY: 0.15,
      radius: 0.5,
      speed: 0.96,
      phase: 0.2,
      pulse: 0.6,
      alpha: 0.46,
    },
    {
      color: accentGlow,
      anchorX: 0.76,
      anchorY: 0.24,
      swingX: 0.19,
      swingY: 0.16,
      radius: 0.44,
      speed: 1.14,
      phase: 1.5,
      pulse: 0.52,
      alpha: 0.42,
    },
    {
      color: secondaryGlow,
      anchorX: 0.68,
      anchorY: 0.8,
      swingX: 0.22,
      swingY: 0.12,
      radius: 0.56,
      speed: 0.84,
      phase: 2.7,
      pulse: 0.64,
      alpha: 0.4,
    },
    {
      color: bridgeGlow,
      anchorX: 0.28,
      anchorY: 0.72,
      swingX: 0.16,
      swingY: 0.17,
      radius: 0.38,
      speed: 1.22,
      phase: 3.9,
      pulse: 0.5,
      alpha: 0.38,
    },
  ]
}

export default memo(function FluidBackdrop({
  cover,
  animated = true,
  className,
}: FluidBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backdrop = useCoverBackdrop(cover)
  const targetPalette = useMemo(() => clonePalette(backdrop.palette ?? DEFAULT_PALETTE), [backdrop.palette])
  const [palette, setPalette] = useState<CoverPalette>(() => clonePalette(targetPalette))
  const previousPaletteRef = useRef<CoverPalette>(clonePalette(targetPalette))
  const theme = useMemo(() => buildCoverBackdropTheme(palette, true, 'lyrics'), [palette])
  const blobConfigs = useMemo(() => createBlobConfigs(palette), [palette])
  const paletteRef = useRef(palette)
  const blobConfigsRef = useRef(blobConfigs)
  const prefersReducedMotionRef = useRef(false)
  const textureSrc = backdrop.textureSrc || cover?.trim() || null
  const textureOpacity = clamp(theme.textureOpacity * 0.64, 0.12, 0.18)
  const [prefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    paletteRef.current = palette
  }, [palette])

  useEffect(() => {
    blobConfigsRef.current = blobConfigs
  }, [blobConfigs])

  useLayoutEffect(() => {
    prefersReducedMotionRef.current = prefersReducedMotion
  }, [prefersReducedMotion])

  useEffect(() => {
    const fromPalette = clonePalette(previousPaletteRef.current)
    const toPalette = clonePalette(targetPalette)
    if (palettesEqual(fromPalette, toPalette)) {
      previousPaletteRef.current = clonePalette(toPalette)
      setPalette(clonePalette(toPalette))
      return
    }

    let frameId = 0
    let startTime = 0
    const duration = prefersReducedMotion ? 240 : 760

    const tick = (timestamp: number) => {
      if (!startTime) startTime = timestamp
      const progress = clamp((timestamp - startTime) / duration, 0, 1)
      const easedProgress = easeInOutCubic(progress)
      const nextPalette = mixPalette(fromPalette, toPalette, easedProgress)
      setPalette(nextPalette)

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick)
        return
      }

      previousPaletteRef.current = clonePalette(toPalette)
      setPalette(clonePalette(toPalette))
    }

    frameId = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [prefersReducedMotion, targetPalette])

  useEffect(() => {
    if (!animated) return

    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    let frameId = 0
    let timerId = 0
    let lastFrameTime = 0
    let fluidPhase = 0
    let ambientPulse = 0.58

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.35)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const render = (time: number) => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight

      if (width === 0 || height === 0) {
        frameId = window.requestAnimationFrame(render)
        return
      }

      const targetFrameMs = prefersReducedMotionRef.current ? 96 : 40
      const frameDeltaMs = lastFrameTime > 0 ? Math.min(64, Math.max(8, time - lastFrameTime)) : 16
      lastFrameTime = time

      const reducedMotion = prefersReducedMotionRef.current
      const activePalette = paletteRef.current
      const activeBlobConfigs = blobConfigsRef.current
      const minEdge = Math.min(width, height)
      const sweepPhase = time * 0.00032
      const phaseVelocity = reducedMotion ? 0.00018 : 0.00052
      fluidPhase += frameDeltaMs * phaseVelocity
      if (fluidPhase > Math.PI * 2000) {
        fluidPhase -= Math.PI * 1000
      }

      const ambientTarget = 0.56
        + Math.sin(time * 0.00072) * 0.15
        + Math.sin(time * 0.00023 + 1.7) * 0.09
      ambientPulse += (ambientTarget - ambientPulse) * 0.02

      const motionScale = reducedMotion ? 0.58 : 1.24

      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = 'source-over'

      const sweep = context.createLinearGradient(
        width * (0.03 + Math.sin(sweepPhase) * 0.12),
        0,
        width * (0.97 + Math.cos(sweepPhase * 0.78) * 0.09),
        height,
      )
      sweep.addColorStop(0, 'rgba(255,255,255,0)')
      sweep.addColorStop(0.3, rgba(tuneGlowColor(mixColor(activePalette.primary, activePalette.accent, 0.34)), 0.054 + ambientPulse * 0.032))
      sweep.addColorStop(0.52, rgba(tuneGlowColor(mixColor(activePalette.accent, activePalette.secondary, 0.26)), 0.084 + ambientPulse * 0.038))
      sweep.addColorStop(0.72, rgba(tuneGlowColor(mixColor(activePalette.secondary, activePalette.primary, 0.36)), 0.052 + ambientPulse * 0.028))
      sweep.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = sweep
      context.fillRect(0, 0, width, height)

      context.save()
      context.globalCompositeOperation = 'screen'
      activeBlobConfigs.forEach((blob, index) => {
        const orbitTime = fluidPhase * blob.speed + blob.phase
        const driftX = Math.sin(orbitTime) * blob.swingX * motionScale
        const driftY = Math.cos(orbitTime * 1.12) * blob.swingY * motionScale
        const secondaryDriftX = Math.cos(orbitTime * 0.68 + index) * 0.078 * motionScale * (0.78 + ambientPulse * 0.45)
        const secondaryDriftY = Math.sin(orbitTime * 0.92 + index * 1.7) * 0.072 * motionScale * (0.78 + ambientPulse * 0.4)
        const pulseWave = Math.sin(time * 0.00102 + blob.phase * 1.5 + index * 0.72)
        const breathing = 1
          + pulseWave * (reducedMotion ? 0.022 : 0.062)
          + Math.cos(time * 0.00046 + index) * 0.03
          + Math.sin(time * 0.00031 + blob.phase * 0.7) * blob.pulse * 0.02
        const x = width * clamp(blob.anchorX + driftX + secondaryDriftX, 0.05, 0.95)
        const y = height * clamp(blob.anchorY + driftY + secondaryDriftY, 0.05, 0.95)
        const radius = minEdge * blob.radius * (0.6 + ambientPulse * 0.48) * breathing
        const coreColor = blob.color

        const flowAngle = orbitTime * 0.18 + index * 0.74 + Math.sin(time * 0.00018 + index) * 0.18
        const stretch = radius * (1.24 + blob.pulse * 0.42)
        const thickness = radius * (0.58 + blob.pulse * 0.08)
        const offset = radius * (0.18 + blob.pulse * 0.06)
        const offsetX = Math.cos(flowAngle) * offset
        const offsetY = Math.sin(flowAngle) * offset

        drawSoftEllipse(
          context,
          x + offsetX,
          y + offsetY,
          stretch,
          thickness,
          flowAngle,
          coreColor,
          clamp(blob.alpha * 0.56 + ambientPulse * 0.08 + pulseWave * 0.025, 0, 0.62),
        )
        drawSoftEllipse(
          context,
          x - offsetX * 0.42,
          y - offsetY * 0.42,
          stretch * 0.72,
          thickness * 0.86,
          flowAngle + 0.18,
          coreColor,
          clamp(blob.alpha * 0.28 + ambientPulse * 0.04, 0, 0.38),
        )
        drawSoftEllipse(
          context,
          x,
          y,
          radius * 0.44,
          radius * 0.3,
          flowAngle * 0.55,
          tuneGlowColor(mixColor(coreColor, activePalette.accent, 0.18)),
          clamp(0.045 + ambientPulse * 0.028, 0, 0.11),
        )
      })
      context.restore()

      context.globalCompositeOperation = 'source-over'

      const ambientAnchorX = width * (0.22 + Math.sin(time * 0.00024) * 0.1)
      const ambientAnchorY = height * (0.76 + Math.cos(time * 0.00027) * 0.08)
      const ambientGlow = context.createRadialGradient(
        ambientAnchorX,
        ambientAnchorY,
        0,
        ambientAnchorX,
        ambientAnchorY,
        minEdge * 0.82,
      )
      ambientGlow.addColorStop(0, rgba(tuneGlowColor(mixColor(activePalette.accent, activePalette.primary, 0.24)), 0.08 + ambientPulse * 0.03))
      ambientGlow.addColorStop(0.55, 'rgba(255,255,255,0)')
      ambientGlow.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = ambientGlow
      context.fillRect(0, 0, width, height)

      context.globalCompositeOperation = 'source-over'
      const vignette = context.createRadialGradient(
        width * 0.5,
        height * 0.48,
        minEdge * 0.12,
        width * 0.5,
        height * 0.48,
        minEdge * 0.88,
      )
      vignette.addColorStop(0, 'rgba(5, 8, 12, 0)')
      vignette.addColorStop(1, 'rgba(5, 8, 12, 0.22)')
      context.fillStyle = vignette
      context.fillRect(0, 0, width, height)

      timerId = window.setTimeout(() => {
        frameId = window.requestAnimationFrame(render)
      }, targetFrameMs)
    }

    resize()
    frameId = window.requestAnimationFrame(render)
    window.addEventListener('resize', resize)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timerId)
      window.removeEventListener('resize', resize)
    }
  }, [animated])

  return (
    <div
      className={cn('absolute inset-0 z-0 overflow-hidden pointer-events-none', className)}
      style={{ isolation: 'isolate' }}
    >
      <style>{`
        @keyframes fluid-backdrop-texture-drift {
          0% { transform: translate(calc(-50% - 12px), calc(-50% + 8px)) scale(1.238); }
          50% { transform: translate(calc(-50% + 14px), calc(-50% - 10px)) scale(1.25); }
          100% { transform: translate(calc(-50% - 12px), calc(-50% + 8px)) scale(1.238); }
        }
        .fluid-backdrop-texture {
          animation: ${animated ? 'fluid-backdrop-texture-drift 28s ease-in-out infinite' : 'none'};
        }
        @media (prefers-reduced-motion: reduce) {
          .fluid-backdrop-texture {
            animation: none;
          }
        }
      `}</style>
      <div
        className="absolute inset-0 transition-[background] duration-700 ease-in-out"
        style={{ background: theme.baseColor }}
      />
      {textureSrc ? (
        <img
          src={textureSrc}
          alt=""
          loading="lazy"
          decoding="async"
          className="fluid-backdrop-texture absolute top-1/2 left-1/2 min-w-[185%] min-h-[185%] object-cover transition-opacity duration-700 ease-in-out"
          style={{
            filter: 'blur(66px) saturate(1.08)',
            opacity: textureOpacity,
            transform: animated ? undefined : 'translate(-50%, -50%) scale(1.24)',
            willChange: animated ? 'transform' : 'auto',
            contain: 'strict',
          }}
        />
      ) : null}
      <div
        className="absolute inset-0 transition-[background] duration-700 ease-in-out"
        style={{ background: theme.gradientBackground, opacity: 0.62 }}
      />
      <div
        className="absolute inset-0 transition-[background] duration-700 ease-in-out"
        style={{ background: theme.accentBackground, opacity: 0.1 }}
      />
      <canvas
        ref={canvasRef}
        className={cn('absolute inset-0 h-full w-full opacity-100', !animated && 'hidden')}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_38%,rgba(2,6,10,0.1)_100%)]" />
      <div className="absolute inset-0" style={{ background: theme.veilBackground }} />
    </div>
  )
})
