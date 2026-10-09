import { useState, useEffect } from 'react'
import { BrowserRouter, Link, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import SessionPage from './pages/SessionPage'
import ShareImportPage from './pages/ShareImportPage'
import { getInitialTheme, saveTheme, applyTheme } from './lib/theme'

function HashRedirect() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (location.pathname === '/' && window.location.hash) {
      const hash = window.location.hash
      if (hash.startsWith('#/s/')) {
        const shortId = hash.slice(5)
        if (shortId) {
          navigate(`/s/${shortId}`, { replace: true })
        }
      } else if (hash.startsWith('#/share#')) {
        const payload = hash.slice(8)
        if (payload) {
          navigate(`/share#${payload}`, { replace: true })
        }
      } else if (hash.startsWith('#/share')) {
        const payload = hash.slice(7)
        navigate(`/share${payload}`, { replace: true })
      }
    }
  }, [location.pathname, navigate])

  return null
}

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
      <HashRedirect />
      <div className="min-h-screen bg-[#F2EFE7] text-neutral-900 dark:bg-[#101010] dark:text-[#e5e5e5] transition-colors">
        <header className="flex items-center justify-between border-b border-[#C8DFDB] dark:border-[#282828] px-4 sm:px-[5%] py-3 bg-[#F2EFE7]/85 dark:bg-[#101010]/90 backdrop-blur sticky top-0 z-30">
          <Link to="/" className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-[#e5e5e5] hover:text-[#3368A0] dark:hover:text-amber-500 transition-colors">
            Chord Sheets
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/search" className="text-sm text-neutral-600 dark:text-[#999999] hover:text-[#3368A0] dark:hover:text-amber-500 transition-colors underline">
              Search
            </Link>
            <button
              onClick={toggleTheme}
              className="p-1.5 px-2.5 rounded-lg border border-[#C8DFDB] dark:border-[#282828] bg-white/80 dark:bg-[#1a1a1a] text-neutral-700 dark:text-[#e5e5e5] hover:bg-[#C8DFDB]/40 dark:hover:bg-[#252525] transition-colors text-xs font-medium cursor-pointer flex items-center gap-1.5 shadow-2xs"
              title="Toggle light / dark mode"
            >
              <span>{isDark ? '🌙' : '☀️'}</span>
              <span>{isDark ? 'Dark' : 'Light'}</span>
            </button>
          </div>
        </header>
        <main className="mx-auto w-[90%] pt-2.5 pb-8 sm:pt-3 sm:pb-10">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/session/:sessionId" element={<SessionPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/share" element={<ShareImportPage />} />
            <Route path="/s/:shortId" element={<ShareImportPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
