export interface SongDisplayPrefs {
  columns: 1 | 2 | 3
  fontSizePx: number
  darkMode: boolean
  simplified?: boolean
}

const DEFAULT_PREFS: SongDisplayPrefs = {
  columns: 1,
  fontSizePx: 14,
  darkMode: true,
  simplified: false,
}

const PREF_PREFIX = 'song_pref:'

export function getSongPrefs(songId: string): SongDisplayPrefs {
  try {
    const raw = localStorage.getItem(`${PREF_PREFIX}${songId}`)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<SongDisplayPrefs> & { columns?: unknown }
      const columns = stored.columns === 1 || stored.columns === 2 || stored.columns === 3
        ? stored.columns
        : DEFAULT_PREFS.columns
      return { ...DEFAULT_PREFS, ...stored, columns }
    }
  } catch {
    // fallback
  }
  return DEFAULT_PREFS
}

export function saveSongPrefs(songId: string, prefs: SongDisplayPrefs): void {
  try {
    localStorage.setItem(`${PREF_PREFIX}${songId}`, JSON.stringify(prefs))
  } catch {
    // ignore
  }
}
