// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SearchResults from '../../../src/components/import/SearchResults'
import type { SearchCandidate } from '../../../src/lib/api'

afterEach(cleanup)

const candidate: SearchCandidate = {
  site: 'pnwchords',
  title: 'Good Grace',
  artist: 'Hillsong Worship',
  url: 'https://pnwchords.com/good-grace',
}

describe('SearchResults', () => {
  it('renders the loading state', () => {
    render(
      <SearchResults
        results={[]}
        isSearching
        hasSearched={false}
        emptyMessage="Nothing here"
        onSelect={vi.fn()}
        getActionState={() => ({ label: 'Start setlist' })}
      />,
    )

    expect(screen.getByRole('status').textContent).toContain('Searching supported chord sites')
  })

  it('renders result cards with action state and selection callback', () => {
    const onSelect = vi.fn()
    render(
      <SearchResults
        results={[candidate]}
        isSearching={false}
        hasSearched
        emptyMessage="Nothing here"
        onSelect={onSelect}
        getActionState={() => ({ label: 'Add to setlist', disabled: true })}
      />,
    )

    expect(screen.getByText('Search results · 1')).toBeTruthy()
    expect(screen.getByText('Good Grace')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Add to setlist' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows per-source chip counts matching the shown results alongside empty and failed chips', () => {
    render(
      <SearchResults
        results={[
          candidate,
          {
            site: 'ultimate-guitar',
            title: 'Good Grace',
            artist: 'Hillsong',
            url: 'https://ultimate-guitar.com/1',
          },
        ]}
        sources={[
          { site: 'pnwchords', status: 'ok', count: 5, durationMs: 100 },
          { site: 'ultimate-guitar', status: 'ok', count: 3, durationMs: 100 },
          { site: 'worshiptogether', status: 'empty', count: 0, durationMs: 100 },
          { site: 'essentialworship', status: 'failed', count: 0, durationMs: 100 },
        ]}
        isSearching={false}
        hasSearched
        emptyMessage="Nothing here"
        onSelect={vi.fn()}
        getActionState={() => ({ label: 'Add to setlist' })}
      />,
    )

    expect(screen.getByText('Search results · 2')).toBeTruthy()
    expect(screen.getByText('PNW Chords: 1 result')).toBeTruthy()
    expect(screen.getByText('Ultimate Guitar: 1 result')).toBeTruthy()
    expect(screen.getByText('Worship Together: No matches')).toBeTruthy()
    expect(screen.getByText('Essential Worship: Unavailable')).toBeTruthy()
  })

  it('shows the empty message after a completed search', () => {
    render(
      <SearchResults
        results={[]}
        isSearching={false}
        hasSearched
        emptyMessage="No matches"
        onSelect={vi.fn()}
        getActionState={() => ({ label: 'Start setlist' })}
      />,
    )

    expect(screen.getByText('No matches')).toBeTruthy()
  })

  it('suppresses the empty message when there is an error', () => {
    const { container } = render(
      <SearchResults
        results={[]}
        isSearching={false}
        hasSearched
        hasError
        emptyMessage="No matches"
        onSelect={vi.fn()}
        getActionState={() => ({ label: 'Start setlist' })}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders nothing before the first search', () => {
    const { container } = render(
      <SearchResults
        results={[]}
        isSearching={false}
        hasSearched={false}
        emptyMessage="No matches"
        onSelect={vi.fn()}
        getActionState={() => ({ label: 'Start setlist' })}
      />,
    )

    expect(container.firstChild).toBeNull()
  })
})
