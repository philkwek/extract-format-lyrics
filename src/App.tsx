import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Search } from 'lucide-react'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import SessionPage from './pages/SessionPage'
import ShareImportPage from './pages/ShareImportPage'
import LiveFollowPage from './pages/LiveFollowPage'
import LyricsViewerPage from './pages/LyricsViewerPage'
import { useThemeMode } from './lib/useThemeMode'

import PrivacyPage from './pages/PrivacyPage'
import SignInPage from './pages/SignInPage'
import NotFoundPage from './pages/NotFoundPage'
import { trackPage, setTrackingEnabled } from './lib/analytics'
import { accountsEnabled } from './lib/accountFlag'

import { AppErrorBoundary } from './components/AppErrorBoundary'
import AccountMenu from './components/AccountMenu'
import ThemeToggle from './components/ThemeToggle'
import UpdateBanner from './components/UpdateBanner'
import OfflineNotice from './components/OfflineNotice'
import { ChromeVisibilityContext } from './lib/chromeVisibility'
import { useAppUpdate } from './lib/useAppUpdate'
import { useOnlineStatus } from './lib/useOnlineStatus'

const PresenterPage = lazy(() => import('./pages/PresenterPage'))
const PresenterOutputPage = lazy(() => import('./pages/PresenterOutputPage'))

export function AppShell() {
  const location = useLocation()
  const [chromeHidden, setChromeHidden] = useState(false)
  const { updateAvailable, reload, dismiss } = useAppUpdate()
  const online = useOnlineStatus()
  useEffect(() => {
    trackPage(location.pathname)
  }, [location.pathname])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'usage-tracking-disabled' || event.key === null) {
        setTrackingEnabled(event.newValue !== 'true')
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const isLyricsView = location.pathname.startsWith('/lyrics/')
  const isSessionView = location.pathname.startsWith('/session/')
  const isPresentView = location.pathname.startsWith('/present/')
  const isSharedLinkView = /^\/(s|live|lyrics)\//.test(location.pathname)

  return (
    <ChromeVisibilityContext.Provider value={{ hidden: chromeHidden, setHidden: setChromeHidden }}>
      <div className="app-canvas text-ui-text flex min-h-screen flex-col">
        {!isLyricsView && !isPresentView && !chromeHidden && (
          <header
            data-app-header
            className="bg-ui-canvas/78 sticky top-0 z-30 border-b border-black/5 py-2.5 backdrop-blur-xl backdrop-saturate-150 dark:border-white/7"
          >
            <div className="mx-auto flex w-[96%] max-w-[92rem] items-center justify-between">
              <NavLink
                to="/"
                className="group text-ui-text focus-visible:ring-ui-focus flex min-h-10 items-center gap-2.5 rounded-xl transition outline-none focus-visible:ring-3 active:scale-[0.98]"
              >
                <span className="text-ui-accent flex h-8 w-8 shrink-0 items-center justify-center transition-transform group-hover:scale-[1.04]">
                  <svg
                    viewBox="0 0 256 256"
                    className="h-8 w-8 fill-current drop-shadow-[0_1px_2px_rgba(27,25,22,0.12)]"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M 60 20 H 152 V 64 A 20 20 0 0 0 172 84 H 224 V 208 A 28 28 0 0 1 196 236 H 60 A 28 28 0 0 1 32 208 V 48 A 28 28 0 0 1 60 20 Z M 72 58 H 104 A 8 8 0 0 1 112 66 V 78 A 8 8 0 0 1 104 86 H 72 A 8 8 0 0 1 64 78 V 66 A 8 8 0 0 1 72 58 Z M 72 96 H 172 A 8 8 0 0 1 180 104 V 104 A 8 8 0 0 1 172 112 H 72 A 8 8 0 0 1 64 104 V 104 A 8 8 0 0 1 72 96 Z M 72 140 H 104 A 8 8 0 0 1 112 148 V 160 A 8 8 0 0 1 104 168 H 72 A 8 8 0 0 1 64 160 V 148 A 8 8 0 0 1 72 140 Z M 136 140 H 168 A 8 8 0 0 1 176 148 V 160 A 8 8 0 0 1 168 168 H 136 A 8 8 0 0 1 128 160 V 148 A 8 8 0 0 1 136 140 Z M 72 178 H 184 A 8 8 0 0 1 192 186 V 186 A 8 8 0 0 1 184 194 H 72 A 8 8 0 0 1 64 186 V 186 A 8 8 0 0 1 72 178 Z"
                    />
                    <path d="M 168 20 L 224 76 H 176 A 8 8 0 0 1 168 68 V 20 Z" />
                  </svg>
                </span>
                <span>
                  <span className="block text-sm leading-none font-bold tracking-[-0.02em]">
                    Sets &amp; Sheets
                  </span>
                  <span className="text-ui-text-muted mt-1 hidden text-[10px] leading-none font-medium sm:block">
                    Developed by Phil
                  </span>
                </span>
              </NavLink>
              <nav className="flex items-center gap-1.5" aria-label="Primary navigation">
                <NavLink
                  to="/search"
                  className={({ isActive }) =>
                    `ui-button ui-button--sm ${isActive ? 'ui-button--secondary' : 'ui-button--ghost'}`
                  }
                >
                  <Search size={15} />
                  <span className="hidden sm:inline">Find a song</span>
                </NavLink>
                <ThemeToggle compact />
                {accountsEnabled() && <AccountMenu />}
              </nav>
            </div>
          </header>
        )}
        {!online && isSharedLinkView && !isPresentView && (
          <div className="mx-auto w-[96%] max-w-lg pt-4">
            <OfflineNotice online={online} />
          </div>
        )}
        <main
          className={
            chromeHidden || isPresentView
              ? 'w-full max-w-none flex-1 p-0'
              : `mx-auto w-[96%] max-w-[92rem] flex-1 pb-10 ${
                  isLyricsView ? 'pt-2 sm:pt-3' : isSessionView ? 'pt-2.5' : 'pt-4 sm:pt-5'
                }`
          }
        >
          <AppErrorBoundary key={location.pathname}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/session/:sessionId" element={<SessionPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              {accountsEnabled() && <Route path="/sign-in" element={<SignInPage />} />}
              <Route path="/search" element={<SearchPage />} />
              <Route path="/s/:shortId" element={<ShareImportPage />} />
              <Route path="/live/:liveId" element={<LiveFollowPage />} />
              <Route path="/lyrics/:shortId" element={<LyricsViewerPage />} />
              <Route
                path="/present/:id"
                element={
                  <Suspense fallback={null}>
                    <PresenterPage />
                  </Suspense>
                }
              />
              <Route
                path="/present/:id/output"
                element={
                  <Suspense fallback={null}>
                    <PresenterOutputPage />
                  </Suspense>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AppErrorBoundary>
        </main>
        {!chromeHidden && !isPresentView && (
          <footer className="mx-auto w-full max-w-[92rem] px-[2%] pb-4 text-center text-xs text-[var(--ui-text-muted)]">
            <NavLink to="/privacy" className="underline">
              Privacy and usage tracking
            </NavLink>
            {(location.pathname === '/' || location.pathname === '/privacy') && (
              <span>
                {' '}
                · We use Google Analytics to understand how this site is used. You can turn it off.
              </span>
            )}
          </footer>
        )}
        <UpdateBanner open={updateAvailable} onReload={reload} onDismiss={dismiss} />
      </div>
    </ChromeVisibilityContext.Provider>
  )
}

function App() {
  useThemeMode()

  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}

export default App
