import { useState, useEffect } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { LibraryBig, Moon, Search, Sun } from 'lucide-react'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import SessionPage from './pages/SessionPage'
import ShareImportPage from './pages/ShareImportPage'
import { getInitialTheme, saveTheme, applyTheme } from './lib/theme'
import { IconButton } from './components/ui'

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
      <div className="app-canvas min-h-screen text-neutral-900 dark:text-[#e5e5e5] transition-colors">
        <header className="sticky top-0 z-30 border-b border-black/5 bg-white/78 px-3 py-2.5 backdrop-blur-xl backdrop-saturate-150 dark:border-white/7 dark:bg-[#101010]/78 sm:px-[4%]">
          <div className="mx-auto flex max-w-[92rem] items-center justify-between">
            <NavLink to="/" className="group flex min-h-10 items-center gap-2.5 rounded-xl px-2 text-neutral-900 outline-none transition active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-[#3368A0]/30 dark:text-[#ededeb] dark:focus-visible:ring-amber-400/30">
              <span className="flex h-8 w-8 items-center justify-center rounded-[0.7rem] bg-[#3368A0] text-white shadow-sm transition-transform group-hover:scale-[1.03] dark:bg-amber-500 dark:text-[#16120a]">
                <LibraryBig size={17} strokeWidth={2.2} />
              </span>
              <span>
                <span className="block text-sm font-bold leading-none tracking-[-0.02em]">Chord Sheets</span>
                <span className="mt-1 hidden text-[10px] font-medium leading-none text-neutral-500 dark:text-[#999999] sm:block">Developed by Phil</span>
              </span>
            </NavLink>
            <nav className="flex items-center gap-1.5" aria-label="Primary navigation">
              <NavLink
                to="/search"
                className={({ isActive }) => `ui-button ui-button--sm ${isActive ? 'ui-button--secondary' : 'ui-button--ghost'}`}
              >
                <Search size={15} />
                <span className="hidden sm:inline">Find songs</span>
              </NavLink>
              <IconButton
                onClick={toggleTheme}
                label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
                variant="secondary"
              >
                {isDark ? <Sun size={16} /> : <Moon size={16} />}
              </IconButton>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-[96%] max-w-[92rem] pb-10 pt-4 sm:pt-5">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/session/:sessionId" element={<SessionPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/s/:shortId" element={<ShareImportPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
