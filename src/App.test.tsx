// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './App'

afterEach(() => {
  cleanup()
})

vi.mock('./pages/HomePage', () => ({
  default: () => <div>Home Page Content</div>,
}))
vi.mock('./pages/SearchPage', () => ({
  default: () => <div>Search Page Content</div>,
}))
vi.mock('./pages/SessionPage', () => ({
  default: () => <div>Session Page Content</div>,
}))
vi.mock('./pages/ShareImportPage', () => ({
  default: () => <div>Share Import Page Content</div>,
}))
vi.mock('./pages/LyricsViewerPage', () => ({
  default: () => <div>Lyrics Viewer Page Content</div>,
}))

describe('App navigation visibility', () => {
  it('renders navbar on home and search routes', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell isDark={false} toggleTheme={vi.fn()} />
      </MemoryRouter>
    )

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
    expect(screen.getByText('Chord Sheets')).toBeTruthy()
    unmount()

    render(
      <MemoryRouter initialEntries={['/search']}>
        <AppShell isDark={false} toggleTheme={vi.fn()} />
      </MemoryRouter>
    )

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
  })

  it('hides navbar on /lyrics/:shortId route', () => {
    render(
      <MemoryRouter initialEntries={['/lyrics/test-short-id']}>
        <AppShell isDark={false} toggleTheme={vi.fn()} />
      </MemoryRouter>
    )

    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull()
    expect(screen.queryByText('Chord Sheets')).toBeNull()
    expect(screen.getByText('Lyrics Viewer Page Content')).toBeTruthy()
  })
})
