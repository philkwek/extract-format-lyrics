import { useEffect, useState } from 'react'
import {
  THEME_CHANGED_EVENT,
  applyTheme,
  getInitialThemeMode,
  isThemeMode,
  nextThemeMode,
  resolveThemeIsDark,
  saveThemeMode,
  watchSystemTheme,
  type ThemeChangedDetail,
  type ThemeMode,
} from './theme'

export interface ThemeModeControls {
  mode: ThemeMode
  isDark: boolean
  setMode: (mode: ThemeMode) => void
  cycleMode: () => void
}

/**
 * Keeps the document theme in sync with the selected mode, including live
 * OS-level light/dark changes while the mode is "system".
 */
export function useThemeMode(): ThemeModeControls {
  const [mode, setModeState] = useState<ThemeMode>(getInitialThemeMode)
  const [isDark, setIsDark] = useState<boolean>(() => resolveThemeIsDark(getInitialThemeMode()))

  useEffect(() => {
    applyTheme(isDark)
  }, [isDark])

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<ThemeChangedDetail>).detail
      if (!detail) return
      if (isThemeMode(detail.mode)) setModeState(detail.mode)
      if (typeof detail.isDark === 'boolean') setIsDark(detail.isDark)
    }

    window.addEventListener(THEME_CHANGED_EVENT, handleThemeChange)
    return () => window.removeEventListener(THEME_CHANGED_EVENT, handleThemeChange)
  }, [])

  useEffect(() => {
    if (mode !== 'system') return
    return watchSystemTheme(setIsDark)
  }, [mode])

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode)
    setIsDark(resolveThemeIsDark(nextMode))
    saveThemeMode(nextMode)
  }

  const cycleMode = () => setMode(nextThemeMode(mode))

  return { mode, isDark, setMode, cycleMode }
}
