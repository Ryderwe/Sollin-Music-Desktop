import { useState, useEffect, useRef, useCallback } from 'react'
import { X, QrCode, Cookie, RefreshCw, CheckCircle2, Scan, User } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import neteaseAuthApi from '@/services/neteaseAuth'

// QR Status messages
const QR_STATUS_MESSAGES: Record<number, string> = {
    800: '二维码已过期，请刷新',
    801: '请使用小芸音乐APP扫码',
    802: '扫描成功，请在手机上确认',
    803: '登录成功',
}

type LoginTab = 'qr' | 'cookie'

interface LoginModalProps {
    isOpen: boolean
    onClose: () => void
}

export default function LoginModal({ isOpen, onClose }: LoginModalProps) {
    const [activeTab, setActiveTab] = useState<LoginTab>('qr')

    // QR Code login state
    const [qrKey, setQrKey] = useState<string>('')
    const [qrStatus, setQrStatus] = useState<800 | 801 | 802 | 803>(801)
    const [isLoadingQr, setIsLoadingQr] = useState(false)
    const [scannedUser, setScannedUser] = useState<{ nickname: string; avatarUrl: string } | null>(null)

    // QR code URL for Netease login
    const qrUrl = qrKey ? `https://music.163.com/login?codekey=${qrKey}` : ''

    // Cookie login state
    const [cookieInput, setCookieInput] = useState('')
    const [isLoadingCookie, setIsLoadingCookie] = useState(false)

    const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const isUnmountedRef = useRef(false)

    const { setLoginData, setDailyRecommend, setUserPlaylists, setLikeSongIds } = useAuthStore()
    const { addToast } = useUIStore()

    // Generate QR code
    const generateQrCode = useCallback(async () => {
        if (isUnmountedRef.current) return

        setIsLoadingQr(true)
        setQrStatus(801)
        setScannedUser(null)

        try {
            const keyData = await neteaseAuthApi.getQrKey()
            if (!keyData || isUnmountedRef.current) {
                setIsLoadingQr(false)
                return
            }

            setQrKey(keyData.unikey)
        } catch (error) {
            console.error('Generate QR code error:', error)
            addToast({ type: 'error', message: '二维码生成失败' })
        } finally {
            if (!isUnmountedRef.current) {
                setIsLoadingQr(false)
            }
        }
    }, [addToast])

    // Check QR status
    const checkQrStatus = useCallback(async () => {
        if (!qrKey || isUnmountedRef.current || qrStatus === 803) return

        try {
            const result = await neteaseAuthApi.checkQrStatus(qrKey)
            if (!result || isUnmountedRef.current) return

            setQrStatus(result.code)

            switch (result.code) {
                case 800:
                    // QR expired, regenerate
                    if (checkIntervalRef.current) {
                        clearInterval(checkIntervalRef.current)
                        checkIntervalRef.current = null
                    }
                    setTimeout(() => {
                        if (!isUnmountedRef.current) {
                            generateQrCode()
                        }
                    }, 1000)
                    break

                case 802:
                    // Scanned, show user info
                    if (result.nickname) {
                        setScannedUser({
                            nickname: result.nickname,
                            avatarUrl: result.avatarUrl || '',
                        })
                    }
                    break

                case 803:
                    // Login success!
                    if (checkIntervalRef.current) {
                        clearInterval(checkIntervalRef.current)
                        checkIntervalRef.current = null
                    }
                    await handleLoginSuccess(result.cookie || '')
                    break
            }
        } catch (error) {
            console.error('Check QR status error:', error)
        }
    }, [qrKey, qrStatus, generateQrCode])

    // Handle successful login
    const handleLoginSuccess = async (cookie: string) => {
        try {
            // Get user account info
            const userAccount = await neteaseAuthApi.getUserAccount(cookie)
            if (!userAccount) {
                addToast({ type: 'error', message: '获取用户信息失败' })
                return
            }

            // Save login data (store string format for persistence)
            setLoginData({
                userData: userAccount,
                cookie,
                loginType: 'qr',
            })

            addToast({ type: 'success', message: `欢迎回来，${userAccount.nickname}！` })

            // Load user data in background
            loadUserData(userAccount.userId, cookie)

            // Close modal
            onClose()
        } catch (error) {
            console.error('Login success handler error:', error)
            addToast({ type: 'error', message: '登录处理失败' })
        }
    }

    // Load user data after login
    const loadUserData = async (userId: number, cookie: string) => {
        try {
            // Load playlists
            const playlists = await neteaseAuthApi.getUserPlaylist(userId, cookie)
            setUserPlaylists({
                userId,
                playlists,
                lastUpdated: Date.now(),
            })

            // Load daily recommend
            const dailySongs = await neteaseAuthApi.getDailyRecommend(cookie)
            setDailyRecommend({
                timestamp: Date.now(),
                songs: dailySongs,
            })

            // Load like list
            const likeIds = await neteaseAuthApi.getLikelist(userId, cookie)
            setLikeSongIds(likeIds)

        } catch (error) {
            console.error('Load user data error:', error)
        }
    }

    // Cookie login handler
    const handleCookieLogin = async () => {
        if (!cookieInput.trim()) {
            addToast({ type: 'error', message: '请输入Cookie' })
            return
        }

        setIsLoadingCookie(true)

        try {
            // Verify cookie by getting login status
            const status = await neteaseAuthApi.getLoginStatus(cookieInput)

            if (!status.isLoggedIn || !status.userId) {
                addToast({ type: 'error', message: 'Cookie无效或已过期' })
                return
            }

            // Get full user info
            const userAccount = await neteaseAuthApi.getUserAccount(cookieInput)
            if (!userAccount) {
                addToast({ type: 'error', message: '获取用户信息失败' })
                return
            }

            // Save login data
            setLoginData({
                userData: userAccount,
                cookie: cookieInput,
                loginType: 'cookie',
            })

            addToast({ type: 'success', message: `欢迎回来，${userAccount.nickname}！` })

            // Load user data
            loadUserData(userAccount.userId, cookieInput)

            // Close modal
            onClose()
        } catch (error) {
            console.error('Cookie login error:', error)
            addToast({ type: 'error', message: 'Cookie登录失败' })
        } finally {
            setIsLoadingCookie(false)
        }
    }

    // Start QR code polling when tab is QR
    useEffect(() => {
        if (!isOpen || activeTab !== 'qr') return

        isUnmountedRef.current = false
        generateQrCode()

        return () => {
            isUnmountedRef.current = true
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
            }
        }
    }, [isOpen, activeTab, generateQrCode])

    // Poll QR status
    useEffect(() => {
        if (!qrKey || qrStatus === 803 || qrStatus === 800) {
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
            }
            return
        }

        checkIntervalRef.current = setInterval(checkQrStatus, 1500)

        return () => {
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
            }
        }
    }, [qrKey, qrStatus, checkQrStatus])

    // Cleanup on close
    useEffect(() => {
        if (!isOpen) {
            isUnmountedRef.current = true
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
            }
            setQrKey('')
            setQrStatus(801)
            setScannedUser(null)
            setCookieInput('')
        }
    }, [isOpen])

    if (!isOpen) return null

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="w-full max-w-md bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-2xl overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="relative p-6 pb-4">
                        <button
                            onClick={onClose}
                            className="absolute right-4 top-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                            <X className="w-5 h-5 text-[var(--text-muted)]" />
                        </button>
                        <div className="text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center">
                                <User className="w-8 h-8 text-white" />
                            </div>
                            <h2 className="text-2xl font-bold">登录小芸音乐</h2>
                            <p className="text-[var(--text-muted)] mt-1 text-sm">登录后可查看歌单和每日推荐</p>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex border-b border-gray-200 dark:border-gray-700 mx-6">
                        <button
                            onClick={() => setActiveTab('qr')}
                            className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'qr'
                                ? 'text-primary-500 border-b-2 border-primary-500'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                }`}
                        >
                            <QrCode className="w-4 h-4" />
                            扫码登录
                        </button>
                        <button
                            onClick={() => setActiveTab('cookie')}
                            className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'cookie'
                                ? 'text-primary-500 border-b-2 border-primary-500'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                }`}
                        >
                            <Cookie className="w-4 h-4" />
                            Cookie登录
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                        {activeTab === 'qr' && (
                            <div className="flex flex-col items-center">
                                {/* QR Code */}
                                <div className="relative w-48 h-48 mb-4">
                                    {isLoadingQr ? (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-xl">
                                            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                                        </div>
                                    ) : qrUrl ? (
                                        <div className={`relative p-3 bg-white rounded-xl ${qrStatus === 802 ? 'opacity-30' : ''}`}>
                                            <QRCodeSVG
                                                value={qrUrl}
                                                size={168}
                                                level="M"
                                                marginSize={0}
                                            />
                                            {qrStatus === 800 && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl">
                                                    <button
                                                        onClick={generateQrCode}
                                                        className="p-3 bg-white rounded-full hover:bg-gray-100 transition-colors"
                                                    >
                                                        <RefreshCw className="w-6 h-6 text-[var(--text-secondary)]" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-xl">
                                            <QrCode className="w-16 h-16 text-[var(--text-muted)]" />
                                        </div>
                                    )}

                                    {/* Scanned user overlay */}
                                    {qrStatus === 802 && scannedUser && (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                                            {scannedUser.avatarUrl ? (
                                                <img
                                                    src={scannedUser.avatarUrl}
                                                    alt={scannedUser.nickname}
                                                    className="w-16 h-16 rounded-full mb-2"
                                                />
                                            ) : (
                                                <div className="w-16 h-16 rounded-full bg-primary-500 flex items-center justify-center mb-2">
                                                    <User className="w-8 h-8 text-white" />
                                                </div>
                                            )}
                                            <span className="text-sm font-medium">{scannedUser.nickname}</span>
                                        </div>
                                    )}

                                    {/* Success overlay */}
                                    {qrStatus === 803 && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-green-500/90 rounded-xl">
                                            <CheckCircle2 className="w-16 h-16 text-white" />
                                        </div>
                                    )}
                                </div>

                                {/* Status message */}
                                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                                    {qrStatus === 801 && <Scan className="w-4 h-4" />}
                                    {qrStatus === 802 && <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />}
                                    {qrStatus === 803 && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                                    {QR_STATUS_MESSAGES[qrStatus]}
                                </div>

                                {/* Refresh button */}
                                {qrStatus !== 803 && (
                                    <button
                                        onClick={generateQrCode}
                                        disabled={isLoadingQr}
                                        className="mt-4 text-sm text-primary-500 hover:text-primary-600 flex items-center gap-1"
                                    >
                                        <RefreshCw className={`w-4 h-4 ${isLoadingQr ? 'animate-spin' : ''}`} />
                                        刷新二维码
                                    </button>
                                )}
                            </div>
                        )}

                        {activeTab === 'cookie' && (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1.5">Cookie</label>
                                    <textarea
                                        value={cookieInput}
                                        onChange={(e) => setCookieInput(e.target.value)}
                                        placeholder="粘贴你的小芸音乐Cookie..."
                                        className="input min-h-[120px] resize-none font-mono text-xs"
                                        rows={5}
                                    />
                                </div>

                                <p className="text-xs text-[var(--text-muted)]">
                                    从浏览器开发者工具中获取Cookie。打开小芸音乐网页版，按F12打开开发者工具，在Network标签页中找到任意请求的Cookie字段。
                                </p>

                                <button
                                    onClick={handleCookieLogin}
                                    disabled={isLoadingCookie || !cookieInput.trim()}
                                    className="btn-primary w-full"
                                >
                                    {isLoadingCookie ? (
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        '登录'
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}
