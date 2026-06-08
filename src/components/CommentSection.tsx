import { useState, useEffect, useMemo } from 'react'
import { MessageCircle, ThumbsUp, Loader2, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Song, SongComment } from '@/types'
import api from '@/services/api'
import neteaseAuthApi from '@/services/neteaseAuth'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/utils/cn'

type LegacyResourceType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

type SongModeProps = {
  song: Song | null
  resourceId?: never
  resourceType?: never
  className?: string
  maxHeight?: string
  theme?: 'light' | 'dark'
}

type LegacyModeProps = {
  resourceId: string | number
  resourceType: LegacyResourceType
  song?: never
  className?: string
  maxHeight?: string
  theme?: 'light' | 'dark'
}

type CommentSectionProps = SongModeProps | LegacyModeProps

type SortType = 1 | 2 | 3

const normalizeLegacyComment = (comment: any): SongComment => ({
  id: String(comment.commentId),
  text: comment.content || '',
  time: typeof comment.time === 'number' ? comment.time : undefined,
  timeStr: comment.timeStr,
  likedCount: typeof comment.likedCount === 'number' ? comment.likedCount : undefined,
  liked: Boolean(comment.liked),
  user: {
    id: comment.user?.userId != null ? String(comment.user.userId) : undefined,
    name: comment.user?.nickname || '匿名用户',
    avatar: comment.user?.avatarUrl,
  },
  reply: comment.beReplied?.length
    ? [{
      id: String(comment.beReplied[0].beRepliedCommentId || `${comment.commentId}-reply`),
      text: comment.beReplied[0].content || '',
      user: {
        name: comment.beReplied[0].user?.nickname || '匿名用户',
      },
    }]
    : undefined,
})

export default function CommentSection(props: CommentSectionProps) {
  const { cookie } = useAuthStore()
  const className = props.className
  const maxHeight = props.maxHeight || '400px'
  const theme = props.theme || 'dark'
  const isSongMode = 'song' in props
  const song = isSongMode ? props.song : null
  const resourceId = !isSongMode ? props.resourceId : null
  const resourceType = !isSongMode ? props.resourceType : null

  const [comments, setComments] = useState<SongComment[]>([])
  const [hotComments, setHotComments] = useState<SongComment[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [sortType, setSortType] = useState<SortType>(1)
  const [showHot, setShowHot] = useState(true)

  const reloadKey = useMemo(() => (
    isSongMode ? `${song?.platform || ''}:${song?.id || ''}` : `${resourceType}:${resourceId}`
  ), [isSongMode, song?.platform, song?.id, resourceType, resourceId])

  const loadComments = async(pageNum: number = 1, append: boolean = false) => {
    if (isSongMode) {
      if (!song) return
      setIsLoading(true)
      try {
        const result = await api.getSongComments(song, pageNum, 20)
        if (append) {
          setComments((prev) => [...prev, ...result.comments])
        } else {
          setComments(result.comments)
        }
        setTotalCount(result.total)
        setHasMore(pageNum < result.maxPage)
      } catch (error) {
        console.error('Load official comments error:', error)
      } finally {
        setIsLoading(false)
      }
      return
    }

    if (!resourceId || resourceType == null) return
    setIsLoading(true)

    try {
      const result = await neteaseAuthApi.getComments(
        resourceId,
        resourceType,
        pageNum,
        20,
        sortType,
      )

      if (result) {
        const normalized = result.comments.map(normalizeLegacyComment)
        if (append) {
          setComments((prev) => [...prev, ...normalized])
        } else {
          setComments(normalized)
        }
        setTotalCount(result.totalCount)
        setHasMore(result.hasMore)
      }
    } catch (error) {
      console.error('Load comments error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadHotComments = async() => {
    if (isSongMode) {
      if (!song) return
      try {
        const result = await api.getSongHotComments(song, 1, 10)
        setHotComments(result.comments)
      } catch (error) {
        console.error('Load official hot comments error:', error)
      }
      return
    }

    if (!resourceId || resourceType == null) return
    try {
      const result = await neteaseAuthApi.getHotComments(resourceId, resourceType, 10)
      if (result) {
        setHotComments(result.hotComments.map(normalizeLegacyComment))
      }
    } catch (error) {
      console.error('Load hot comments error:', error)
    }
  }

  useEffect(() => {
    setPage(1)
    setComments([])
    setHotComments([])
    setTotalCount(0)
    setHasMore(false)
    loadComments(1)
    loadHotComments()
  }, [reloadKey])

  useEffect(() => {
    if (!isSongMode && resourceId) {
      setPage(1)
      loadComments(1)
    }
  }, [sortType])

  const loadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    loadComments(nextPage, true)
  }

  const handleLike = async(comment: SongComment) => {
    if (isSongMode || !cookie || !resourceId || resourceType == null) return

    const t = comment.liked ? 0 : 1
    const success = await neteaseAuthApi.likeComment(
      resourceId,
      Number(comment.id),
      t,
      resourceType,
      cookie,
    )

    if (success) {
      const updateComment = (item: SongComment): SongComment => {
        if (item.id === comment.id) {
          return {
            ...item,
            liked: !item.liked,
            likedCount: item.liked
              ? Math.max((item.likedCount || 1) - 1, 0)
              : (item.likedCount || 0) + 1,
          }
        }
        return item
      }
      setComments((prev) => prev.map(updateComment))
      setHotComments((prev) => prev.map(updateComment))
    }
  }

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60))
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60))
        return minutes <= 0 ? '刚刚' : `${minutes}分钟前`
      }
      return `${hours}小时前`
    }
    if (days < 7) return `${days}天前`
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }

  const renderComment = (comment: SongComment, isHot: boolean = false) => {
    const firstReply = comment.reply?.[0]

    return (
      <motion.div
        key={comment.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'flex gap-3 p-3 rounded-xl transition-colors',
          theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-gray-100',
        )}
      >
        {comment.user.avatar ? (
          <img
            src={comment.user.avatar}
            alt={comment.user.name}
            className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
          />
        ) : (
          <div className={cn(
            'w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm',
            theme === 'dark' ? 'bg-white/10 text-white/60' : 'bg-gray-200 text-[var(--text-muted)]',
          )}>
            {comment.user.name.slice(0, 1)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn(
              'font-medium text-sm',
              theme === 'dark' ? 'text-white/90' : 'text-[var(--text-primary)]',
            )}>
              {comment.user.name}
            </span>
            {isHot && (
              <span className="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
                热评
              </span>
            )}
          </div>
          <p className={cn(
            'text-sm mb-2 break-words whitespace-pre-wrap',
            theme === 'dark' ? 'text-white/80' : 'text-[var(--text-secondary)]',
          )}>
            {comment.text}
          </p>
          {firstReply && (
            <div className={cn(
              'text-xs p-2 rounded-lg mb-2',
              theme === 'dark' ? 'bg-white/5 text-white/60' : 'bg-gray-100 text-[var(--text-secondary)]',
            )}>
              <span className="font-medium">@{firstReply.user.name}: </span>
              {firstReply.text}
            </div>
          )}
          <div className="flex items-center gap-4">
            <span className={cn(
              'text-xs',
              theme === 'dark' ? 'text-white/40' : 'text-[var(--text-muted)]',
            )}>
              {comment.timeStr || formatTime(comment.time)}
            </span>
            {isSongMode ? (
              <span className={cn(
                'flex items-center gap-1 text-xs',
                theme === 'dark' ? 'text-white/40' : 'text-[var(--text-muted)]',
              )}>
                <ThumbsUp className="w-3.5 h-3.5" />
                {comment.likedCount ? comment.likedCount : '0'}
              </span>
            ) : (
              <button
                onClick={() => handleLike(comment)}
                className={cn(
                  'flex items-center gap-1 text-xs transition-colors',
                  comment.liked
                    ? 'text-red-500'
                    : theme === 'dark' ? 'text-white/40 hover:text-white/70' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                )}
              >
                <ThumbsUp className={cn('w-3.5 h-3.5', comment.liked && 'fill-current')} />
                {comment.likedCount && comment.likedCount > 0 ? comment.likedCount : ''}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    )
  }

  const isDark = theme === 'dark'

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <MessageCircle className={cn('w-5 h-5', isDark ? 'text-white/70' : 'text-[var(--text-secondary)]')} />
          <span className={cn('font-medium', isDark ? 'text-white' : 'text-[var(--text-primary)]')}>
            评论
          </span>
          {totalCount > 0 && (
            <span className={cn('text-sm', isDark ? 'text-white/50' : 'text-[var(--text-muted)]')}>
              ({totalCount})
            </span>
          )}
        </div>
        {!isSongMode && (
          <div className="flex items-center gap-1">
            {[
              { value: 1 as SortType, label: '推荐' },
              { value: 2 as SortType, label: '热度' },
              { value: 3 as SortType, label: '最新' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSortType(opt.value)}
                className={cn(
                  'px-2 py-1 text-xs rounded-full transition-colors',
                  sortType === opt.value
                    ? isDark ? 'bg-white/20 text-white' : 'bg-gray-200 text-[var(--text-primary)]'
                    : isDark ? 'text-white/50 hover:text-white/70' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-y-auto scrollbar-thin space-y-1" style={{ maxHeight }}>
        {hotComments.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setShowHot(!showHot)}
              className={cn(
                'flex items-center gap-1 text-xs mb-2 px-1',
                isDark ? 'text-white/50' : 'text-[var(--text-muted)]',
              )}
            >
              <span>精彩评论</span>
              <ChevronDown className={cn('w-3 h-3 transition-transform', !showHot && '-rotate-90')} />
            </button>
            <AnimatePresence>
              {showHot && hotComments.map((comment) => renderComment(comment, true))}
            </AnimatePresence>
          </div>
        )}

        {hotComments.length > 0 && comments.length > 0 && (
          <div className={cn(
            'border-t my-3',
            isDark ? 'border-white/10' : 'border-gray-200',
          )} />
        )}

        {comments.length > 0 && (
          <div>
            <p className={cn(
              'text-xs mb-2 px-1',
              isDark ? 'text-white/50' : 'text-[var(--text-muted)]',
            )}>
              全部评论
            </p>
            {comments.map((comment) => renderComment(comment))}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className={cn('w-5 h-5 animate-spin', isDark ? 'text-white/50' : 'text-[var(--text-muted)]')} />
          </div>
        )}

        {hasMore && !isLoading && (
          <button
            onClick={loadMore}
            className={cn(
              'w-full py-3 text-sm rounded-lg transition-colors',
              isDark ? 'text-white/50 hover:bg-white/5' : 'text-[var(--text-muted)] hover:bg-gray-100',
            )}
          >
            加载更多
          </button>
        )}

        {!isLoading && comments.length === 0 && hotComments.length === 0 && (
          <div className={cn(
            'text-center py-8',
            isDark ? 'text-white/40' : 'text-[var(--text-muted)]',
          )}>
            暂无评论
          </div>
        )}
      </div>
    </div>
  )
}
