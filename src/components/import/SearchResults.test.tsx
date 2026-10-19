// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SearchResults from './SearchResults'
import type { SearchCandidate } from '../../lib/api'

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
      />
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
      />
    )

    expect(screen.getByText('Search results · 1')).toBeTruthy()
    expect(screen.getByText('Good Grace')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Add to setlist' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
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
      />
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
      />
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
      />
    )

    expect(container.firstChild).toBeNull()
  })
})
