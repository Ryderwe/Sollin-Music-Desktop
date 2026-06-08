import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Download, Globe, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUIStore } from '@/stores/uiStore'
import { ONLINE_MUSIC_PLATFORM_OPTIONS } from '@/constants/platforms'
import { importSharedOnlinePlaylist } from '@/services/sharedOnlinePlaylistImport'
import { getOnlinePlaylistBrowsePath } from '@/utils/onlinePlaylistRoute'
import type { Platform } from '@/types'

export default function ImportPlaylistModal() {
  const navigate = useNavigate()
  const [playlistInput, setPlaylistInput] = useState('')
  const [platform, setPlatform] = useState<Platform>('netease')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const { setShowImportPlaylistModal, addToast } = useUIStore()

  const handleClose = () => {
    setShowImportPlaylistModal(false)
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    const input = playlistInput.trim()
    if (!input) {
      setError('请输入歌单链接或歌单 ID')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const result = await importSharedOnlinePlaylist(platform, input, { force: true })

      if (!result) {
        setError('获取歌单失败，请检查链接或 ID 是否正确')
        return
      }

      if (result.playlist.songs.length === 0) {
        setError('歌单为空或暂时无法获取歌曲列表')
        return
      }

      addToast({
        type: 'success',
        message: result.action === 'updated'
          ? `已刷新歌单「${result.playlist.name}」`
          : `已导入歌单「${result.playlist.name}」`,
      })

      setShowImportPlaylistModal(false)
      navigate(getOnlinePlaylistBrowsePath(result.playlist))
    } catch (err: any) {
      console.error('Import shared playlist error:', err)
      setError(err?.message || '导入失败，请稍后重试')
    } finally {
      setIsLoading(false)
    }
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
          <div className="relative p-6 pb-0">
            <button
              onClick={handleClose}
              className="absolute right-4 top-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                <Globe className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">打开分享的歌单</h2>
              <p className="text-[var(--text-muted)] mt-1">先选择平台，再输入歌单链接或歌单 ID</p>
            </div>
          </div>

          <form onSubmit={handleImport} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">选择平台</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ONLINE_MUSIC_PLATFORM_OPTIONS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setPlatform(item.value)}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${platform === item.value
                      ? 'border-primary-500 bg-primary-500/10 text-primary-500'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">歌单链接或 ID</label>
              <input
                type="text"
                value={playlistInput}
                onChange={(e) => {
                  setPlaylistInput(e.target.value)
                  setError('')
                }}
                placeholder="例如：分享链接、网页链接、歌单 ID"
                className="input"
                autoFocus
              />
            </div>

            <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl text-yellow-800 dark:text-yellow-200">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-medium">导入说明</p>
                <p>不支持跨平台自动识别，请确认链接与当前选择的平台一致。</p>
                <p>小枸音乐建议使用普通版分享链接或小枸码，直接填歌单 ID 可能无法打开。</p>
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
                {error}
              </div>
            )}

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
                disabled={isLoading || !playlistInput.trim()}
                className="btn-primary flex-1 gap-2"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    打开歌单
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
