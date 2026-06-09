import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Home,
  HardDrive,
  ListMusic,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Cloud,
  Globe,
  Download,
  Heart,
  type LucideIcon,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuthStore, type NeteasePlaylistSummary } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { useUserStore } from '@/stores/userStore'
import { cn } from '@/utils/cn'
import { getOnlinePlaylistBrowsePath } from '@/utils/onlinePlaylistRoute'

type PlaylistSection = 'custom' | 'local' | 'online'

const NETEASE_SIDEBAR_FOLD_STORAGE_KEY = 'netease-sidebar-fold-state'

type NeteaseFoldState = {
  root: boolean
  created: boolean
  collected: boolean
}

const DEFAULT_NETEASE_FOLD_STATE: NeteaseFoldState = {
  root: true,
  created: true,
  collected: true,
}

const readNeteaseFoldState = (): NeteaseFoldState => {
  if (typeof window === 'undefined') return DEFAULT_NETEASE_FOLD_STATE

  try {
    const raw = window.localStorage.getItem(NETEASE_SIDEBAR_FOLD_STORAGE_KEY)
    if (!raw) return DEFAULT_NETEASE_FOLD_STATE
    const parsed = JSON.parse(raw) as Partial<NeteaseFoldState>
    return {
      root: typeof parsed.root === 'boolean' ? parsed.root : DEFAULT_NETEASE_FOLD_STATE.root,
      created: typeof parsed.created === 'boolean' ? parsed.created : DEFAULT_NETEASE_FOLD_STATE.created,
      collected: typeof parsed.collected === 'boolean' ? parsed.collected : DEFAULT_NETEASE_FOLD_STATE.collected,
    }
  } catch {
    return DEFAULT_NETEASE_FOLD_STATE
  }
}

const encodeSortableId = (section: PlaylistSection, id: string) => `${section}:${id}`
const decodeSortableId = (encoded: string): { section: PlaylistSection; id: string } => {
  const [section, ...rest] = encoded.split(':')
  return { section: section as PlaylistSection, id: rest.join(':') }
}

function SortablePlaylistItem({
  sortableId,
  cover,
  label,
  to,
  collapsed,
  icon,
}: {
  sortableId: string
  cover: string | undefined
  label: string
  to: string
  collapsed: boolean
  icon: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="flex items-center cursor-grab active:cursor-grabbing select-none">
      <NavLink
        to={to}
        className={({ isActive }) =>
          cn(
            'sidebar-item flex-1 min-w-0',
            isActive && 'active',
            collapsed && 'justify-center px-2',
          )
        }
      >
        {cover ? (
          <img src={cover} alt="" className="w-5 h-5 rounded flex-shrink-0 object-cover" />
        ) : icon}
        {!collapsed && <span className="truncate">{label}</span>}
      </NavLink>
    </div>
  )
}

function SortableOnlinePlaylistItem({
  sortableId,
  cover,
  label,
  onClick,
  collapsed,
}: {
  sortableId: string
  cover: string | undefined
  label: string
  onClick: () => void
  collapsed: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="flex items-center cursor-grab active:cursor-grabbing select-none">
      <button
        onClick={onClick}
        className={cn('sidebar-item w-full flex-1 min-w-0', collapsed && 'justify-center px-2')}
      >
        {cover ? (
          <img src={cover} alt="" className="w-5 h-5 rounded flex-shrink-0 object-cover" />
        ) : (
          <Globe className="w-5 h-5 flex-shrink-0 text-blue-400" />
        )}
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    </div>
  )
}

function NeteasePlaylistItem({
  playlist,
  collapsed,
}: {
  playlist: NeteasePlaylistSummary
  collapsed: boolean
}) {
  return (
    <NavLink
      to={`/netease-playlist/${playlist.id}`}
      className={({ isActive }) =>
        cn(
          'sidebar-item w-full min-w-0',
          isActive && 'active',
          collapsed && 'justify-center px-2',
        )
      }
      title={playlist.name}
    >
      {playlist.cover ? (
        <img src={playlist.cover} alt="" className="w-5 h-5 rounded flex-shrink-0 object-cover" />
      ) : (
        <Cloud className="w-5 h-5 flex-shrink-0 text-red-400" />
      )}
      {!collapsed && (
        <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  const navigate = useNavigate()
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const setShowCreatePlaylistModal = useUIStore((s) => s.setShowCreatePlaylistModal)
  const setShowImportPlaylistModal = useUIStore((s) => s.setShowImportPlaylistModal)
  const [isMac, setIsMac] = useState(false)
  const [neteaseFoldState, setNeteaseFoldState] = useState<NeteaseFoldState>(readNeteaseFoldState)

  useEffect(() => {
    if (window.electronAPI?.getPlatform) {
      window.electronAPI.getPlatform().then(p => setIsMac(p === 'darwin'))
    }
  }, [])

  const playlists = useUserStore((s) => s.playlists)
  const localPlaylists = useUserStore((s) => s.localPlaylists)
  const onlinePlaylists = useUserStore((s) => s.onlinePlaylists)
  const reorderPlaylists = useUserStore((s) => s.reorderPlaylists)
  const reorderLocalPlaylists = useUserStore((s) => s.reorderLocalPlaylists)
  const reorderOnlinePlaylists = useUserStore((s) => s.reorderOnlinePlaylists)
  const isNeteaseLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const neteaseUserData = useAuthStore((s) => s.userData)
  const neteaseCookie = useAuthStore((s) => s.cookie)
  const userPlaylists = useAuthStore((s) => s.userPlaylists)
  const refreshUserPlaylists = useAuthStore((s) => s.refreshUserPlaylists)

  useEffect(() => {
    if (!isNeteaseLoggedIn || !neteaseUserData?.userId || !neteaseCookie) return

    const hasCurrentUserCache = userPlaylists.userId === neteaseUserData.userId
    const hasGroupedCache = Array.isArray(userPlaylists.createdPlaylists) && Array.isArray(userPlaylists.collectedPlaylists)
    const isStale = !userPlaylists.lastUpdated || Date.now() - userPlaylists.lastUpdated > 5 * 60 * 1000

    if (!hasCurrentUserCache || !hasGroupedCache || isStale) {
      void refreshUserPlaylists()
    }
  }, [
    isNeteaseLoggedIn,
    neteaseUserData?.userId,
    neteaseCookie,
    userPlaylists.userId,
    userPlaylists.createdPlaylists,
    userPlaylists.collectedPlaylists,
    userPlaylists.lastUpdated,
    refreshUserPlaylists,
  ])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const allSortableIds = [
    ...playlists.map((p) => encodeSortableId('custom', p.id)),
    ...localPlaylists.map((p) => encodeSortableId('local', p.id)),
    ...onlinePlaylists.map((p) => encodeSortableId('online', p.id)),
  ]

  const mainNavItems = [
    { icon: Home, label: '主页', path: '/' },
    { icon: HardDrive, label: '本地音乐', path: '/library' },
  ]

  const createdNeteasePlaylists = userPlaylists.userId === neteaseUserData?.userId
    ? userPlaylists.createdPlaylists ?? userPlaylists.playlists.filter((playlist) => (
      playlist.creator?.userId === neteaseUserData?.userId || !playlist.subscribed
    ))
    : []
  const collectedNeteasePlaylists = userPlaylists.userId === neteaseUserData?.userId
    ? userPlaylists.collectedPlaylists ?? userPlaylists.playlists.filter((playlist) => (
      playlist.creator?.userId !== neteaseUserData?.userId && playlist.subscribed
    ))
    : []
  const hasNeteasePlaylistSection = isNeteaseLoggedIn
  const hasNeteasePlaylists = createdNeteasePlaylists.length > 0 || collectedNeteasePlaylists.length > 0
  const neteasePlaylistStatusText = userPlaylists.lastUpdated ? '暂无歌单' : '加载中...'

  const handleCreatePlaylist = () => {
    setShowCreatePlaylistModal(true)
  }

  const toggleNeteaseFold = (key: keyof NeteaseFoldState) => {
    setNeteaseFoldState((current) => {
      const next = { ...current, [key]: !current[key] }
      try {
        window.localStorage.setItem(NETEASE_SIDEBAR_FOLD_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeParsed = decodeSortableId(active.id as string)
    const overParsed = decodeSortableId(over.id as string)

    if (activeParsed.section === overParsed.section) {
      // Same section - reorder within
      if (activeParsed.section === 'custom') {
        const oldIndex = playlists.findIndex((p) => p.id === activeParsed.id)
        const newIndex = playlists.findIndex((p) => p.id === overParsed.id)
        if (oldIndex !== -1 && newIndex !== -1) reorderPlaylists(oldIndex, newIndex)
      } else if (activeParsed.section === 'local') {
        const oldIndex = localPlaylists.findIndex((p) => p.id === activeParsed.id)
        const newIndex = localPlaylists.findIndex((p) => p.id === overParsed.id)
        if (oldIndex !== -1 && newIndex !== -1) reorderLocalPlaylists(oldIndex, newIndex)
      } else {
        const oldIndex = onlinePlaylists.findIndex((p) => p.id === activeParsed.id)
        const newIndex = onlinePlaylists.findIndex((p) => p.id === overParsed.id)
        if (oldIndex !== -1 && newIndex !== -1) reorderOnlinePlaylists(oldIndex, newIndex)
      }
    } else {
      // Cross-section - move between lists
      useUserStore.getState().movePlaylistBetweenSections(
        activeParsed.section,
        activeParsed.id,
        overParsed.section,
        overParsed.id,
      )
    }
  }

  const renderSectionHeader = (
    title: string,
    options?: {
      className?: string
      actionIcon?: LucideIcon
      actionTitle?: string
      onAction?: () => void
      extraActions?: Array<{
        icon: LucideIcon
        title: string
        onClick: () => void
      }>
    },
  ) => {
    if (sidebarCollapsed) return null

    const ActionIcon = options?.actionIcon
    const hasExtraActions = options?.extraActions && options.extraActions.length > 0

    return (
      <div className={cn('flex items-center justify-between mb-1', options?.className)}>
        <span className="font-medium text-[var(--text-muted)] uppercase tracking-wider truncate px-1 py-1">
          {title}
        </span>
        {ActionIcon && options?.onAction && (
          hasExtraActions ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                  title={options.actionTitle}
                >
                  <ActionIcon className="w-4 h-4 text-[var(--text-muted)]" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-[140px] bg-white dark:bg-gray-800 rounded-lg shadow-xl p-1 z-50 border border-gray-200 dark:border-gray-700"
                  sideOffset={4}
                  align="end"
                >
                  <DropdownMenu.Item
                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                    onSelect={options.onAction}
                  >
                    <ActionIcon className="w-4 h-4 text-[var(--text-muted)]" />
                    {options.actionTitle}
                  </DropdownMenu.Item>
                  {options.extraActions?.map((action, index) => (
                    <DropdownMenu.Item
                      key={index}
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                      onSelect={action.onClick}
                    >
                      <action.icon className="w-4 h-4 text-[var(--text-muted)]" />
                      {action.title}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <button
              onClick={(event) => {
                event.stopPropagation()
                options.onAction?.()
              }}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
              title={options.actionTitle}
            >
              <ActionIcon className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
          )
        )}
      </div>
    )
  }

  const renderNeteaseSubsection = (
    key: 'created' | 'collected',
    title: string,
    playlists: NeteasePlaylistSummary[],
  ) => {
    if (playlists.length === 0) return null

    if (sidebarCollapsed) {
      return playlists.map((playlist) => (
        <NeteasePlaylistItem key={`${key}-${playlist.id}`} playlist={playlist} collapsed={sidebarCollapsed} />
      ))
    }

    const isExpanded = neteaseFoldState[key]
    const SubsectionIcon = isExpanded ? ChevronDown : ChevronRight

    return (
      <div className="space-y-0.5">
        <button
          onClick={() => toggleNeteaseFold(key)}
          className="flex w-full items-center gap-1 px-1 pt-1.5 pb-0.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          aria-expanded={isExpanded}
        >
          <SubsectionIcon className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <span className="text-[10px]">{playlists.length}</span>
        </button>
        {isExpanded && playlists.map((playlist) => (
          <NeteasePlaylistItem key={`${key}-${playlist.id}`} playlist={playlist} collapsed={sidebarCollapsed} />
        ))}
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'fixed left-0 bottom-20 z-30 flex flex-col',
        'bg-[var(--panel-bg)]',
        'transition-all duration-300',
        sidebarCollapsed ? 'w-20' : 'w-56',
        isMac ? 'top-0' : 'top-8',
      )}
      style={{ backdropFilter: 'blur(var(--panel-backdrop-blur))' }}
    >
      {isMac && <div className="h-10 drag-region flex-shrink-0" />}

      <button
        onClick={() => useUIStore.getState().toggleSidebar()}
        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        className={cn(
          'group absolute -right-3 z-50 flex h-7 w-7 items-center justify-center',
          'rounded-full border border-black/5 dark:border-white/10',
          'bg-white/80 dark:bg-gray-800/80 backdrop-blur-md',
          'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          'shadow-[0_2px_8px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.4)]',
          'hover:shadow-[0_4px_14px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_4px_14px_rgba(0,0,0,0.5)]',
          'hover:bg-white dark:hover:bg-gray-800 hover:scale-110 active:scale-95',
          'transition-all duration-200 ease-out',
          isMac ? 'top-14' : 'top-6',
        )}
      >
        {sidebarCollapsed ? (
          <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2.5} />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" strokeWidth={2.5} />
        )}
      </button>

      <nav className="p-3 space-y-0.5">
        {mainNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'sidebar-item text-base',
                isActive && 'active',
                sidebarCollapsed && 'justify-center px-2',
              )
            }
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {!sidebarCollapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-3 space-y-0.5 scrollbar-hide">
        {!sidebarCollapsed && (
          <div className="px-1 pt-1 pb-1">
            <span className="font-medium text-[var(--text-muted)] uppercase tracking-wider">收藏</span>
          </div>
        )}
        <button
          onClick={() => navigate('/favorites')}
          className={cn('sidebar-item w-full', sidebarCollapsed && 'justify-center px-2')}
        >
          <Heart className="w-5 h-5 flex-shrink-0 text-red-400" />
          {!sidebarCollapsed && <span>在线收藏</span>}
        </button>
        <button
          onClick={() => navigate('/local-favorites')}
          className={cn('sidebar-item w-full', sidebarCollapsed && 'justify-center px-2')}
        >
          <Heart className="w-5 h-5 flex-shrink-0 text-pink-400" />
          {!sidebarCollapsed && <span>本地收藏</span>}
        </button>

        {renderSectionHeader('歌单', {
          className: 'mt-4',
          actionIcon: Plus,
          actionTitle: '新建歌单',
          onAction: handleCreatePlaylist,
          extraActions: [
            {
              icon: Download,
              title: '导入歌单',
              onClick: () => setShowImportPlaylistModal(true),
            },
          ],
        })}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={allSortableIds} strategy={verticalListSortingStrategy}>
            {!sidebarCollapsed && playlists.length > 0 && (
              <div className="px-1 pt-1.5 pb-0.5">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">自建歌单</span>
              </div>
            )}
            {playlists.map((playlist) => {
              const cover = playlist.cover || playlist.songs[0]?.cover
              return (
                <SortablePlaylistItem
                  key={playlist.id}
                  sortableId={encodeSortableId('custom', playlist.id)}
                  cover={cover}
                  label={playlist.name}
                  to={`/playlist/${playlist.id}`}
                  collapsed={sidebarCollapsed}
                  icon={<ListMusic className="w-5 h-5 flex-shrink-0" />}
                />
              )
            })}

            {!sidebarCollapsed && localPlaylists.length > 0 && (
              <div className="px-1 pt-1.5 pb-0.5">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">本地歌单</span>
              </div>
            )}
            {localPlaylists.map((playlist) => {
              const cover = playlist.cover || playlist.songs[0]?.cover
              return (
                <SortablePlaylistItem
                  key={playlist.id}
                  sortableId={encodeSortableId('local', playlist.id)}
                  cover={cover}
                  label={playlist.name}
                  to={`/playlist/${playlist.id}`}
                  collapsed={sidebarCollapsed}
                  icon={<ListMusic className="w-5 h-5 flex-shrink-0" />}
                />
              )
            })}

            {!sidebarCollapsed && onlinePlaylists.length > 0 && (
              <div className="px-1 pt-1.5 pb-0.5">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">在线歌单</span>
              </div>
            )}
            {onlinePlaylists.map((playlist) => {
              const cover = playlist.cover || playlist.songs[0]?.cover
              return (
                <SortableOnlinePlaylistItem
                  key={playlist.id}
                  sortableId={encodeSortableId('online', playlist.id)}
                  cover={cover}
                  label={playlist.name}
                  onClick={() => navigate(getOnlinePlaylistBrowsePath(playlist))}
                  collapsed={sidebarCollapsed}
                />
              )
            })}
          </SortableContext>
        </DndContext>

        {hasNeteasePlaylistSection && (
          <div className={cn(!sidebarCollapsed && 'mt-4')}>
            {sidebarCollapsed ? (
              <button
                onClick={() => navigate('/netease-home')}
                className="sidebar-item w-full justify-center px-2"
                title="小芸歌单"
                aria-label="小芸歌单"
              >
                <Cloud className="w-5 h-5 flex-shrink-0 text-red-400" />
              </button>
            ) : (
              <button
                onClick={() => toggleNeteaseFold('root')}
                className="flex w-full items-center justify-between px-1 py-1 text-left text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                aria-expanded={neteaseFoldState.root}
              >
                <span className="font-medium uppercase tracking-wider truncate">小芸歌单</span>
                {neteaseFoldState.root ? (
                  <ChevronDown className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 flex-shrink-0" />
                )}
              </button>
            )}

            {(sidebarCollapsed || neteaseFoldState.root) && (
              <div className="space-y-0.5">
                {hasNeteasePlaylists ? (
                  <>
                    {renderNeteaseSubsection('created', '创建的歌单', createdNeteasePlaylists)}
                    {renderNeteaseSubsection('collected', '收藏的歌单', collectedNeteasePlaylists)}
                  </>
                ) : !sidebarCollapsed ? (
                  <div className="px-1 py-2 text-xs text-[var(--text-muted)]">{neteasePlaylistStatusText}</div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>

    </aside>
  )
}
