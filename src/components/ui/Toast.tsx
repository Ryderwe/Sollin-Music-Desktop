import { forwardRef, useEffect } from 'react'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/utils/cn'
import { useUIStore } from '@/stores/uiStore'

interface ToastProps {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
}

const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast(
  { id, type, message, duration = 3000 },
  ref,
) {
  const { removeToast } = useUIStore()

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-green-500" />,
    error: <AlertCircle className="w-5 h-5 text-red-500" />,
    info: <Info className="w-5 h-5 text-blue-500" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-500" />,
  }

  const backgrounds = {
    success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
  }

  const handleClose = () => {
    removeToast(id)
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      removeToast(id)
    }, duration)
    return () => window.clearTimeout(timeoutId)
  }, [duration, id, removeToast])

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'no-drag flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg',
        backgrounds[type]
      )}
    >
      {icons[type]}
      <span className="text-sm font-medium text-[var(--text-secondary)]">
        {message}
      </span>
      <button
        type="button"
        onClick={handleClose}
        className="ml-2 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
      >
        <X className="w-4 h-4 text-[var(--text-muted)]" />
      </button>
    </motion.div>
  )
})

export default Toast
