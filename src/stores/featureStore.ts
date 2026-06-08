import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { parseDislikeRules } from '@/services/dislikeRules'

const SEARCH_HISTORY_LIMIT = 20

interface FeatureStore {
  dislikeRules: string
  setDislikeRules: (rules: string) => void
  addDislikeRules: (rules: string | string[]) => number
  clearDislikeRules: () => void

  searchHistory: string[]
  addSearchHistory: (query: string) => void
  removeSearchHistory: (query: string) => void
  clearSearchHistory: () => void
}

const normalizeSearchQuery = (query: string) => query.trim().replace(/\s+/g, ' ')

export const useFeatureStore = create<FeatureStore>()(
  persist(
    (set, get) => ({
      dislikeRules: '',
      setDislikeRules: (rules) => {
        set({ dislikeRules: parseDislikeRules(rules).rules })
      },
      addDislikeRules: (rules) => {
        const incomingRules = Array.isArray(rules) ? rules : [rules]
        const parsed = parseDislikeRules([
          get().dislikeRules,
          ...incomingRules,
        ].filter(Boolean).join('\n'))
        set({ dislikeRules: parsed.rules })
        return parsed.count
      },
      clearDislikeRules: () => set({ dislikeRules: '' }),

      searchHistory: [],
      addSearchHistory: (query) => {
        const normalizedQuery = normalizeSearchQuery(query)
        if (!normalizedQuery) return

        set((state) => ({
          searchHistory: [
            normalizedQuery,
            ...state.searchHistory.filter((item) => item !== normalizedQuery),
          ].slice(0, SEARCH_HISTORY_LIMIT),
        }))
      },
      removeSearchHistory: (query) => {
        const normalizedQuery = normalizeSearchQuery(query)
        set((state) => ({
          searchHistory: state.searchHistory.filter((item) => item !== normalizedQuery),
        }))
      },
      clearSearchHistory: () => set({ searchHistory: [] }),
    }),
    {
      name: 'Sollin-feature-settings',
      version: 1,
    },
  ),
)
