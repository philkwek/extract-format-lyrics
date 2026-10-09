import { useState, useEffect } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import SessionPage from './pages/SessionPage'
import { getInitialTheme, saveTheme, applyTheme } from './lib/theme'

function App() {
  const [isDark, setIsDark] = useState<boolean>(getInitialTheme)

  useEffect(() => {
    applyTheme(isDark)
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ isDark: boolean }>
      if (customEvent.detail && typeof customEvent.detail.isDark === 'boolean') {
        setIsDark(customEvent.detail.isDark)
      }
    }
    window.addEventListener('app_theme_changed', handleThemeChange)
    return () => {
      window.removeEventListener('app_theme_changed', handleThemeChange)
    }
  }, [isDark])

  const toggleTheme = () => {
    const next = !isDark
    setIsDark(next)
    saveTheme(next)
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-[#101010] dark:text-[#e5e5e5] transition-colors">
        <header className="flex items-center justify-between border-b border-neutral-200 dark:border-[#282828] px-4 py-3 bg-white/80 dark:bg-[#101010]/90 backdrop-blur sticky top-0 z-30">
          <Link to="/" className="text-lg font-semibold tracking-tight dark:text-[#e5e5e5] hover:text-amber-500 transition-colors">
            Chord Sheets
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/search" className="text-sm text-neutral-600 dark:text-[#999999] hover:text-amber-500 transition-colors underline">
              Search
            </Link>
            <button
              onClick={toggleTheme}
              className="p-1.5 px-2.5 rounded-lg border border-neutral-300 dark:border-[#282828] bg-neutral-100 dark:bg-[#1a1a1a] text-neutral-700 dark:text-[#e5e5e5] hover:bg-neutral-200 dark:hover:bg-[#252525] transition-colors text-xs font-medium cursor-pointer flex items-center gap-1.5"
              title="Toggle light / dark mode"
            >
              <span>{isDark ? '🌙' : '☀️'}</span>
              <span>{isDark ? 'Dark' : 'Light'}</span>
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-5xl p-4">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/session/:sessionId" element={<SessionPage />} />
            <Route path="/search" element={<SearchPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
