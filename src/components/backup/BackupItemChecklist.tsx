import { BACKUP_ITEM_META, BACKUP_ITEM_ORDER } from '@/constants/backup'
import { cn } from '@/utils/cn'
import type { BackupItemKey, BackupSelection } from '@/types/backup'

interface BackupItemChecklistProps {
  selection: BackupSelection
  onChange: (key: BackupItemKey, checked: boolean) => void
  extraText?: Partial<Record<BackupItemKey, string>>
  disabled?: Partial<Record<BackupItemKey, boolean>>
}

export default function BackupItemChecklist({
  selection,
  onChange,
  extraText,
  disabled,
}: BackupItemChecklistProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {BACKUP_ITEM_ORDER.map((key) => {
        const meta = BACKUP_ITEM_META[key]
        const isDisabled = Boolean(disabled?.[key])

        return (
          <label
            key={key}
            className={cn(
              'flex items-start gap-3 rounded-xl border p-3 transition-colors',
              isDisabled
                ? 'cursor-not-allowed border-gray-200 dark:border-gray-700 opacity-55'
                : 'cursor-pointer border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
            )}
          >
            <input
              type="checkbox"
              checked={selection[key]}
              disabled={isDisabled}
              onChange={(event) => onChange(key, event.target.checked)}
              className="mt-1"
            />
            <div className="min-w-0">
              <span className="block font-medium">{meta.label}</span>
              <span className="block text-sm text-[var(--text-muted)] mt-1">{meta.description}</span>
              {extraText?.[key] ? (
                <span className="block text-xs text-[var(--text-muted)] mt-2">{extraText[key]}</span>
              ) : null}
            </div>
          </label>
        )
      })}
    </div>
  )
}
