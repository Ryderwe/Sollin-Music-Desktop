import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileAudio, Save, Tags, X } from 'lucide-react'
import CoverImage from '@/components/ui/CoverImage'
import { useLocalMusicStore } from '@/stores/localMusicStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import { useUserStore } from '@/stores/userStore'
import { buildLocalSongPlaybackLyrics } from '@/services/songPlayback'
import type { LocalSongMetadataDetail, LocalSongMetadataUpdatePayload, Song } from '@/types'

type TagFormState = {
  title: string
  artist: string
  album: string
  albumArtist: string
  composers: string
  genres: string
  year: string
  trackNo: string
  trackTotal: string
  discNo: string
  discTotal: string
  comment: string
  lyrics: string
}

const emptyFormState: TagFormState = {
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  composers: '',
  genres: '',
  year: '',
  trackNo: '',
  trackTotal: '',
  discNo: '',
  discTotal: '',
  comment: '',
  lyrics: '',
}

const formatBytes = (value: number | undefined) => {
  if (!value || value <= 0) return '未知'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

const formatDuration = (seconds: number) => {
  if (!seconds || !Number.isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const formatBitrate = (value: number | undefined) => {
  if (!value || !Number.isFinite(value)) return '未知'
  return `${Math.round(value / 1000)} kbps`
}

const formatSampleRate = (value: number | undefined) => {
  if (!value || !Number.isFinite(value)) return '未知'
  return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz`
}

const buildFormState = (detail: LocalSongMetadataDetail): TagFormState => ({
  title: detail.tags.title || '',
  artist: detail.tags.artist || '',
  album: detail.tags.album || '',
  albumArtist: detail.tags.albumArtist || '',
  composers: detail.tags.composers?.join(', ') || '',
  genres: detail.tags.genres?.join(', ') || '',
  year: detail.tags.year ? String(detail.tags.year) : '',
  trackNo: detail.tags.trackNo ? String(detail.tags.trackNo) : '',
  trackTotal: detail.tags.trackTotal ? String(detail.tags.trackTotal) : '',
  discNo: detail.tags.discNo ? String(detail.tags.discNo) : '',
  discTotal: detail.tags.discTotal ? String(detail.tags.discTotal) : '',
  comment: detail.tags.comment || '',
  lyrics: detail.tags.lyrics || '',
})

const parseStringList = (value: string) => (
  Array.from(new Set(
    value
      .split(/[,，;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ))
)

const parseOptionalPositiveInteger = (value: string) => {
  const normalized = value.trim()
  if (!normalized) return undefined
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('数字字段只能填写正整数')
  }
  return parsed
}

const buildUpdatePayload = (
  detail: LocalSongMetadataDetail,
  formState: TagFormState,
): LocalSongMetadataUpdatePayload => ({
  filePath: detail.filePath,
  rootFolderPath: detail.rootFolderPath,
  tags: {
    title: formState.title.trim() || undefined,
    artist: formState.artist.trim() || undefined,
    album: formState.album.trim() || undefined,
    albumArtist: formState.albumArtist.trim() || undefined,
    composers: parseStringList(formState.composers),
    genres: parseStringList(formState.genres),
    year: parseOptionalPositiveInteger(formState.year),
    trackNo: parseOptionalPositiveInteger(formState.trackNo),
    trackTotal: parseOptionalPositiveInteger(formState.trackTotal),
    discNo: parseOptionalPositiveInteger(formState.discNo),
    discTotal: parseOptionalPositiveInteger(formState.discTotal),
    comment: formState.comment.trim() || undefined,
    lyrics: formState.lyrics.trim() || undefined,
  },
})

const syncUpdatedLocalSongInPlayer = (updatedSong: Song) => {
  if (updatedSong.platform !== 'local' || !updatedSong.localPath) return

  usePlayerStore.setState((state) => {
    let playlistChanged = false
    const replaceLocalSong = (song: Song) => {
      if (song.platform !== 'local' || song.localPath !== updatedSong.localPath) return song
      playlistChanged = true
      return {
        ...song,
        ...updatedSong,
        url: song.url || updatedSong.url,
      }
    }

    const currentSongChanged = Boolean(
      state.currentSong?.platform === 'local' &&
      state.currentSong.localPath === updatedSong.localPath,
    )

    const currentSong = currentSongChanged && state.currentSong
      ? {
          ...state.currentSong,
          ...updatedSong,
          url: state.currentSong.url || updatedSong.url,
        }
      : state.currentSong

    const playlist = state.playlist.map(replaceLocalSong)

    if (!currentSongChanged && !playlistChanged) {
      return state
    }

    const currentLyrics = currentSongChanged
      ? buildLocalSongPlaybackLyrics(updatedSong.lrc)
      : null

    return {
      currentSong,
      playlist,
      lyrics: currentSongChanged ? currentLyrics?.lyrics || null : state.lyrics,
      lyricData: currentSongChanged ? currentLyrics?.lyricData || null : state.lyricData,
      currentLyricIndex: currentSongChanged ? 0 : state.currentLyricIndex,
    }
  })
}

const fieldClassName = 'input'

export default function LocalSongTagEditorModal() {
  const { showLocalSongTagEditorModal, localSongTagEditorSong, closeLocalSongTagEditor, addToast } = useUIStore()
  const replaceSong = useLocalMusicStore((state) => state.replaceSong)
  const refreshSongReferences = useUserStore((state) => state.refreshSongReferences)

  const [detail, setDetail] = useState<LocalSongMetadataDetail | null>(null)
  const [formState, setFormState] = useState<TagFormState>(emptyFormState)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const currentSongPath = localSongTagEditorSong?.localPath || ''

  useEffect(() => {
    if (!showLocalSongTagEditorModal || !currentSongPath) {
      setDetail(null)
      setFormState(emptyFormState)
      setErrorMessage(null)
      setIsLoading(false)
      return
    }

    if (!window.electronAPI?.getLocalSongMetadata) {
      setErrorMessage('当前环境不支持本地标签查看')
      return
    }

    let cancelled = false
    setIsLoading(true)
    setErrorMessage(null)

    void window.electronAPI.getLocalSongMetadata({
      filePath: currentSongPath,
      rootFolderPath: localSongTagEditorSong?.localFolder,
      skipExternalFallback: true,
    }).then((nextDetail) => {
      if (cancelled) return
      setDetail(nextDetail)
      setFormState(buildFormState(nextDetail))
      setIsLoading(false)
    }).catch((error) => {
      if (cancelled) return
      setErrorMessage(error instanceof Error ? error.message : '读取标签失败')
      setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [currentSongPath, localSongTagEditorSong?.localFolder, showLocalSongTagEditorModal])

  const handleFieldChange = (field: keyof TagFormState, value: string) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const metaItems = useMemo(() => {
    if (!detail) return []
    return [
      { label: '文件大小', value: formatBytes(detail.fileSize) },
      { label: '时长', value: formatDuration(detail.duration) },
      { label: '容器格式', value: detail.format || '未知' },
      { label: '编码', value: detail.codec || '未知' },
      { label: '码率', value: formatBitrate(detail.bitrate) },
      { label: '采样率', value: formatSampleRate(detail.sampleRate) },
      { label: '位深', value: detail.bitsPerSample ? `${detail.bitsPerSample} bit` : '未知' },
      { label: '无损', value: detail.lossless == null ? '未知' : (detail.lossless ? '是' : '否') },
    ]
  }, [detail])

  const handleClose = () => {
    if (isSaving) return
    closeLocalSongTagEditor()
  }

  const handleSubmit = async(event: React.FormEvent) => {
    event.preventDefault()
    if (!detail || !window.electronAPI?.updateLocalSongMetadata) return

    try {
      setIsSaving(true)
      setErrorMessage(null)
      const updatedDetail = await window.electronAPI.updateLocalSongMetadata(buildUpdatePayload(detail, formState))
      setDetail(updatedDetail)
      setFormState(buildFormState(updatedDetail))
      replaceSong(updatedDetail.song)
      refreshSongReferences(updatedDetail.song)
      syncUpdatedLocalSongInPlayer(updatedDetail.song)
      addToast({ type: 'success', message: '内嵌标签已保存' })
      closeLocalSongTagEditor()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存标签失败')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {showLocalSongTagEditorModal ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 16 }}
            className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-[#202126]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-gray-200 px-6 py-5 dark:border-gray-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-violet-500">
                  <Tags className="h-5 w-5" />
                  <span className="text-sm font-medium">本地音乐内嵌标签</span>
                </div>
                <h2 className="mt-2 truncate text-2xl font-bold">
                  {detail?.song.name || localSongTagEditorSong?.name || '未命名歌曲'}
                </h2>
                <p className="mt-1 truncate text-sm text-[var(--text-muted)]">
                  {detail?.fileName || localSongTagEditorSong?.localPath || '读取文件信息中'}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="rounded-full p-2 text-[var(--text-muted)] transition-colors hover:bg-gray-100 hover:text-[var(--text-secondary)] dark:hover:bg-gray-800 dark:hover:text-[var(--text-secondary)]"
                aria-label="关闭标签编辑器"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {isLoading ? (
                <div className="flex min-h-[320px] items-center justify-center">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
                </div>
              ) : errorMessage && !detail ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  {errorMessage}
                </div>
              ) : detail ? (
                <form id="local-song-tag-editor-form" className="space-y-6" onSubmit={handleSubmit}>
                  <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                    <div className="space-y-4">
                      <div className="overflow-hidden rounded-3xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40">
                        <div className="aspect-square">
                          <CoverImage
                            src={detail.cover}
                            alt={detail.song.name}
                            className="h-full w-full"
                          />
                        </div>
                        <div className="border-t border-gray-200 px-4 py-3 text-xs text-[var(--text-muted)] dark:border-gray-800 dark:text-[var(--text-muted)]">
                          <div className="inline-flex items-center gap-2">
                            <FileAudio className="h-4 w-4" />
                            <span>封面预览与文件信息</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-800 dark:bg-gray-900/30">
                        <div className="mb-3 text-sm font-semibold">文件信息</div>
                        <div className="space-y-3 text-sm">
                          <div>
                            <div className="text-xs text-[var(--text-muted)]">文件路径</div>
                            <div className="mt-1 break-all text-[var(--text-secondary)]">{detail.filePath}</div>
                          </div>
                          <div>
                            <div className="text-xs text-[var(--text-muted)]">所在目录</div>
                            <div className="mt-1 break-all text-[var(--text-secondary)]">{detail.directoryPath}</div>
                          </div>
                          {detail.modifiedAt ? (
                            <div>
                              <div className="text-xs text-[var(--text-muted)]">最后修改</div>
                              <div className="mt-1 text-[var(--text-secondary)]">
                                {new Date(detail.modifiedAt).toLocaleString('zh-CN', { hour12: false })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900/20">
                        <div className="mb-4 text-sm font-semibold">文件属性</div>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          {metaItems.map((item) => (
                            <div key={item.label} className="rounded-2xl bg-gray-50 px-3 py-3 dark:bg-gray-900/50">
                              <div className="text-xs text-[var(--text-muted)]">{item.label}</div>
                              <div className="mt-1 text-sm font-medium text-[var(--text-secondary)]">{item.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900/20">
                        <div className="mb-4 text-sm font-semibold">基础标签</div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">标题</label>
                            <input
                              value={formState.title}
                              onChange={(event) => handleFieldChange('title', event.target.value)}
                              placeholder={detail.song.name}
                              className={fieldClassName}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">艺术家</label>
                            <input
                              value={formState.artist}
                              onChange={(event) => handleFieldChange('artist', event.target.value)}
                              placeholder={detail.song.artist}
                              className={fieldClassName}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">专辑</label>
                            <input
                              value={formState.album}
                              onChange={(event) => handleFieldChange('album', event.target.value)}
                              placeholder={detail.song.album || '未设置'}
                              className={fieldClassName}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">专辑艺术家</label>
                            <input
                              value={formState.albumArtist}
                              onChange={(event) => handleFieldChange('albumArtist', event.target.value)}
                              placeholder="可选"
                              className={fieldClassName}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">流派</label>
                            <input
                              value={formState.genres}
                              onChange={(event) => handleFieldChange('genres', event.target.value)}
                              placeholder="多个值用逗号分隔"
                              className={fieldClassName}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">作曲</label>
                            <input
                              value={formState.composers}
                              onChange={(event) => handleFieldChange('composers', event.target.value)}
                              placeholder="多个值用逗号分隔"
                              className={fieldClassName}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">年份</label>
                            <input
                              value={formState.year}
                              onChange={(event) => handleFieldChange('year', event.target.value)}
                              placeholder="例如 2024"
                              className={fieldClassName}
                              inputMode="numeric"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900/20">
                        <div className="mb-4 text-sm font-semibold">轨道信息</div>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">音轨号</label>
                            <input
                              value={formState.trackNo}
                              onChange={(event) => handleFieldChange('trackNo', event.target.value)}
                              className={fieldClassName}
                              inputMode="numeric"
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">音轨总数</label>
                            <input
                              value={formState.trackTotal}
                              onChange={(event) => handleFieldChange('trackTotal', event.target.value)}
                              className={fieldClassName}
                              inputMode="numeric"
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">碟号</label>
                            <input
                              value={formState.discNo}
                              onChange={(event) => handleFieldChange('discNo', event.target.value)}
                              className={fieldClassName}
                              inputMode="numeric"
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">碟片总数</label>
                            <input
                              value={formState.discTotal}
                              onChange={(event) => handleFieldChange('discTotal', event.target.value)}
                              className={fieldClassName}
                              inputMode="numeric"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900/20">
                        <div className="mb-4 text-sm font-semibold">文本标签</div>
                        <div className="space-y-4">
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">备注</label>
                            <textarea
                              value={formState.comment}
                              onChange={(event) => handleFieldChange('comment', event.target.value)}
                              rows={4}
                              className={`${fieldClassName} min-h-[100px] resize-y`}
                              placeholder="写入 COMMENT 标签"
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">歌词</label>
                            <textarea
                              value={formState.lyrics}
                              onChange={(event) => handleFieldChange('lyrics', event.target.value)}
                              rows={10}
                              className={`${fieldClassName} min-h-[220px] resize-y`}
                              placeholder="写入内嵌歌词标签"
                            />
                          </div>
                        </div>
                      </div>

                      {errorMessage ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                          {errorMessage}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </form>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-800">
              <button
                type="button"
                onClick={handleClose}
                className="btn-secondary"
                disabled={isSaving}
              >
                取消
              </button>
              <button
                type="submit"
                form="local-song-tag-editor-form"
                className="btn-primary inline-flex items-center gap-2"
                disabled={isLoading || isSaving || !detail}
              >
                {isSaving ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                保存标签
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
