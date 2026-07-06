import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Square, X, Maximize2, Music, Power, Pin, PinOff } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [platform, setPlatform] = useState<string>('win32')
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const { closeBehavior, mainWindowAlwaysOnTop, toggleMainWindowAlwaysOnTop } = useUIStore()

  const handleBackgroundPlay = () => {
    window.electronAPI?.close() // 隐藏窗口，后台播放
    setShowCloseDialog(false)
  }

  const handleQuit = () => {
    window.electronAPI?.quit() // 完全退出
    setShowCloseDialog(false)
  }

  useEffect(() => {
    // Get platform
    if (window.electronAPI?.getPlatform) {
      window.electronAPI.getPlatform().then(p => setPlatform(p))
    }

    // Listen for close dialog event from main process (macOS native close button)
    const unsubscribe = window.electronAPI?.onShowCloseDialog?.(() => {
      if (closeBehavior === 'background') {
        handleBackgroundPlay()
      } else if (closeBehavior === 'quit') {
        handleQuit()
      } else {
        setShowCloseDialog(true)
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [closeBehavior])

  const handleMinimize = () => window.electronAPI?.minimize()
  const handleMaximize = () => {
    window.electronAPI?.maximize()
    setIsMaximized(!isMaximized)
  }
  const handleCloseClick = () => {
    if (closeBehavior === 'background') {
      handleBackgroundPlay()
      return
    }
    if (closeBehavior === 'quit') {
      handleQuit()
      return
    }
    setShowCloseDialog(true)
  }

  // macOS uses native traffic lights, so we only show the drag region
  // but we still need to render the dialog for both platforms
  const isMac = platform === 'darwin'

  return (
    <>
      {!isMac && (
      <div className="h-8 flex items-center justify-between drag-region bg-[var(--panel-bg)] border-b border-gray-200/30 dark:border-gray-800/50"
        style={{ backdropFilter: 'blur(var(--panel-backdrop-blur))' }}>
        {/* App title */}
        <div className="flex items-center gap-2 px-4">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-primary-500 to-pink-500" />
          <span className="text-sm font-medium text-[var(--text-secondary)]">Sollin</span>
        </div>

        {/* Window controls */}
        <div className="flex no-drag">
          <button
            onClick={toggleMainWindowAlwaysOnTop}
            className="w-12 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title={mainWindowAlwaysOnTop ? '取消置顶' : '始终置顶'}
          >
            {mainWindowAlwaysOnTop ? (
              <Pin className="w-3.5 h-3.5 text-primary-500" />
            ) : (
              <PinOff className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            )}
          </button>
          <button
            onClick={handleMinimize}
            className="w-12 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <Minus className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
          <button
            onClick={handleMaximize}
            className="w-12 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {isMaximized ? (
              <Square className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            )}
          </button>
          <button
            onClick={handleCloseClick}
            className="w-12 h-8 flex items-center justify-center hover:bg-red-500 group transition-colors"
          >
            <X className="w-4 h-4 text-[var(--text-muted)] group-hover:text-white" />
          </button>
        </div>
      </div>
      )}

      {/* Close confirmation dialog - using Portal to render at body level */}
      {showCloseDialog && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-80 space-y-4">
            <h3 className="text-lg font-semibold text-center">关闭窗口</h3>
            <p className="text-sm text-[var(--text-muted)] text-center">请选择关闭方式</p>
            
            <div className="space-y-2">
              <button
                onClick={handleBackgroundPlay}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-primary-500/10 hover:bg-primary-500/20 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center">
                  <Music className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="font-medium">后台播放</p>
                  <p className="text-xs text-[var(--text-muted)]">最小化到托盘，继续播放</p>
                </div>
              </button>
              
              <button
                onClick={handleQuit}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <Power className="w-5 h-5 text-[var(--text-muted)]" />
                </div>
                <div className="text-left">
                  <p className="font-medium">退出应用</p>
                  <p className="text-xs text-[var(--text-muted)]">完全关闭 Sollin</p>
                </div>
              </button>
            </div>

            <button
              onClick={() => setShowCloseDialog(false)}
              className="w-full py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              取消
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
