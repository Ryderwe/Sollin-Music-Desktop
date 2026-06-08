import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check } from 'lucide-react'

interface ImageCropModalProps {
  isOpen: boolean
  onClose: () => void
  imageSrc: string
  aspectRatio: number
  onCrop: (dataUrl: string) => void
}

type CropRect = { x: number; y: number; w: number; h: number }
type DragMode = 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | null

const HANDLE_SIZE = 10
const MIN_CROP = 20

export default function ImageCropModal({ isOpen, onClose, imageSrc, aspectRatio, onCrop }: ImageCropModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [dragMode, setDragMode] = useState<DragMode>(null)
  const [cursor, setCursor] = useState('crosshair')
  const dragStart = useRef({ x: 0, y: 0, crop: null as CropRect | null })

  // Reset state when modal opens with a new image
  useEffect(() => {
    if (isOpen) {
      setCrop(null)
      setDragMode(null)
    }
  }, [isOpen, imageSrc])

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const naturalW = img.naturalWidth
    const naturalH = img.naturalHeight
    setImgSize({ w: naturalW, h: naturalH })

    // Calculate display size to fit in container
    const container = containerRef.current
    if (!container) return
    const maxW = container.clientWidth
    const maxH = container.clientHeight
    const scale = Math.min(maxW / naturalW, maxH / naturalH, 1)
    const dw = Math.round(naturalW * scale)
    const dh = Math.round(naturalH * scale)
    setDisplaySize({ w: dw, h: dh })

    // Default crop: largest centered rect with the given aspect ratio
    let cropW = dw
    let cropH = Math.round(cropW / aspectRatio)
    if (cropH > dh) {
      cropH = dh
      cropW = Math.round(cropH * aspectRatio)
    }
    setCrop({
      x: Math.round((dw - cropW) / 2),
      y: Math.round((dh - cropH) / 2),
      w: cropW,
      h: cropH,
    })
  }, [aspectRatio])

  const getMousePos = useCallback((e: React.MouseEvent) => {
    const img = imgRef.current
    if (!img) return { x: 0, y: 0 }
    const rect = img.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }, [])

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val))

  const getDragMode = useCallback((pos: { x: number; y: number }, c: CropRect): DragMode => {
    const { x, y } = pos
    const inX = x >= c.x && x <= c.x + c.w
    const inY = y >= c.y && y <= c.y + c.h
    if (!inX || !inY) return null

    const nearLeft = Math.abs(x - c.x) < HANDLE_SIZE
    const nearRight = Math.abs(x - (c.x + c.w)) < HANDLE_SIZE
    const nearTop = Math.abs(y - c.y) < HANDLE_SIZE
    const nearBottom = Math.abs(y - (c.y + c.h)) < HANDLE_SIZE

    if (nearTop && nearLeft) return 'nw'
    if (nearTop && nearRight) return 'ne'
    if (nearBottom && nearLeft) return 'sw'
    if (nearBottom && nearRight) return 'se'
    if (nearTop) return 'n'
    if (nearBottom) return 's'
    if (nearLeft) return 'w'
    if (nearRight) return 'e'
    return 'move'
  }, [])

  const cursorForMode = useCallback((mode: DragMode): string => {
    switch (mode) {
      case 'move': return 'move'
      case 'nw': case 'se': return 'nwse-resize'
      case 'ne': case 'sw': return 'nesw-resize'
      case 'n': case 's': return 'ns-resize'
      case 'e': case 'w': return 'ew-resize'
      case 'draw': return 'crosshair'
      default: return 'crosshair'
    }
  }, [])

  const updateCursor = useCallback((e: React.MouseEvent) => {
    if (dragMode) {
      setCursor(cursorForMode(dragMode))
      return
    }
    const pos = getMousePos(e)
    if (crop) {
      const mode = getDragMode(pos, crop)
      setCursor(mode ? cursorForMode(mode) : 'crosshair')
    } else {
      setCursor('crosshair')
    }
  }, [dragMode, crop, getMousePos, getDragMode, cursorForMode])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const pos = getMousePos(e)
    if (!crop) {
      // Start drawing a new crop
      setDragMode('draw')
      dragStart.current = { x: pos.x, y: pos.y, crop: { x: pos.x, y: pos.y, w: 0, h: 0 } }
      setCrop({ x: pos.x, y: pos.y, w: 0, h: 0 })
      return
    }
    const mode = getDragMode(pos, crop)
    if (mode) {
      setDragMode(mode)
      dragStart.current = { x: pos.x, y: pos.y, crop: { ...crop } }
    } else {
      // Click outside crop: start new draw
      setDragMode('draw')
      dragStart.current = { x: pos.x, y: pos.y, crop: { x: pos.x, y: pos.y, w: 0, h: 0 } }
      setCrop({ x: pos.x, y: pos.y, w: 0, h: 0 })
    }
  }, [crop, getMousePos, getDragMode])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    updateCursor(e)
    if (!dragMode || !dragStart.current.crop) return
    const pos = getMousePos(e)
    const dx = pos.x - dragStart.current.x
    const dy = pos.y - dragStart.current.y
    const orig = dragStart.current.crop
    const dw = displaySize.w
    const dh = displaySize.h

    let newCrop: CropRect

    switch (dragMode) {
      case 'draw': {
        const x1 = clamp(orig.x, 0, dw)
        const y1 = clamp(orig.y, 0, dh)
        const x2 = clamp(pos.x, 0, dw)
        const y2 = clamp(pos.y, 0, dh)
        const raw = {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          w: Math.abs(x2 - x1),
          h: Math.abs(y2 - y1),
        }
        // Use the dominant axis to determine size, then constrain
        const wFromH = Math.round(raw.h * aspectRatio)
        if (wFromH <= dw) {
          raw.w = wFromH
        } else {
          raw.h = Math.round(raw.w / aspectRatio)
        }
        newCrop = raw
        break
      }
      case 'move': {
        const nx = clamp(orig.x + dx, 0, dw - orig.w)
        const ny = clamp(orig.y + dy, 0, dh - orig.h)
        newCrop = { x: nx, y: ny, w: orig.w, h: orig.h }
        break
      }
      case 'nw': {
        const nx = clamp(orig.x + dx, 0, orig.x + orig.w - MIN_CROP)
        const w = orig.x + orig.w - nx
        const h = Math.round(w / aspectRatio)
        const ny = orig.y + orig.h - h
        newCrop = { x: nx, y: clamp(ny, 0, orig.y + orig.h - MIN_CROP), w, h: clamp(h, MIN_CROP, dh) }
        break
      }
      case 'ne': {
        const nw = clamp(orig.w + dx, MIN_CROP, dw - orig.x)
        const nh = Math.round(nw / aspectRatio)
        const ny = orig.y + orig.h - nh
        newCrop = { x: orig.x, y: clamp(ny, 0, orig.y + orig.h - MIN_CROP), w: nw, h: clamp(nh, MIN_CROP, dh) }
        break
      }
      case 'sw': {
        const nx = clamp(orig.x + dx, 0, orig.x + orig.w - MIN_CROP)
        const w = orig.x + orig.w - nx
        const h = Math.round(w / aspectRatio)
        newCrop = { x: nx, y: orig.y, w, h: clamp(h, MIN_CROP, dh - orig.y) }
        break
      }
      case 'se': {
        const nw = clamp(orig.w + dx, MIN_CROP, dw - orig.x)
        const nh = Math.round(nw / aspectRatio)
        newCrop = { x: orig.x, y: orig.y, w: nw, h: clamp(nh, MIN_CROP, dh - orig.y) }
        break
      }
      case 'n': {
        const ny = clamp(orig.y + dy, 0, orig.y + orig.h - MIN_CROP)
        const h = orig.y + orig.h - ny
        const w = Math.round(h * aspectRatio)
        newCrop = { x: clamp(orig.x + (orig.w - w) / 2, 0, dw - w), y: ny, w: clamp(w, MIN_CROP, dw), h }
        break
      }
      case 's': {
        const nh = clamp(orig.h + dy, MIN_CROP, dh - orig.y)
        const nw = Math.round(nh * aspectRatio)
        newCrop = { x: clamp(orig.x + (orig.w - nw) / 2, 0, dw - nw), y: orig.y, w: clamp(nw, MIN_CROP, dw), h: nh }
        break
      }
      case 'w': {
        const nx = clamp(orig.x + dx, 0, orig.x + orig.w - MIN_CROP)
        const w = orig.x + orig.w - nx
        const h = Math.round(w / aspectRatio)
        newCrop = { x: nx, y: clamp(orig.y + (orig.h - h) / 2, 0, dh - h), w, h: clamp(h, MIN_CROP, dh) }
        break
      }
      case 'e': {
        const nw = clamp(orig.w + dx, MIN_CROP, dw - orig.x)
        const nh = Math.round(nw / aspectRatio)
        newCrop = { x: orig.x, y: clamp(orig.y + (orig.h - nh) / 2, 0, dh - nh), w: nw, h: clamp(nh, MIN_CROP, dh) }
        break
      }
      default:
        return
    }
    setCrop(newCrop)
  }, [dragMode, displaySize, getMousePos, updateCursor, aspectRatio])

  const handleMouseUp = useCallback(() => {
    setDragMode(null)
    setCursor('crosshair')
  }, [])

  const handleConfirm = useCallback(() => {
    if (!crop || !imgRef.current) return
    const img = imgRef.current
    const scaleX = img.naturalWidth / displaySize.w
    const scaleY = img.naturalHeight / displaySize.h

    const canvas = document.createElement('canvas')
    const cropW = Math.round(crop.w * scaleX)
    const cropH = Math.round(crop.h * scaleY)
    // Cap output size to 1920px (background is heavily blurred, no need for full res)
    const maxDim = 1920
    const outScale = Math.min(1, maxDim / Math.max(cropW, cropH))
    canvas.width = Math.round(cropW * outScale)
    canvas.height = Math.round(cropH * outScale)

    const ctx = canvas.getContext('2d')!
    ctx.drawImage(
      img,
      Math.round(crop.x * scaleX),
      Math.round(crop.y * scaleY),
      cropW,
      cropH,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    onCrop(dataUrl)
  }, [crop, displaySize, onCrop])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="flex flex-col w-[80vw] max-w-[900px] h-[85vh] max-h-[700px] bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-sm">裁剪背景图片</h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Image area */}
            <div
              ref={containerRef}
              className="flex-1 overflow-hidden flex items-center justify-center bg-gray-100 dark:bg-gray-900 relative"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ cursor }}
            >
              <div className="relative" style={{ width: displaySize.w, height: displaySize.h }}>
                <img
                  ref={imgRef}
                  src={imageSrc}
                  alt=""
                  onLoad={handleImageLoad}
                  className="block w-full h-full object-contain select-none pointer-events-none"
                  draggable={false}
                />
                {/* Overlay + crop rect */}
                {crop && displaySize.w > 0 && (
                  <>
                    {/* Dark overlay using clip-path */}
                    <div
                      className="absolute inset-0 bg-black/50 pointer-events-none"
                      style={{
                        clipPath: `polygon(
                          0% 0%, 100% 0%, 100% 100%, 0% 100%,
                          0% 0%,
                          ${crop.x}px ${crop.y}px,
                          ${crop.x}px ${crop.y + crop.h}px,
                          ${crop.x + crop.w}px ${crop.y + crop.h}px,
                          ${crop.x + crop.w}px ${crop.y}px,
                          ${crop.x}px ${crop.y}px
                        )`,
                      }}
                    />
                    {/* Crop border */}
                    <div
                      className="absolute border-2 border-white pointer-events-none"
                      style={{
                        left: crop.x,
                        top: crop.y,
                        width: crop.w,
                        height: crop.h,
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
                      }}
                    />
                    {/* Rule of thirds lines */}
                    {crop.w > 60 && crop.h > 60 && (
                      <>
                        <div className="absolute pointer-events-none" style={{
                          left: crop.x + crop.w / 3, top: crop.y,
                          width: 1, height: crop.h,
                          borderLeft: '1px solid rgba(255,255,255,0.3)',
                        }} />
                        <div className="absolute pointer-events-none" style={{
                          left: crop.x + (crop.w * 2) / 3, top: crop.y,
                          width: 1, height: crop.h,
                          borderLeft: '1px solid rgba(255,255,255,0.3)',
                        }} />
                        <div className="absolute pointer-events-none" style={{
                          left: crop.x, top: crop.y + crop.h / 3,
                          width: crop.w, height: 1,
                          borderTop: '1px solid rgba(255,255,255,0.3)',
                        }} />
                        <div className="absolute pointer-events-none" style={{
                          left: crop.x, top: crop.y + (crop.h * 2) / 3,
                          width: crop.w, height: 1,
                          borderTop: '1px solid rgba(255,255,255,0.3)',
                        }} />
                      </>
                    )}
                    {/* Corner handles */}
                    {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
                      const positions: Record<string, { left: number; top: number }> = {
                        nw: { left: crop.x - HANDLE_SIZE / 2, top: crop.y - HANDLE_SIZE / 2 },
                        ne: { left: crop.x + crop.w - HANDLE_SIZE / 2, top: crop.y - HANDLE_SIZE / 2 },
                        sw: { left: crop.x - HANDLE_SIZE / 2, top: crop.y + crop.h - HANDLE_SIZE / 2 },
                        se: { left: crop.x + crop.w - HANDLE_SIZE / 2, top: crop.y + crop.h - HANDLE_SIZE / 2 },
                      }
                      return (
                        <div
                          key={corner}
                          className="absolute bg-white rounded-sm shadow pointer-events-none"
                          style={{
                            ...positions[corner],
                            width: HANDLE_SIZE,
                            height: HANDLE_SIZE,
                            border: '1.5px solid rgba(0,0,0,0.4)',
                          }}
                        />
                      )
                    })}
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-gray-700">
              <span className="text-xs text-[var(--text-muted)]">
                {crop
                  ? `${Math.round(crop.w * (imgSize.w / displaySize.w))} × ${Math.round(crop.h * (imgSize.h / displaySize.h))}`
                  : '拖动鼠标选择裁剪区域'}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!crop || crop.w < MIN_CROP || crop.h < MIN_CROP}
                  className="px-4 py-1.5 rounded-lg text-sm bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  确认裁剪
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
