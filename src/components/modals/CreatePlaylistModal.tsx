import { useState } from 'react'
import { X, ListMusic } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserStore } from '@/stores/userStore'
import { useUIStore } from '@/stores/uiStore'

export default function CreatePlaylistModal() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const { createPlaylist, createLocalPlaylist } = useUserStore()
  const { setShowCreatePlaylistModal, addToast, createPlaylistMode, setCreatePlaylistMode } = useUIStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsLoading(true)
    try {
      if (createPlaylistMode === 'local') {
        await createLocalPlaylist(name.trim(), description.trim())
        addToast({ type: 'success', message: '本地歌单创建成功' })
      } else {
        await createPlaylist(name.trim(), description.trim())
        addToast({ type: 'success', message: '歌单创建成功' })
      }
      setShowCreatePlaylistModal(false)
      setCreatePlaylistMode('default')
    } catch (error: any) {
      addToast({ type: 'error', message: error.message || '创建失败' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setShowCreatePlaylistModal(false)
    setCreatePlaylistMode('default')
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-md bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="relative p-6 pb-0">
            <button
              onClick={handleClose}
              className="absolute right-4 top-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary-500 to-pink-500 flex items-center justify-center">
                <ListMusic className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">{createPlaylistMode === 'local' ? '新建本地歌单' : '新建歌单'}</h2>
              <p className="text-[var(--text-muted)] mt-1">
                {createPlaylistMode === 'local' ? '创建一个仅用于本地音乐的歌单' : '创建一个新的歌单来整理你的音乐'}
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">歌单名称</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="给歌单起个名字"
                className="input"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">描述 (可选)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="添加描述..."
                className="input min-h-[80px] resize-none"
                rows={3}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="btn-secondary flex-1"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isLoading || !name.trim()}
                className="btn-primary flex-1"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  '创建'
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
