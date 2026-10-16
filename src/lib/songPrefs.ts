export interface SongDisplayPrefs {
  columns: 1 | 2 | 3
  fontSizePx: number
  darkMode: boolean
  simplified?: boolean
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
  }
}

const PREF_PREFIX = 'song_pref:'

export function getSongPrefs(songId: string, width?: number): SongDisplayPrefs {
  const defaultPrefs = getDefaultSongPrefs(width)
  try {
    const raw = localStorage.getItem(`${PREF_PREFIX}${songId}`)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<SongDisplayPrefs> & { columns?: unknown }
      const columns =
        stored.columns === 1 || stored.columns === 2 || stored.columns === 3
          ? stored.columns
          : defaultPrefs.columns
      return { ...defaultPrefs, ...stored, columns }
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
