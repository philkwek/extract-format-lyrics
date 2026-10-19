// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ImportProgressList from '../../../src/components/import/ImportProgressList'
import type { ImportProgress } from '../../../src/lib/setlistImport'

afterEach(cleanup)

describe('ImportProgressList', () => {
  it('renders nothing when there are no statuses', () => {
    const { container } = render(<ImportProgressList statuses={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders every status label and the fallback error text', () => {
    const statuses: ImportProgress[] = [
      { url: 'https://example.com/cached', status: 'cached' },
      { url: 'https://example.com/done', status: 'done' },
      { url: 'https://example.com/fetching', status: 'fetching' },
      { url: 'https://example.com/pending', status: 'pending' },
      { url: 'https://example.com/error', status: 'error' },
      { url: 'https://example.com/message', status: 'error', message: 'Scrape failed' },
    ]

    render(<ImportProgressList statuses={statuses} />)

    expect(screen.getByText('Import Progress')).toBeTruthy()
    expect(screen.getByText('Cached ✓')).toBeTruthy()
    expect(screen.getByText('Extracted ✓')).toBeTruthy()
    expect(screen.getByText('Fetching...')).toBeTruthy()
    expect(screen.getByText('Waiting...')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('Scrape failed')).toBeTruthy()
  })

  it('supports a custom heading', () => {
    render(
      <ImportProgressList
        statuses={[{ url: 'https://example.com/song', status: 'done' }]}
        heading="Importing songs"
      />
    )
    expect(screen.getByText('Importing songs')).toBeTruthy()
  })
})
