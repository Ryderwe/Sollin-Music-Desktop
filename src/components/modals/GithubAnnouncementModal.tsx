import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BellRing, ExternalLink, X } from 'lucide-react'
import type { GithubAnnouncement } from '@/services/githubAnnouncement'

interface GithubAnnouncementModalProps {
  isOpen: boolean
  announcement: GithubAnnouncement | null
  onClose: () => void
}

const formatDate = (value?: string) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function GithubAnnouncementModal({ isOpen, announcement, onClose }: GithubAnnouncementModalProps) {
  if (!announcement) return null

  const handleOpenOriginal = () => {
    window.open(announcement.htmlUrl, '_blank', 'noopener,noreferrer')
  }

  const displayDate = formatDate(announcement.updatedAt || announcement.createdAt)

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/50 backdrop-blur-sm"
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
                aria-label="关闭公告"
              >
                <X className="w-5 h-5 text-[var(--text-muted)]" />
              </button>
              <div className="flex items-start gap-4 pr-10">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-indigo-500 flex items-center justify-center flex-shrink-0">
                  <BellRing className="w-6 h-6 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-primary-500 font-medium">项目公告</p>
                  <h2 className="text-xl font-bold mt-1">Sollin Music Desktop</h2>
                  <p className="text-sm text-[var(--text-muted)] mt-1">
                    {announcement.author}{displayDate ? ` · ${displayDate}` : ''}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6">
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-secondary)] font-sans">
                {announcement.body}
              </pre>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                我知道了
              </button>
              <button
                onClick={handleOpenOriginal}
                className="px-4 py-2 rounded-xl text-sm bg-primary-500 text-white hover:bg-primary-600 transition-colors inline-flex items-center gap-2"
              >
                查看原文
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
