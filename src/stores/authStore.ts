import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import neteaseAuthApi from '@/services/neteaseAuth'

// Login types
export type LoginType = 'qr' | 'cookie' | null

export interface NeteaseUserData {
    userId: number
    nickname: string
    avatarUrl: string
    signature?: string
    vipType?: number
}

export interface QrCheckResult {
    code: 800 | 801 | 802 | 803
    message: string
    nickname?: string
    avatarUrl?: string
    cookie?: string
    cookieObj?: Record<string, string>  // Raw cookie object for API calls
}

export interface DailyRecommendData {
    timestamp: number | null
    songs: any[]
}

export interface UserPlaylistData {
    userId: number
    playlists: any[]
    lastUpdated: number | null
}

interface AuthStore {
    // State
    isLoggedIn: boolean
    loginType: LoginType
    userData: NeteaseUserData | null
    cookie: string | null
    loginExpireTime: number | null
    lastLoginTime: number | null

    // User data caches
    dailyRecommend: DailyRecommendData
    userPlaylists: UserPlaylistData
    likeSongIds: number[]

    // Actions
    setLoginData: (data: {
        userData: NeteaseUserData
        cookie: string
        loginType: LoginType
        expireTime?: number
    }) => void
    logout: () => void
    updateUserData: (userData: Partial<NeteaseUserData>) => void
    setDailyRecommend: (data: DailyRecommendData) => void
    setUserPlaylists: (data: UserPlaylistData) => void
    refreshUserPlaylists: () => Promise<void>
    setLikeSongIds: (ids: number[]) => void
    isLikeSong: (id: number) => boolean
    clearAllData: () => void
}

const getDefaultState = () => ({
    isLoggedIn: false,
    loginType: null as LoginType,
    userData: null as NeteaseUserData | null,
    cookie: null as string | null,
    loginExpireTime: null as number | null,
    lastLoginTime: null as number | null,
    dailyRecommend: { timestamp: null, songs: [] } as DailyRecommendData,
    userPlaylists: { userId: 0, playlists: [], lastUpdated: null } as UserPlaylistData,
    likeSongIds: [] as number[],
})

export const useAuthStore = create<AuthStore>()(
    persist(
        (set, get) => ({
            ...getDefaultState(),

            setLoginData: ({ userData, cookie, loginType, expireTime }) => {
                // Set cookie in crypto module for direct API calls
                neteaseAuthApi.setAuthCookie(cookie)
                set({
                    isLoggedIn: true,
                    userData,
                    cookie,
                    loginType,
                    loginExpireTime: expireTime || null,
                    lastLoginTime: Date.now(),
                })
            },

            logout: () => {
                // Clear cookie in crypto module
                neteaseAuthApi.setAuthCookie('')
                set(getDefaultState())
            },

            updateUserData: (userData) => {
                const current = get().userData
                if (current) {
                    set({ userData: { ...current, ...userData } })
                }
            },

            setDailyRecommend: (data) => {
                set({ dailyRecommend: data })
            },

            setUserPlaylists: (data) => {
                set({ userPlaylists: data })
            },

            refreshUserPlaylists: async () => {
                const { userData, cookie } = get()
                if (!userData?.userId || !cookie) return

                try {
                    const playlists = await neteaseAuthApi.getUserPlaylist(userData.userId, cookie)
                    set({
                        userPlaylists: {
                            userId: userData.userId,
                            playlists,
                            lastUpdated: Date.now(),
                        },
                    })
                } catch (error) {
                    console.error('Refresh user playlists error:', error)
                }
            },

            setLikeSongIds: (ids) => {
                set({ likeSongIds: ids })
            },

            isLikeSong: (id) => {
                return get().likeSongIds.includes(id)
            },

            clearAllData: () => {
                set(getDefaultState())
            },
        }),
        {
            name: 'sollin-auth',
            onRehydrateStorage: () => {
                return (state) => {
                    // Restore cookie in crypto module from persisted state
                    if (state?.cookie) {
                        neteaseAuthApi.setAuthCookie(state.cookie)
                    }
                }
            },
        }
    )
)
