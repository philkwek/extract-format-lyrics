// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import LyricsPreviewModal from '../../src/components/LyricsPreviewModal'
import type { SharedLyricsPayload } from '../../src/types/song'

afterEach(() => {
  cleanup()
})

const mockPayload: SharedLyricsPayload = {
  v: 1,
  name: 'Sunday Service Set',
  songs: [
    {
      entryId: 'entry-1',
      title: 'Fresh Fire',
      sections: [
        { label: 'INTRO', lines: [] },
        { label: 'VERSE 1', lines: ['Search me know me', 'Know my every thought'] },
        { label: 'CHORUS', lines: ['Fresh fire, fresh fire'] },
      ],
    },
    {
      entryId: 'entry-2',
      title: 'Way Maker',
      sections: [
        { label: 'VERSE 1', lines: ['You are here moving in our midst'] },
      ],
    },
  ],
}

describe('LyricsPreviewModal', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <LyricsPreviewModal isOpen={false} onClose={vi.fn()} payload={mockPayload} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders preview title, sticky tabs at top-0 with opaque surface, and song lyrics', () => {
    render(
      <LyricsPreviewModal isOpen={true} onClose={vi.fn()} payload={mockPayload} />
    )

    // Modal title & description
    expect(screen.getByText('(Preview) Sunday Service Set')).toBeTruthy()
    expect(screen.getByText(/Preview of how vocalists and musicians will see these lyrics/i)).toBeTruthy()

    // Tablist exists and has sticky top-0 and opaque raised surface
    const tablist = screen.getByRole('tablist', { name: /songs in setlist/i })
    expect(tablist).toBeTruthy()
    expect(tablist.className).toContain('sticky')
    expect(tablist.className).toContain('top-0')
    expect(tablist.className).toContain('bg-[var(--ui-surface-raised)]')

    // Songs are listed in tabs
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].textContent).toContain('Fresh Fire')
    expect(tabs[1].textContent).toContain('Way Maker')

    // First song title is rendered as heading
    const songHeading = screen.getByRole('heading', { level: 2, name: 'Fresh Fire' })
    expect(songHeading).toBeTruthy()
    expect(screen.getByText('Search me know me')).toBeTruthy()
    expect(screen.getByText('Fresh fire, fresh fire')).toBeTruthy()
    expect(screen.getByText('Instrumental')).toBeTruthy()
  })

  it('switches songs when clicking another tab and resets scroll', () => {
    render(
      <LyricsPreviewModal isOpen={true} onClose={vi.fn()} payload={mockPayload} />
    )

    const tabs = screen.getAllByRole('tab')
    fireEvent.click(tabs[1])

    // Way Maker heading and lyrics should now be displayed
    expect(screen.getByRole('heading', { level: 2, name: 'Way Maker' })).toBeTruthy()
    expect(screen.getByText('You are here moving in our midst')).toBeTruthy()
  })

  it('calls onClose when clicking close button or close preview button', () => {
    const onClose = vi.fn()
    render(
      <LyricsPreviewModal isOpen={true} onClose={onClose} payload={mockPayload} />
    )

    const closeBtn = screen.getByRole('button', { name: /Close Preview/i })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
