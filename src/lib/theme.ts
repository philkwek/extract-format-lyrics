const THEME_STORAGE_KEY = 'app_theme'

export function getInitialTheme(): boolean {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'dark') return true
    if (stored === 'light') return false
  } catch {
    // fallback
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return true
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

export function saveTheme(isDark: boolean): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light')
  } catch {
    // ignore
  }
  applyTheme(isDark)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app_theme_changed', { detail: { isDark } }))
  }
}
