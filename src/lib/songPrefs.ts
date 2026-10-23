import type { SheetColumns } from './songLayout'

export type ManualColumns = SheetColumns

export interface SongDisplayPrefs {
  columns: ManualColumns
  fontSizePx: number
  darkMode: boolean
  simplified?: boolean
  /** Full-screen auto layout. Undefined means "on by default in full screen". */
  fitToScreen?: boolean
  /** Wrap long chord/lyric lines instead of letting them overflow. */
  wrapLines?: boolean
}

export const IPAD_BREAKPOINT_PX = 768

export function getDefaultColumns(width?: number): 1 | 3 {
  const currentWidth =
    typeof width === 'number'
      ? width
      : typeof window !== 'undefined'
        ? window.innerWidth
        : 0
  return currentWidth >= IPAD_BREAKPOINT_PX ? 3 : 1
}

export function getDefaultSongPrefs(width?: number): SongDisplayPrefs {
  return {
    columns: getDefaultColumns(width),
    fontSizePx: 14,
    darkMode: true,
    simplified: false,
    fitToScreen: true,
    wrapLines: true,
  }
}

const PREF_PREFIX = 'song_pref:'

export function getSongPrefs(songId: string, width?: number): SongDisplayPrefs {
  const defaultPrefs = getDefaultSongPrefs(width)
  try {
    const raw = localStorage.getItem(`${PREF_PREFIX}${songId}`)
    if (raw) {
      const stored = JSON.parse(raw) as Omit<
        Partial<SongDisplayPrefs>,
        'columns' | 'fitToScreen'
      > & {
        columns?: unknown
        fitToScreen?: unknown
      }
      const legacyFit = stored.columns === 'fit'
      const columns =
        stored.columns === 1 ||
        stored.columns === 2 ||
        stored.columns === 3 ||
        stored.columns === 4
          ? stored.columns
          : defaultPrefs.columns
      const fitToScreen =
        typeof stored.fitToScreen === 'boolean'
          ? stored.fitToScreen
          : legacyFit || defaultPrefs.fitToScreen
      const wrapLines =
        typeof stored.wrapLines === 'boolean' ? stored.wrapLines : defaultPrefs.wrapLines
      return { ...defaultPrefs, ...stored, columns, fitToScreen, wrapLines }
    }
  } catch {
    // fallback
  }
  return defaultPrefs
}

export function saveSongPrefs(songId: string, prefs: SongDisplayPrefs): void {
  try {
    localStorage.setItem(`${PREF_PREFIX}${songId}`, JSON.stringify(prefs))
  } catch {
    // ignore
  }
}
