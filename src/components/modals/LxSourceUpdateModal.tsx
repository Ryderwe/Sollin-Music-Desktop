import { AnimatePresence, motion } from 'framer-motion'
import { BellRing, ExternalLink, FileCode2, X } from 'lucide-react'
import type { LxSourceUpdateAlert } from '@/services/lxSource'

interface LxSourceUpdateModalProps {
  alert: LxSourceUpdateAlert | null
  onClose: () => void
}

export default function LxSourceUpdateModal({ alert, onClose }: LxSourceUpdateModalProps) {
  if (!alert) return null

  const handleOpenUrl = () => {
    if (!alert.updateUrl) return
    window.open(alert.updateUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="w-full max-w-lg mx-4 bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-2xl overflow-hidden"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative p-6 border-b border-gray-100 dark:border-gray-800">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
            <div className="flex items-start gap-4 pr-10">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-indigo-500 flex items-center justify-center flex-shrink-0">
                <BellRing className="w-6 h-6 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-primary-500 font-medium">LX 音源更新提醒</p>
                <h2 className="text-xl font-bold mt-1 break-all">{alert.name || 'LX 音源'}</h2>
                <p className="text-sm text-[var(--text-muted)] mt-1 break-all">
                  {alert.description || '当前音源脚本检测到新版本更新信息。'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4">
                <p className="text-xs text-[var(--text-muted)] mb-1">当前脚本版本</p>
                <p className="font-medium break-all">{alert.version || '未标注版本'}</p>
              </div>
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4">
                <p className="text-xs text-[var(--text-muted)] mb-1">导入来源</p>
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <FileCode2 className="w-4 h-4 text-primary-500 flex-shrink-0" />
                  <p className="break-all">{alert.scriptUrl || '本地脚本 / 自动检测'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-sm font-medium mb-2">更新内容</p>
              <pre className="text-sm leading-6 whitespace-pre-wrap break-words text-[var(--text-secondary)] font-sans">
                {alert.log}
              </pre>
            </div>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-800/50 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              关闭
            </button>
            {alert.updateUrl && (
              <button
                onClick={handleOpenUrl}
                className="px-4 py-2 rounded-xl text-sm bg-primary-500 text-white hover:bg-primary-600 transition-colors inline-flex items-center gap-2"
              >
                打开更新地址
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
