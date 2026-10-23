const THEME_STORAGE_KEY = 'app_theme'
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

export const THEME_CHANGED_EVENT = 'app_theme_changed'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ThemeChangedDetail {
  mode: ThemeMode
  isDark: boolean
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function getInitialThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeMode(stored)) return stored
  } catch {
    // fallback
  }
  return 'system'
}

export function systemPrefersDark(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia(SYSTEM_THEME_QUERY).matches
    }
  } catch {
    // fallback
  }
  return true
}

export function resolveThemeIsDark(mode: ThemeMode): boolean {
  if (mode === 'system') return systemPrefersDark()
  return mode === 'dark'
}

export function applyTheme(isDark: boolean): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (isDark) {
    root.classList.add('dark')
    root.style.colorScheme = 'dark'
  } else {
    root.classList.remove('dark')
    root.style.colorScheme = 'light'
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
  const isDark = resolveThemeIsDark(mode)
  applyTheme(isDark)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<ThemeChangedDetail>(THEME_CHANGED_EVENT, {
        detail: { mode, isDark },
      }),
    )
  }
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  if (mode === 'light') return 'dark'
  if (mode === 'dark') return 'system'
  return 'light'
}

/**
 * Subscribes to OS-level light/dark preference changes. Returns a no-op
 * unsubscribe when the browser does not expose matchMedia.
 */
export function watchSystemTheme(onChange: (isDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }

  try {
    const query = window.matchMedia(SYSTEM_THEME_QUERY)
    const handleChange = () => onChange(query.matches)

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', handleChange)
      return () => query.removeEventListener('change', handleChange)
    }

    query.addListener(handleChange)
    return () => query.removeListener(handleChange)
  } catch {
    return () => {}
  }
}
