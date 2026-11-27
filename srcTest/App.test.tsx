// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from '../src/App'

const mockState = vi.hoisted(() => ({ throwOnSession: false }))
const authModule = vi.hoisted(() => ({ loaded: false }))

vi.mock('firebase/app', () => ({
  getApps: () => [{}],
  initializeApp: () => ({}),
}))

vi.mock('firebase/auth', () => {
  authModule.loaded = true
  return {
    GoogleAuthProvider: class {},
    getAuth: () => ({}),
    connectAuthEmulator: vi.fn(),
    getRedirectResult: async () => null,
    onAuthStateChanged: () => () => {},
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    sendSignInLinkToEmail: vi.fn(),
    isSignInWithEmailLink: () => false,
    signInWithEmailLink: vi.fn(),
    signOut: vi.fn(),
  }
})

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  mockState.throwOnSession = false
  localStorage.clear()
})

vi.mock('../src/pages/HomePage', () => ({
  default: () => <div>Home Page Content</div>,
}))
vi.mock('../src/pages/SearchPage', () => ({
  default: () => <div>Search Page Content</div>,
}))
vi.mock('../src/pages/SessionPage', async () => {
  const { useChromeVisibility } = await import('../src/lib/chromeVisibility')
  return {
    default: function MockSessionPage() {
      const { setHidden } = useChromeVisibility()
      if (mockState.throwOnSession) throw new Error('session render failed')
      return (
        <div>
          <div>Session Page Content</div>
          <button type="button" onClick={() => setHidden(true)}>
            Hide chrome
          </button>
          <button type="button" onClick={() => setHidden(false)}>
            Show chrome
          </button>
        </div>
      )
    },
  }
})
vi.mock('../src/pages/ShareImportPage', () => ({
  default: () => <div>Share Import Page Content</div>,
}))
vi.mock('../src/pages/LyricsViewerPage', () => ({
  default: () => <div>Lyrics Viewer Page Content</div>,
}))
vi.mock('../src/pages/SignInPage', () => ({
  default: () => <div>Sign In Page Content</div>,
}))

describe('App navigation visibility', () => {
  it('renders navbar on home and search routes', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
    expect(screen.getByText('Sets & Sheets')).toBeTruthy()
    unmount()

    render(
      <MemoryRouter initialEntries={['/search']}>
        <AppShell />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
  })

  it('hides navbar on /lyrics/:shortId route', () => {
    render(
      <MemoryRouter initialEntries={['/lyrics/test-short-id']}>
        <AppShell />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull()
    expect(screen.queryByText('Sets & Sheets')).toBeNull()
    expect(screen.getByText('Lyrics Viewer Page Content')).toBeTruthy()
  })

  it('hides the header and footer while a session requests immersive chrome', async () => {
    render(
      <MemoryRouter initialEntries={['/session/demo']}>
        <AppShell />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
    expect(screen.getByText('Privacy and usage tracking')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Hide chrome' }))

    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull()
    expect(screen.queryByText('Privacy and usage tracking')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Show chrome' }))

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
    expect(screen.getByText('Privacy and usage tracking')).toBeTruthy()
  })

  it('recovers when navigating from a crashed route to a healthy route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockState.throwOnSession = true

    render(
      <MemoryRouter initialEntries={['/session/broken']}>
        <AppShell />
      </MemoryRouter>,
    )

    expect(screen.getByText('This page could not be displayed')).toBeTruthy()

    await userEvent.click(screen.getByRole('link', { name: /find a song/i }))

    expect(screen.getByText('Search Page Content')).toBeTruthy()
    expect(screen.queryByText('This page could not be displayed')).toBeNull()
  })
})

describe('Account entry', () => {
  it('shows no sign in button and never loads firebase auth when accounts are off', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(authModule.loaded).toBe(false)
  })

  it('shows the sign in button and dialog when accounts are on', async () => {
    vi.stubEnv('VITE_ACCOUNTS_ENABLED', 'true')

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeTruthy()
    expect(screen.getByLabelText('Email address')).toBeTruthy()
  })

  it('adds the sign in route only when accounts are on', () => {
    const off = render(
      <MemoryRouter initialEntries={['/sign-in']}>
        <AppShell />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Sign In Page Content')).toBeNull()
    expect(screen.getByText('Page not found')).toBeTruthy()
    off.unmount()

    vi.stubEnv('VITE_ACCOUNTS_ENABLED', 'true')

    render(
      <MemoryRouter initialEntries={['/sign-in']}>
        <AppShell />
      </MemoryRouter>,
    )
    expect(screen.getByText('Sign In Page Content')).toBeTruthy()
  })
})
