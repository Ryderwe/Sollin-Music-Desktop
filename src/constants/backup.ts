import type { BackupItemKey, BackupSelection } from '@/types/backup'

export const BACKUP_ITEM_ORDER: BackupItemKey[] = [
  'onlineFavorites',
  'onlinePlaylists',
  'neteaseCookie',
  'lxSources',
] as const

export const BACKUP_ITEM_META: Record<BackupItemKey, { label: string; description: string }> = {
  onlineFavorites: {
    label: '在线喜欢',
    description: '恢复后会覆盖当前在线喜欢数据',
  },
  onlinePlaylists: {
    label: '导入歌单',
    description: '恢复后会覆盖当前资料库中已导入的歌单',
  },
  neteaseCookie: {
    label: '云音乐 Cookie',
    description: '用于恢复网易云登录态，不包含桌面端设置',
  },
  lxSources: {
    label: 'LX 音源',
    description: '包含已导入的 LX JS 音源和当前生效音源',
  },
}

export const createBackupSelection = (value = true): BackupSelection => ({
  onlineFavorites: value,
  onlinePlaylists: value,
  neteaseCookie: value,
  lxSources: value,
})

export const getSelectedBackupItemKeys = (selection: BackupSelection) => {
  return BACKUP_ITEM_ORDER.filter((key) => selection[key])
}

export const hasSelectedBackupItems = (selection: BackupSelection) => {
  return getSelectedBackupItemKeys(selection).length > 0
}

export const formatBackupItemLabels = (items: BackupItemKey[]) => {
  return items.map((item) => BACKUP_ITEM_META[item].label).join('、')
}
