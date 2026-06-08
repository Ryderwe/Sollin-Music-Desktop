// Structured lyric model used by the new lyric sources (ported from Lyrico).
// Times are absolute milliseconds.

export interface LyricsWord {
  start: number
  end: number
  text: string
}

export interface LyricsLine {
  start: number
  end: number
  words: LyricsWord[]
}

export interface LyricsResult {
  tags: Record<string, string>
  original: LyricsLine[]
  translated?: LyricsLine[] | null
  romanization?: LyricsLine[] | null
  isWordByWord: boolean
}

export const isWordByWord = (lines: LyricsLine[]): boolean =>
  lines.some((line) => line.words.length > 1)
