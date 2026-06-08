import { createPortal } from 'react-dom'
import { X, Download, Sparkles, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import { useEffect } from 'react'

interface UpdateInfo {
  hasUpdate: boolean
  needForceUpdate?: boolean  // 是否强制更新
  latestVersion: string
  changelog: string[]
  downloadUrl: string
  releaseDate?: string
}

interface UpdateModalProps {
  isOpen: boolean
  onClose: () => void
  updateInfo: UpdateInfo | null
}

export default function UpdateModal({ isOpen, onClose, updateInfo }: UpdateModalProps) {
  if (!updateInfo || !updateInfo.hasUpdate) return null

  const isForceUpdate = updateInfo.needForceUpdate

  // 强制更新时阻止 Escape 键关闭
  useEffect(() => {
    if (!isOpen || !isForceUpdate) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, isForceUpdate])

  const handleDownload = () => {
    if (updateInfo.downloadUrl) {
      window.open(updateInfo.downloadUrl, '_blank')
    }
  }

  const handleLater = () => {
    // 强制更新不允许稍后提醒
    if (isForceUpdate) return
    
    // 记录跳过的版本，24小时内不再提示
    localStorage.setItem('sollin-skip-update', JSON.stringify({
      version: updateInfo.latestVersion,
      time: Date.now()
    }))
    onClose()
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={isForceUpdate ? undefined : handleLater}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with gradient */}
            <div className={cn(
              "relative p-6 text-white",
              isForceUpdate 
                ? "bg-gradient-to-br from-orange-500 to-red-500" 
                : "bg-gradient-to-br from-primary-500 to-pink-500"
            )}>
              {!isForceUpdate && (
                <button
                  onClick={handleLater}
                  className="absolute top-4 right-4 p-1 rounded-full hover:bg-white/20 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  {isForceUpdate ? <AlertTriangle className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
                </div>
                <div>
                  <h2 className="text-xl font-bold">
                    {isForceUpdate ? '必须更新' : '发现新版本'}
                  </h2>
                  <p className="text-white/80 text-sm">
                    {isForceUpdate ? '您的版本过低，必须更新才能继续使用' : `v${updateInfo.latestVersion} 已发布`}
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              <h3 className="font-semibold text-[var(--text-primary)] mb-3">更新内容</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {updateInfo.changelog.map((log, i) => (
                  <p key={i} className="text-sm text-[var(--text-muted)] flex items-start gap-2">
                    <span className="text-primary-500">•</span>
                    {log}
                  </p>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 flex gap-3">
              {!isForceUpdate && (
                <button
                  onClick={handleLater}
                  className="flex-1 py-2.5 px-4 rounded-xl text-[var(--text-muted)] hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  稍后提醒
                </button>
              )}
              <button
                onClick={handleDownload}
                className={cn(
                  "py-2.5 px-4 rounded-xl text-white transition-colors flex items-center justify-center gap-2",
                  isForceUpdate 
                    ? "w-full bg-orange-500 hover:bg-orange-600" 
                    : "flex-1 bg-primary-500 hover:bg-primary-600"
                )}
              >
                <Download className="w-4 h-4" />
                {isForceUpdate ? '立即下载更新' : '立即更新'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
