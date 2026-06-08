import { useEffect, useState } from 'react'
import type { BackgroundSettings } from '@/stores/uiStore'

type RgbColor = {
  r: number
  g: number
  b: number
}

type QuantizedBucket = {
  totalR: number
  totalG: number
  totalB: number
  totalSaturation: number
  totalLightness: number
  weight: number
  pixels: number
}

type PaletteCandidate = {
  color: RgbColor
  saturation: number
  lightness: number
  score: number
}

export type CoverPalette = {
  primary: RgbColor
  secondary: RgbColor
  accent: RgbColor
  average: RgbColor
}

export type CoverBackdropState = {
  palette: CoverPalette | null
  textureSrc: string | null
}

export type CoverBackdropTheme = {
  baseColor: string
  gradientBackground: string
  accentBackground: string
  veilBackground: string
  textureOpacity: number
}

const DEFAULT_DARK_BASE = 'rgb(28, 28, 30)'
const DEFAULT_LIGHT_BASE = 'rgb(255, 255, 255)'

const backdropCache = new Map<string, Promise<CoverBackdropState>>()
const BACKDROP_CACHE_MAX_SIZE = 50

const evictOldestCacheEntries = () => {
  if (backdropCache.size <= BACKDROP_CACHE_MAX_SIZE) return
  const keysToDelete = Array.from(backdropCache.keys()).slice(0, backdropCache.size - BACKDROP_CACHE_MAX_SIZE)
  for (const key of keysToDelete) {
    backdropCache.delete(key)
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const roundChannel = (value: number) => Math.round(clamp(value, 0, 255))

const rgbToCss = (color: RgbColor) => `rgb(${roundChannel(color.r)}, ${roundChannel(color.g)}, ${roundChannel(color.b)})`

const rgba = (color: RgbColor, alpha: number) => `rgba(${roundChannel(color.r)}, ${roundChannel(color.g)}, ${roundChannel(color.b)}, ${alpha})`

const mixRgb = (source: RgbColor, target: RgbColor, ratio: number): RgbColor => {
  const mixRatio = clamp(ratio, 0, 1)
  return {
    r: source.r * (1 - mixRatio) + target.r * mixRatio,
    g: source.g * (1 - mixRatio) + target.g * mixRatio,
    b: source.b * (1 - mixRatio) + target.b * mixRatio,
  }
}

const rgbDistance = (left: RgbColor, right: RgbColor) => (
  Math.sqrt(
    ((left.r - right.r) ** 2)
    + ((left.g - right.g) ** 2)
    + ((left.b - right.b) ** 2),
  )
)

const rgbToHsl = (color: RgbColor) => {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const delta = max - min

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness }
  }

  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min)

  let hue = 0
  switch (max) {
    case r:
      hue = ((g - b) / delta) + (g < b ? 6 : 0)
      break
    case g:
      hue = ((b - r) / delta) + 2
      break
    default:
      hue = ((r - g) / delta) + 4
      break
  }

  return {
    h: hue / 6,
    s: saturation,
    l: lightness,
  }
}

const hueToRgb = (p: number, q: number, t: number) => {
  let nextT = t
  if (nextT < 0) nextT += 1
  if (nextT > 1) nextT -= 1
  if (nextT < 1 / 6) return p + (q - p) * 6 * nextT
  if (nextT < 1 / 2) return q
  if (nextT < 2 / 3) return p + (q - p) * (2 / 3 - nextT) * 6
  return p
}

const hslToRgb = (h: number, s: number, l: number): RgbColor => {
  if (s === 0) {
    const gray = l * 255
    return { r: gray, g: gray, b: gray }
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  return {
    r: hueToRgb(p, q, h + 1 / 3) * 255,
    g: hueToRgb(p, q, h) * 255,
    b: hueToRgb(p, q, h - 1 / 3) * 255,
  }
}

const tuneColor = (
  source: RgbColor,
  target: RgbColor,
  mixRatio: number,
  saturationDelta: number,
  minLightness: number,
  maxLightness: number,
): RgbColor => {
  const mixed = mixRgb(source, target, mixRatio)
  const { h, s, l } = rgbToHsl(mixed)
  return hslToRgb(
    h,
    clamp(s + saturationDelta, 0.12, 0.82),
    clamp(l, minLightness, maxLightness),
  )
}

const hexToRgb = (hex: string): RgbColor => {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

const luminance = (c: RgbColor) => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255

const FG_DARK = { fgPrimary: 'rgba(255,255,255,0.95)', fgSecondary: 'rgba(255,255,255,0.80)', fgMuted: 'rgba(255,255,255,0.60)' }
const FG_LIGHT = { fgPrimary: 'rgba(0,0,0,0.90)', fgSecondary: 'rgba(0,0,0,0.75)', fgMuted: 'rgba(0,0,0,0.55)' }

const fgFromBase = (base: RgbColor, isDark: boolean) => {
  if (isDark) {
    return luminance(base) < 0.5 ? FG_DARK : FG_LIGHT
  }
  return luminance(base) > 0.5 ? FG_LIGHT : FG_DARK
}

const fgFromPalette = (palette: CoverPalette | null, isDark: boolean) => {
  if (!palette) {
    return isDark ? FG_DARK : FG_LIGHT
  }

  if (isDark) {
    const primary = tuneColor(palette.primary, { r: 255, g: 255, b: 255 }, 0.05, -0.04, 0.90, 0.97)
    const secondary = tuneColor(palette.primary, { r: 255, g: 255, b: 255 }, 0.08, -0.04, 0.78, 0.90)
    const muted = tuneColor(palette.primary, { r: 255, g: 255, b: 255 }, 0.12, -0.02, 0.55, 0.70)
    return {
      fgPrimary: rgba(primary, 0.95),
      fgSecondary: rgba(secondary, 0.80),
      fgMuted: rgba(muted, 0.60),
    }
  }

  const primary = tuneColor(palette.primary, { r: 0, g: 0, b: 0 }, 0.06, -0.02, 0.05, 0.14)
  const secondary = tuneColor(palette.primary, { r: 0, g: 0, b: 0 }, 0.10, -0.02, 0.15, 0.30)
  const muted = tuneColor(palette.primary, { r: 0, g: 0, b: 0 }, 0.14, -0.01, 0.30, 0.45)
  return {
    fgPrimary: rgba(primary, 0.90),
    fgSecondary: rgba(secondary, 0.75),
    fgMuted: rgba(muted, 0.55),
  }
}

const quantizeChannel = (channel: number) => roundChannel(Math.round(channel / 24) * 24)

const buildPaletteFromImage = (image: HTMLImageElement): CoverPalette | null => {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  const longestEdge = Math.max(image.naturalWidth || image.width || 1, image.naturalHeight || image.height || 1)
  const sampleScale = Math.max(1, longestEdge / 56)
  const width = Math.max(18, Math.round((image.naturalWidth || image.width || 1) / sampleScale))
  const height = Math.max(18, Math.round((image.naturalHeight || image.height || 1) / sampleScale))

  canvas.width = width
  canvas.height = height

  try {
    context.drawImage(image, 0, 0, width, height)
    const { data } = context.getImageData(0, 0, width, height)
    const buckets = new Map<string, QuantizedBucket>()
    let totalWeight = 0
    let totalR = 0
    let totalG = 0
    let totalB = 0

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255
      if (alpha < 0.22) continue

      const color = {
        r: data[index],
        g: data[index + 1],
        b: data[index + 2],
      }
      const { s, l } = rgbToHsl(color)
      if (l < 0.03 || l > 0.97) continue

      const chromaWeight = 0.38 + s * 0.92
      const exposureWeight = Math.max(0.18, 1 - Math.abs(l - 0.52) * 1.2)
      const weight = alpha * chromaWeight * exposureWeight
      if (weight <= 0) continue

      const bucketKey = `${quantizeChannel(color.r)}-${quantizeChannel(color.g)}-${quantizeChannel(color.b)}`
      const bucket = buckets.get(bucketKey) || {
        totalR: 0,
        totalG: 0,
        totalB: 0,
        totalSaturation: 0,
        totalLightness: 0,
        weight: 0,
        pixels: 0,
      }

      bucket.totalR += color.r * weight
      bucket.totalG += color.g * weight
      bucket.totalB += color.b * weight
      bucket.totalSaturation += s
      bucket.totalLightness += l
      bucket.weight += weight
      bucket.pixels += 1

      buckets.set(bucketKey, bucket)

      totalWeight += weight
      totalR += color.r * weight
      totalG += color.g * weight
      totalB += color.b * weight
    }

    if (totalWeight <= 0 || buckets.size === 0) return null

    const average = {
      r: totalR / totalWeight,
      g: totalG / totalWeight,
      b: totalB / totalWeight,
    }

    const candidates = Array.from(buckets.values())
      .map<PaletteCandidate>((bucket) => ({
        color: {
          r: bucket.totalR / bucket.weight,
          g: bucket.totalG / bucket.weight,
          b: bucket.totalB / bucket.weight,
        },
        saturation: bucket.totalSaturation / bucket.pixels,
        lightness: bucket.totalLightness / bucket.pixels,
        score: bucket.weight * (1 + Math.min(bucket.pixels, 12) * 0.08),
      }))
      .sort((left, right) => right.score - left.score)

    if (!candidates.length) return null

    const primaryCandidate = candidates.find((candidate) => (
      candidate.saturation >= 0.18
      && candidate.lightness >= 0.12
      && candidate.lightness <= 0.72
      && candidate.score >= candidates[0].score * 0.38
    )) || candidates.find((candidate) => (
      candidate.saturation >= 0.14
      && candidate.lightness >= 0.1
      && candidate.lightness <= 0.8
      && candidate.score >= candidates[0].score * 0.48
    )) || candidates[0]

    const primary = primaryCandidate.color
    const secondary = candidates.find((candidate) => rgbDistance(candidate.color, primary) > 58)?.color
      || mixRgb(primary, average, 0.42)
    const accent = candidates
      .filter((candidate) => candidate.saturation > 0.2)
      .find((candidate) => (
        rgbDistance(candidate.color, primary) > 90
        && rgbDistance(candidate.color, secondary) > 56
      ))?.color
      || candidates.find((candidate) => rgbDistance(candidate.color, primary) > 74)?.color
      || secondary

    return {
      primary,
      secondary,
      accent,
      average,
    }
  } catch {
    return null
  }
}

const loadImageElement = async(src: string) => {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    if (!/^(data:|blob:|file:)/i.test(src)) {
      image.crossOrigin = 'anonymous'
    }

    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Load image failed'))
    image.src = src
  })
}

const resolveTextureSource = async(src: string) => {
  if (!src) return ''
  if (/^(data:|blob:|file:)/i.test(src)) return src

  if (typeof window !== 'undefined' && window.electronAPI?.fetchImageAsDataUrl) {
    try {
      const proxied = await window.electronAPI.fetchImageAsDataUrl(src)
      if (proxied) return proxied
    } catch {
      // ignore and fallback to original src
    }
  }

  return src
}

const getBackdropState = (cover: string) => {
  const normalizedCover = cover.trim()
  const cached = backdropCache.get(normalizedCover)
  if (cached) return cached

  const task = (async(): Promise<CoverBackdropState> => {
    const analysisSrc = await resolveTextureSource(normalizedCover)
    if (!analysisSrc) {
      return {
        palette: null,
        textureSrc: normalizedCover || null,
      }
    }

    try {
      const image = await loadImageElement(analysisSrc)
      const palette = buildPaletteFromImage(image)
      return {
        palette,
        textureSrc: normalizedCover || null,
      }
    } catch {
      return {
        palette: null,
        textureSrc: normalizedCover || null,
      }
    }
  })()

  backdropCache.set(normalizedCover, task)
  evictOldestCacheEntries()
  return task
}

export const buildCoverBackdropTheme = (
  palette: CoverPalette | null,
  isDarkAppearance: boolean,
  variant: 'main' | 'lyrics',
): CoverBackdropTheme => {
  if (!palette) {
    return {
      baseColor: isDarkAppearance ? DEFAULT_DARK_BASE : DEFAULT_LIGHT_BASE,
      gradientBackground: isDarkAppearance
        ? 'linear-gradient(135deg, rgba(10,12,18,0.76) 0%, rgba(17,19,25,0.62) 45%, rgba(9,12,16,0.8) 100%)'
        : 'linear-gradient(135deg, rgba(255,255,255,0.86) 0%, rgba(255,250,252,0.78) 50%, rgba(248,250,252,0.84) 100%)',
      accentBackground: isDarkAppearance
        ? 'radial-gradient(circle at 16% 18%, rgba(250,45,72,0.18), transparent 28%), radial-gradient(circle at 84% 18%, rgba(56,189,248,0.12), transparent 24%), radial-gradient(circle at 78% 82%, rgba(16,185,129,0.08), transparent 30%)'
        : 'radial-gradient(circle at 16% 18%, rgba(250,45,72,0.12), transparent 26%), radial-gradient(circle at 84% 20%, rgba(59,130,246,0.1), transparent 24%), radial-gradient(circle at 78% 82%, rgba(251,191,36,0.12), transparent 28%)',
      veilBackground: variant === 'lyrics'
        ? (isDarkAppearance ? 'rgba(8, 10, 14, 0.18)' : 'rgba(255, 255, 255, 0.18)')
        : 'transparent',
      textureOpacity: isDarkAppearance
        ? (variant === 'lyrics' ? 0.34 : 0.2)
        : (variant === 'lyrics' ? 0.28 : 0.16),
    }
  }

  if (isDarkAppearance) {
    const base = tuneColor(palette.primary, { r: 5, g: 8, b: 12 }, 0.74, 0.08, 0.11, 0.26)
    const secondary = tuneColor(palette.secondary, { r: 7, g: 10, b: 16 }, 0.6, 0.08, 0.14, 0.34)
    const accent = tuneColor(palette.accent, { r: 8, g: 11, b: 18 }, 0.42, 0.12, 0.2, 0.46)
    const tertiary = tuneColor(mixRgb(palette.average, palette.accent, 0.45), { r: 6, g: 9, b: 13 }, 0.56, 0.08, 0.16, 0.38)

    return {
      baseColor: rgbToCss(base),
      gradientBackground: `linear-gradient(135deg, ${rgba(base, 0.98)} 0%, ${rgba(secondary, variant === 'lyrics' ? 0.94 : 0.92)} 46%, ${rgba(tertiary, 0.98)} 100%)`,
      accentBackground: `radial-gradient(circle at 18% 16%, ${rgba(accent, variant === 'lyrics' ? 0.34 : 0.24)}, transparent 31%), radial-gradient(circle at 84% 20%, ${rgba(secondary, variant === 'lyrics' ? 0.28 : 0.18)}, transparent 28%), radial-gradient(circle at 76% 82%, ${rgba(mixRgb(base, accent, 0.58), variant === 'lyrics' ? 0.3 : 0.2)}, transparent 34%)`,
      veilBackground: variant === 'lyrics'
        ? `linear-gradient(180deg, rgba(6, 8, 12, 0.08) 0%, rgba(6, 8, 12, 0.18) 100%)`
        : 'transparent',
      textureOpacity: variant === 'lyrics' ? 0.24 : 0.12,
    }
  }

  const base = tuneColor(palette.primary, { r: 255, g: 255, b: 255 }, 0.54, 0.08, 0.54, 0.78)
  const secondary = tuneColor(palette.secondary, { r: 255, g: 255, b: 255 }, 0.62, 0.06, 0.58, 0.84)
  const accent = tuneColor(palette.accent, { r: 255, g: 255, b: 255 }, 0.32, 0.14, 0.48, 0.76)
  const tertiary = tuneColor(mixRgb(palette.average, palette.accent, 0.44), { r: 255, g: 255, b: 255 }, 0.46, 0.08, 0.5, 0.8)

  return {
    baseColor: rgbToCss(base),
    gradientBackground: `linear-gradient(135deg, ${rgba(base, 0.99)} 0%, ${rgba(secondary, 0.96)} 46%, ${rgba(tertiary, 0.99)} 100%)`,
    accentBackground: `radial-gradient(circle at 16% 18%, ${rgba(accent, variant === 'lyrics' ? 0.34 : 0.24)}, transparent 30%), radial-gradient(circle at 84% 20%, ${rgba(secondary, variant === 'lyrics' ? 0.24 : 0.16)}, transparent 26%), radial-gradient(circle at 78% 82%, ${rgba(mixRgb(base, accent, 0.52), variant === 'lyrics' ? 0.22 : 0.14)}, transparent 32%)`,
    veilBackground: variant === 'lyrics'
      ? 'linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.12) 100%)'
      : 'transparent',
    textureOpacity: variant === 'lyrics' ? 0.2 : 0.12,
  }
}

export const useCoverBackdrop = (cover?: string | null): CoverBackdropState => {
  const normalizedCover = cover?.trim() || ''
  const [state, setState] = useState<CoverBackdropState>(() => ({
    palette: null,
    textureSrc: normalizedCover || null,
  }))

  useEffect(() => {
    let cancelled = false

    if (!normalizedCover) {
      setState({
        palette: null,
        textureSrc: null,
      })
      return () => {
        cancelled = true
      }
    }

    // Keep the previous palette while loading the new one to avoid flashing
    // to the default background color. Only update textureSrc immediately.
    setState((current) => ({
      palette: current.palette, // preserve previous palette during transition
      textureSrc: normalizedCover,
    }))

    void getBackdropState(normalizedCover).then((nextState) => {
      if (cancelled) return
      setState(nextState)
    }).catch(() => {
      if (cancelled) return
      setState((current) => ({
        palette: current.palette, // keep previous palette even on error
        textureSrc: normalizedCover,
      }))
    })

    return () => {
      cancelled = true
    }
  }, [normalizedCover])

  return state
}

export type ResolvedBackground = {
  textureSrc: string | null
  baseColor: string
  gradientBackground: string
  accentBackground: string
  veilBackground: string
  textureOpacity: number
  blurPrimary: number
  blurSecondary: number
  overlayColor: string
  overlayOpacity: number
  fgPrimary: string
  fgSecondary: string
  fgMuted: string
}

const resolveAlbumDefault = (
  coverBackdrop: CoverBackdropState,
  isDarkAppearance: boolean,
  variant: 'main' | 'lyrics',
  blurPrimary: number,
  blurSecondary: number,
  overlayColor: string,
  overlayOpacity: number,
): ResolvedBackground => {
  const theme = buildCoverBackdropTheme(coverBackdrop.palette, isDarkAppearance, variant)
  const fg = fgFromPalette(coverBackdrop.palette, isDarkAppearance)
  return {
    textureSrc: coverBackdrop.textureSrc,
    ...theme,
    blurPrimary,
    blurSecondary,
    overlayColor,
    overlayOpacity,
    ...fg,
  }
}

export const resolveBackgroundTheme = (
  settings: BackgroundSettings,
  coverBackdrop: CoverBackdropState,
  isDarkAppearance: boolean,
  variant: 'main' | 'lyrics',
): ResolvedBackground => {
  const blurPrimary = settings.blurIntensity
  const blurSecondary = Math.round(settings.blurIntensity * 0.66)
  const { overlayColor, overlayOpacity } = settings

  switch (settings.mode) {
    case 'solid': {
      const fg = fgFromBase(hexToRgb(settings.solidColor), isDarkAppearance)
      return {
        textureSrc: null,
        baseColor: settings.solidColor,
        gradientBackground: 'transparent',
        accentBackground: 'transparent',
        veilBackground: 'transparent',
        textureOpacity: 0,
        blurPrimary,
        blurSecondary,
        overlayColor,
        overlayOpacity,
        ...fg,
      }
    }

    case 'gradient': {
      const fg = fgFromBase(hexToRgb(settings.gradientColor1), isDarkAppearance)
      return {
        textureSrc: null,
        baseColor: settings.gradientColor1,
        gradientBackground: `linear-gradient(${settings.gradientAngle}deg, ${settings.gradientColor1}, ${settings.gradientColor2})`,
        accentBackground: 'transparent',
        veilBackground: 'transparent',
        textureOpacity: 0,
        blurPrimary,
        blurSecondary,
        overlayColor,
        overlayOpacity,
        ...fg,
      }
    }

    case 'image':
      if (!settings.customImagePath) {
        return resolveAlbumDefault(coverBackdrop, isDarkAppearance, variant, blurPrimary, blurSecondary, overlayColor, overlayOpacity)
      }
      {
        const fg = fgFromBase(isDarkAppearance ? { r: 28, g: 28, b: 30 } : { r: 255, g: 255, b: 255 }, isDarkAppearance)
        return {
          textureSrc: settings.customImagePath,
          baseColor: isDarkAppearance ? DEFAULT_DARK_BASE : DEFAULT_LIGHT_BASE,
          gradientBackground: 'transparent',
          accentBackground: 'transparent',
          veilBackground: 'transparent',
          textureOpacity: 1,
          blurPrimary,
          blurSecondary,
          overlayColor,
          overlayOpacity,
          ...fg,
        }
      }

    case 'album':
    default:
      return resolveAlbumDefault(coverBackdrop, isDarkAppearance, variant, blurPrimary, blurSecondary, overlayColor, overlayOpacity)
  }
}
