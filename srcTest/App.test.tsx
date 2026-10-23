// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from '../src/App'

const mockState = vi.hoisted(() => ({ throwOnSession: false }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  mockState.throwOnSession = false
})

vi.mock('../src/pages/HomePage', () => ({
  default: () => <div>Home Page Content</div>,
}))
vi.mock('../src/pages/SearchPage', () => ({
  default: () => <div>Search Page Content</div>,
}))
vi.mock('../src/pages/SessionPage', () => ({
  default: () => {
    if (mockState.throwOnSession) throw new Error('session render failed')
    return <div>Session Page Content</div>
  },
}))
vi.mock('../src/pages/ShareImportPage', () => ({
  default: () => <div>Share Import Page Content</div>,
}))
vi.mock('../src/pages/LyricsViewerPage', () => ({
  default: () => <div>Lyrics Viewer Page Content</div>,
}))

describe('App navigation visibility', () => {
  it('renders navbar on home and search routes', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>
    )

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
    expect(screen.getByText('Chord Sheets')).toBeTruthy()
    unmount()

    render(
      <MemoryRouter initialEntries={['/search']}>
        <AppShell />
      </MemoryRouter>
    )

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
  })

  it('hides navbar on /lyrics/:shortId route', () => {
    render(
      <MemoryRouter initialEntries={['/lyrics/test-short-id']}>
        <AppShell />
      </MemoryRouter>
    )

    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull()
    expect(screen.queryByText('Chord Sheets')).toBeNull()
    expect(screen.getByText('Lyrics Viewer Page Content')).toBeTruthy()
  })

  it('recovers when navigating from a crashed route to a healthy route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockState.throwOnSession = true

    render(
      <MemoryRouter initialEntries={['/session/broken']}>
        <AppShell />
      </MemoryRouter>
    )

    expect(screen.getByText('This page could not be displayed')).toBeTruthy()

    await userEvent.click(screen.getByRole('link', { name: /find songs/i }))

    expect(screen.getByText('Search Page Content')).toBeTruthy()
    expect(screen.queryByText('This page could not be displayed')).toBeNull()
  })
})
