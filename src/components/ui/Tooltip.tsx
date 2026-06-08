import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

type TooltipSide = 'top' | 'right' | 'bottom' | 'left'
type TooltipAlign = 'start' | 'center' | 'end'

interface TooltipProps {
  children: ReactNode
  content: ReactNode
  side?: TooltipSide
  align?: TooltipAlign
  contentClassName?: string
  delayDuration?: number
  sideOffset?: number
  disabled?: boolean
  asChild?: boolean
}

// Thin wrapper around Radix Tooltip so we can keep styling consistent across the app.
// Sollin never nested providers manually, so we expose a self-contained Provider per-tooltip.
// Rendering overhead is negligible for a handful of mounted triggers.
export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  contentClassName,
  delayDuration = 120,
  sideOffset = 6,
  disabled = false,
  asChild = true,
}: TooltipProps) {
  if (disabled || content == null || content === '') {
    return <>{children}</>
  }

  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild={asChild}>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={cn(
              'z-[120] max-w-xs rounded-md border border-gray-200/80 bg-white/95 px-3 py-2 text-xs leading-snug text-[var(--text-secondary)] shadow-lg backdrop-blur',
              'dark:border-gray-700/80 dark:bg-gray-800/95 dark:text-[var(--text-secondary)]',
              'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
              contentClassName,
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-white/95 dark:fill-gray-800/95" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

export default Tooltip
