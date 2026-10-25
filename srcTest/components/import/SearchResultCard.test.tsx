// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SearchResultCard from '../../../src/components/import/SearchResultCard'
import type { SearchCandidate } from '../../../src/lib/api'

afterEach(cleanup)

const candidate: SearchCandidate = {
  site: 'pnwchords',
  title: 'Good Grace',
  artist: 'Hillsong Worship',
  url: 'https://pnwchords.com/good-grace',
  versionLabel: 'Ver 2',
  rating: 4.5,
  type: 'Chords',
}

describe('SearchResultCard', () => {
  it('renders the candidate metadata and source link', () => {
    render(
      <SearchResultCard candidate={candidate} actionLabel="Start setlist" onAction={vi.fn()} />
    )

    expect(screen.getByText('Good Grace')).toBeTruthy()
    expect(screen.getByText('Hillsong Worship')).toBeTruthy()
    expect(screen.getByText('PNW Chords')).toBeTruthy()
    expect(screen.getByText('Ver 2')).toBeTruthy()
    expect(screen.getByText('★ 4.5')).toBeTruthy()
    expect(screen.getByText('• Chords')).toBeTruthy()
    expect(screen.getByRole('link', { name: /View source/ })).toHaveProperty(
      'href',
      'https://pnwchords.com/good-grace'
    )
  })

  it('shows the domain-qualified label for Worship Chords results', () => {
    render(
      <SearchResultCard
        candidate={{
          ...candidate,
          site: 'worshipchords-net',
          url: 'https://www.worshipchords.net/guitar/artist/song',
        }}
        actionLabel="Start setlist"
        onAction={vi.fn()}
      />
    )

    expect(screen.getByText('Worship Chords (.net)')).toBeTruthy()
  })

  it('renders the supplied action label and fires the callback', () => {
    const onAction = vi.fn()
    render(<SearchResultCard candidate={candidate} actionLabel="Add to setlist" onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add to setlist' }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('disables the action when requested', () => {
    render(
      <SearchResultCard
        candidate={candidate}
        actionLabel="Added ✓"
        actionDisabled
        onAction={vi.fn()}
      />
    )

    expect((screen.getByRole('button', { name: 'Added ✓' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
