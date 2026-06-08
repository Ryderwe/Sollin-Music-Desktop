export type GlobalShortcutAction = 'playPause' | 'previous' | 'next'

export type GlobalShortcutConfig = Record<GlobalShortcutAction, string | null>

export type GlobalShortcutRegistrationStatus = {
  accelerator: string | null
  registered: boolean
  error?: string
}

export type GlobalShortcutStatusMap = Record<GlobalShortcutAction, GlobalShortcutRegistrationStatus>

export type GlobalShortcutState = {
  config: GlobalShortcutConfig
  status: GlobalShortcutStatusMap
}

export const DEFAULT_GLOBAL_SHORTCUTS: GlobalShortcutConfig = {
  playPause: 'MediaPlayPause',
  previous: 'MediaPreviousTrack',
  next: 'MediaNextTrack',
}

export const GLOBAL_SHORTCUT_ITEMS: Array<{
  action: GlobalShortcutAction
  label: string
  description: string
}> = [
  {
    action: 'playPause',
    label: '播放 / 暂停',
    description: '控制当前歌曲的播放与暂停',
  },
  {
    action: 'previous',
    label: '上一首',
    description: '切换到播放列表中的上一首歌曲',
  },
  {
    action: 'next',
    label: '下一首',
    description: '切换到播放列表中的下一首歌曲',
  },
]

const PLATFORM_MAC = 'darwin'

const KEY_CODE_TO_ACCELERATOR: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  MediaPlayPause: 'MediaPlayPause',
  MediaTrackPrevious: 'MediaPreviousTrack',
  MediaTrackNext: 'MediaNextTrack',
  MediaStop: 'MediaStop',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown',
  AudioVolumeMute: 'VolumeMute',
}

const MODIFIER_KEYS = new Set([
  'Meta',
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
])

export const createEmptyGlobalShortcutStatus = (config: GlobalShortcutConfig): GlobalShortcutStatusMap => ({
  playPause: { accelerator: config.playPause, registered: false },
  previous: { accelerator: config.previous, registered: false },
  next: { accelerator: config.next, registered: false },
})

export const formatGlobalShortcut = (accelerator: string | null, platform: string) => {
  if (!accelerator) return '未设置'

  switch (accelerator) {
    case 'MediaPlayPause':
      return '系统播放 / 暂停键'
    case 'MediaPreviousTrack':
      return '系统上一曲键'
    case 'MediaNextTrack':
      return '系统下一曲键'
    case 'MediaStop':
      return '系统停止键'
    default:
      break
  }

  return accelerator
    .split('+')
    .map((token) => formatGlobalShortcutToken(token, platform))
    .join(' + ')
}

const formatGlobalShortcutToken = (token: string, platform: string) => {
  const normalizedToken = token.trim()
  const isMac = platform === PLATFORM_MAC

  switch (normalizedToken) {
    case 'CommandOrControl':
    case 'CmdOrCtrl':
      return isMac ? 'Cmd' : 'Ctrl'
    case 'Command':
    case 'Cmd':
      return isMac ? 'Cmd' : 'Command'
    case 'Control':
    case 'Ctrl':
      return isMac ? 'Control' : 'Ctrl'
    case 'Alt':
    case 'Option':
      return isMac ? 'Option' : 'Alt'
    case 'Shift':
      return 'Shift'
    case 'Super':
    case 'Meta':
      return isMac ? 'Cmd' : 'Win'
    case 'Escape':
    case 'Esc':
      return 'Esc'
    case 'Enter':
    case 'Return':
      return 'Enter'
    case 'PageUp':
      return 'PgUp'
    case 'PageDown':
      return 'PgDn'
    default:
      break
  }

  if (/^num[0-9]$/i.test(normalizedToken)) {
    return `Num ${normalizedToken.slice(3)}`
  }

  if (/^num(add|sub|mult|div|dec)$/i.test(normalizedToken)) {
    const shortToken = normalizedToken.slice(3).toLowerCase()
    switch (shortToken) {
      case 'add':
        return 'Num +'
      case 'sub':
        return 'Num -'
      case 'mult':
        return 'Num *'
      case 'div':
        return 'Num /'
      case 'dec':
        return 'Num .'
      default:
        break
    }
  }

  return normalizedToken.length === 1
    ? normalizedToken.toUpperCase()
    : normalizedToken
}

export const keyboardEventToAccelerator = (event: KeyboardEvent): string | null => {
  const keyToken = getAcceleratorKeyFromEvent(event)
  if (!keyToken) return null

  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) {
    modifiers.push('CommandOrControl')
  }
  if (event.altKey) {
    modifiers.push('Alt')
  }
  if (event.shiftKey) {
    modifiers.push('Shift')
  }

  const requiresModifier = !/^F\d{1,2}$/i.test(keyToken)
    && !/^Media/.test(keyToken)
    && !/^Volume/.test(keyToken)
    && !/^num/i.test(keyToken)

  if (requiresModifier && modifiers.length === 0) {
    return null
  }

  return [...modifiers, keyToken].join('+')
}

const getAcceleratorKeyFromEvent = (event: KeyboardEvent) => {
  if (MODIFIER_KEYS.has(event.key)) return null

  if (/^Key[A-Z]$/.test(event.code)) {
    return event.code.slice(3)
  }

  if (/^Digit[0-9]$/.test(event.code)) {
    return event.code.slice(5)
  }

  if (/^F\d{1,2}$/.test(event.code)) {
    return event.code
  }

  if (/^Numpad[0-9]$/.test(event.code)) {
    return `num${event.code.slice(6)}`
  }

  switch (event.code) {
    case 'NumpadDecimal':
      return 'numdec'
    case 'NumpadAdd':
      return 'numadd'
    case 'NumpadSubtract':
      return 'numsub'
    case 'NumpadMultiply':
      return 'nummult'
    case 'NumpadDivide':
      return 'numdiv'
    default:
      break
  }

  return KEY_CODE_TO_ACCELERATOR[event.code] || KEY_CODE_TO_ACCELERATOR[event.key] || null
}
