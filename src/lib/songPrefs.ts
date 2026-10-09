export interface SongDisplayPrefs {
  columns: 1 | 2 | 3 | 'fit'
  fontSizePx: number
  darkMode: boolean
}

const DEFAULT_PREFS: SongDisplayPrefs = {
  columns: 1,
  fontSizePx: 14,
  darkMode: true,
}

const PREF_PREFIX = 'song_pref:'

export function getSongPrefs(songId: string): SongDisplayPrefs {
  try {
    const raw = localStorage.getItem(`${PREF_PREFIX}${songId}`)
    if (raw) {
      return { ...DEFAULT_PREFS, ...JSON.parse(raw) }
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
