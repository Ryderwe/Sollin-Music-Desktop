import { useState, useCallback, useEffect, useRef } from 'react'
import { cn } from '@/utils/cn'
import { isGatewayCoverUrl, resolveCoverUrl } from '@/services/officialCoverApi'

const LOADING_GIF = './loding.gif'

interface CoverImageProps {
    src?: string
    alt: string
    className?: string
    fallback?: string
}

export default function CoverImage({
    src,
    alt,
    className,
    fallback = LOADING_GIF
}: CoverImageProps) {
    const shouldResolveGateway = Boolean(src && isGatewayCoverUrl(src))
    const imgRef = useRef<HTMLImageElement | null>(null)
    const [isLoading, setIsLoading] = useState(Boolean(src))
    const [hasError, setHasError] = useState(false)
    const [resolvedSrc, setResolvedSrc] = useState<string>(() => shouldResolveGateway ? '' : (src || ''))

    useEffect(() => {
        let cancelled = false

        setHasError(false)
        setIsLoading(Boolean(src))

        if (!src) {
            setResolvedSrc('')
            return () => {
                cancelled = true
            }
        }

        if (!isGatewayCoverUrl(src)) {
            setResolvedSrc(src)
            return () => {
                cancelled = true
            }
        }

        setResolvedSrc('')
        void resolveCoverUrl(src).then((nextSrc) => {
            if (cancelled) return
            setResolvedSrc(nextSrc || '')
            if (!nextSrc) {
                setHasError(true)
                setIsLoading(false)
            }
        }).catch(() => {
            if (cancelled) return
            setResolvedSrc('')
            setHasError(true)
            setIsLoading(false)
        })

        return () => {
            cancelled = true
        }
    }, [src])

    const handleLoad = useCallback(() => {
        setIsLoading(false)
    }, [])

    const handleError = useCallback(() => {
        setIsLoading(false)
        setHasError(true)
    }, [])

    const displaySrc = hasError || !resolvedSrc ? fallback : resolvedSrc

    useEffect(() => {
        if (!isLoading) return

        const image = imgRef.current
        if (!image) return

        const syncCompleteState = () => {
            if (!image.complete) return
            if (image.naturalWidth > 0) {
                setHasError(false)
                setIsLoading(false)
            }
        }

        syncCompleteState()

        if (!image.complete) {
            const rafId = window.requestAnimationFrame(syncCompleteState)
            return () => window.cancelAnimationFrame(rafId)
        }
    }, [displaySrc, isLoading])

    return (
        <div className={cn('relative overflow-hidden', className)}>
            {isLoading && resolvedSrc && (
                <img
                    src={LOADING_GIF}
                    alt="Loading..."
                    className="absolute inset-0 w-full h-full object-cover"
                />
            )}

            <img
                ref={imgRef}
                src={displaySrc}
                alt={alt}
                loading="lazy"
                decoding="async"
                onLoad={handleLoad}
                onError={handleError}
                className={cn(
                    'w-full h-full object-cover',
                    isLoading && resolvedSrc && 'opacity-0'
                )}
            />
        </div>
    )
}
