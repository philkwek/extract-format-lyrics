import { useEffect } from 'react'

/** Applies the presenter's light or dark theme to the page and puts the old one back after. */
export function usePresenterTheme(theme: 'dark' | 'light' | undefined): void {
  useEffect(() => {
    if (!theme) return
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')
    root.classList.toggle('dark', theme === 'dark')
    return () => {
      root.classList.toggle('dark', wasDark)
    }
  }, [theme])
}
