import { useEffect, useMemo } from 'react'
import { ArrowDown, ArrowUp, RotateCcw, Zap } from 'lucide-react'
import {
  useSourceSwitchSettingsStore,
  type SourceSwitchStageId,
} from '@/stores/sourceSwitchSettingsStore'
import { lxSourceApi } from '@/services/lxSource'
import { getPlatformName } from '@/constants/platform'
import { cn } from '@/utils/cn'
import type { Platform } from '@/types'

const STAGE_LABELS: Record<SourceSwitchStageId, { title: string; desc: string }> = {
  origin: {
    title: '使用原平台',
    desc: '先尝试用当前 LX 脚本解析歌曲所属平台的播放链接',
  },
  findMusic: {
    title: '跨平台找同名',
    desc: '原平台无法播放时，在其他平台搜索同名同歌手的替身曲目',
  },
  scripts: {
    title: '其他 LX 脚本',
    desc: '原平台仍不行时，依次使用已导入的其他脚本再次尝试',
  },
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
        {title}
      </div>
      {hint ? (
        <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
          {hint}
        </div>
      ) : null}
    </div>
  )
}

function MoveButtons({
  onUp,
  onDown,
  disabledUp,
  disabledDown,
}: {
  onUp: () => void
  onDown: () => void
  disabledUp: boolean
  disabledDown: boolean
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={onUp}
        disabled={disabledUp}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="上移"
      >
        <ArrowUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={disabledDown}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="下移"
      >
        <ArrowDown className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  size = 'md',
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  size?: 'md' | 'sm'
}) {
  const dims = size === 'sm'
    ? 'h-5 w-9 [&>span]:h-3.5 [&>span]:w-3.5'
    : 'h-6 w-11 [&>span]:h-4 [&>span]:w-4'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex items-center rounded-full transition-colors shrink-0',
        dims,
        checked ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full bg-white transition-transform',
          checked
            ? size === 'sm' ? 'translate-x-4' : 'translate-x-5'
            : 'translate-x-1',
        )}
      />
    </button>
  )
}

export default function SourceSwitchSettingsPanel() {
  const {
    enabled,
    rememberToggleChoices,
    stages,
    platformOrder,
    platformEnabled,
    scriptOrder,
    scriptEnabled,
    setEnabled,
    setRememberToggleChoices,
    setStageEnabled,
    moveStage,
    setPlatformEnabled,
    movePlatform,
    resetPlatformOrder,
    setScriptEnabled,
    moveScript,
    syncScriptList,
  } = useSourceSwitchSettingsStore()

  // Fetch the live list of imported LX scripts once so the "cross script" section reflects the
  // user's current scripts (new imports get appended, removed ones get dropped).
  useEffect(() => {
    let cancelled = false
    lxSourceApi
      .getStatus()
      .then((status) => {
        if (cancelled) return
        const ids = (status.managedSources || []).map((src) => src.id)
        syncScriptList(ids)
      })
      .catch((error) => {
        console.warn('[SourceSwitchSettings] refresh script list failed:', error)
      })
    return () => {
      cancelled = true
    }
  }, [syncScriptList])

  const scriptMeta = useMemo(() => new Map<string, { name: string; exists: boolean; isActive: boolean }>(), [])
  // Populate script metadata from the live status for display purposes only.  We do not store
  // anything beyond the id in persistent settings so the source of truth stays in lxSourceApi.
  useEffect(() => {
    let cancelled = false
    lxSourceApi
      .getStatus()
      .then((status) => {
        if (cancelled) return
        scriptMeta.clear()
        for (const item of status.managedSources || []) {
          scriptMeta.set(item.id, {
            name: item.scriptInfo?.name || '未命名脚本',
            exists: item.exists,
            isActive: Boolean(item.isActive),
          })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [scriptMeta, scriptOrder.length])

  const stageCount = stages.length

  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden')}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700/60">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="font-medium text-sm">智能换源流程</div>
            <div className="text-[11px] text-[var(--text-muted)]">
              自定义「原音源失败时」的解析顺序与启用项
            </div>
          </div>
        </div>
        <ToggleSwitch checked={enabled} onChange={setEnabled} />
      </div>

      <div className={cn('p-4 space-y-5 transition-opacity', !enabled && 'opacity-60 pointer-events-none')}>
        <div className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2.5">
          <div className="flex-1">
            <div className="text-xs font-medium">记住跨平台换源结果</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
              开启后：同一首歌下次播放会优先复用上次成功的替身，避免重复搜索。关闭则每次都重新 findMusic。
            </div>
          </div>
          <ToggleSwitch size="sm" checked={rememberToggleChoices} onChange={setRememberToggleChoices} />
        </div>

        <div className="space-y-2.5">
          <SectionTitle title="阶段顺序" hint="按从上到下的顺序执行；关闭后对应阶段直接跳过" />
          <div className="space-y-1.5">
            {stages.map((stage, index) => {
              const label = STAGE_LABELS[stage.id]
              return (
                <div
                  key={stage.id}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border border-gray-200/80 bg-white px-2.5 py-2',
                    'dark:border-gray-700/60 dark:bg-gray-900/40',
                    !stage.enabled && 'opacity-60',
                  )}
                >
                  <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary-50 text-primary-600 text-[11px] font-semibold dark:bg-primary-500/15 dark:text-primary-300">
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {label.title}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">
                      {label.desc}
                    </div>
                  </div>
                  <MoveButtons
                    onUp={() => moveStage(stage.id, -1)}
                    onDown={() => moveStage(stage.id, 1)}
                    disabledUp={index === 0}
                    disabledDown={index === stageCount - 1}
                  />
                  <ToggleSwitch size="sm" checked={stage.enabled} onChange={(next) => setStageEnabled(stage.id, next)} />
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <SectionTitle title="跨平台顺序" hint="findMusic 阶段内优先尝试的目标平台（不包含当前歌曲所在平台）" />
            <button
              type="button"
              onClick={resetPlatformOrder}
              className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] dark:text-[var(--text-muted)] dark:hover:text-[var(--text-secondary)] transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              恢复默认
            </button>
          </div>
          <div className="space-y-1.5">
            {platformOrder.map((platform, index) => (
              <PlatformRow
                key={platform}
                platform={platform}
                index={index}
                total={platformOrder.length}
                enabled={platformEnabled[platform] !== false}
                onToggle={(next) => setPlatformEnabled(platform, next)}
                onMoveUp={() => movePlatform(platform, -1)}
                onMoveDown={() => movePlatform(platform, 1)}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2.5">
          <SectionTitle title="跨脚本顺序" hint="scripts 阶段内要尝试的备用 LX 脚本（当前激活脚本自动排除）" />
          {scriptOrder.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
              暂未导入其他 LX 脚本。在下方「LX 音源管理」面板导入后会自动同步到此处。
            </div>
          ) : (
            <div className="space-y-1.5">
              {scriptOrder.map((scriptId, index) => {
                const meta = scriptMeta.get(scriptId)
                const displayName = meta?.name || scriptId
                const exists = meta?.exists !== false
                const isActive = Boolean(meta?.isActive)
                return (
                  <div
                    key={scriptId}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border border-gray-200/80 bg-white px-2.5 py-2',
                      'dark:border-gray-700/60 dark:bg-gray-900/40',
                      (!scriptEnabled[scriptId] || !exists) && 'opacity-60',
                    )}
                  >
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-gray-100 text-[var(--text-secondary)] text-[10px] font-semibold dark:bg-gray-700 dark:text-[var(--text-secondary)]">
                      {index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                          {displayName}
                        </div>
                        {isActive ? (
                          <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300">
                            当前激活
                          </span>
                        ) : null}
                        {!exists ? (
                          <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            文件缺失
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate">
                        {isActive ? '激活脚本不会作为备用被再次调用' : '作为备用脚本在当前脚本失败后尝试'}
                      </div>
                    </div>
                    <MoveButtons
                      onUp={() => moveScript(scriptId, -1)}
                      onDown={() => moveScript(scriptId, 1)}
                      disabledUp={index === 0}
                      disabledDown={index === scriptOrder.length - 1}
                    />
                    <ToggleSwitch
                      size="sm"
                      checked={scriptEnabled[scriptId] !== false}
                      onChange={(next) => setScriptEnabled(scriptId, next)}
                      disabled={!exists}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PlatformRow({
  platform,
  index,
  total,
  enabled,
  onToggle,
  onMoveUp,
  onMoveDown,
}: {
  platform: Platform
  index: number
  total: number
  enabled: boolean
  onToggle: (next: boolean) => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-gray-200/80 bg-white px-2.5 py-2',
        'dark:border-gray-700/60 dark:bg-gray-900/40',
        !enabled && 'opacity-60',
      )}
    >
      <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-gray-100 text-[var(--text-secondary)] text-[10px] font-semibold dark:bg-gray-700 dark:text-[var(--text-secondary)]">
        {index + 1}
      </span>
      <div className="flex-1 text-xs font-medium text-[var(--text-primary)] truncate">
        {getPlatformName(platform)}
      </div>
      <MoveButtons
        onUp={onMoveUp}
        onDown={onMoveDown}
        disabledUp={index === 0}
        disabledDown={index === total - 1}
      />
      <ToggleSwitch size="sm" checked={enabled} onChange={onToggle} />
    </div>
  )
}
