// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ShareMenuModal from '../../src/components/ShareMenuModal'
import type { Session } from '../../src/lib/sessionStore'
import type { Song } from '../../src/types/song'

const mocks = vi.hoisted(() => ({
  getLyricsPublicationIdentity: vi.fn(),
  publishLyricsForSession: vi.fn(),
  ensureLyricsFresh: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../../src/lib/lyricsPublishIdentity', async () => {
  const actual = await vi.importActual('../../src/lib/lyricsPublishIdentity')
  return {
    ...actual,
    getLyricsPublicationIdentity: mocks.getLyricsPublicationIdentity,
    publishLyricsForSession: mocks.publishLyricsForSession,
  }
})

vi.mock('../../src/lib/lyricsSync', () => ({
  ensureLyricsFresh: mocks.ensureLyricsFresh,
}))

beforeEach(() => {
  mocks.getLyricsPublicationIdentity.mockResolvedValue(null)
})

afterEach(cleanup)

const song: Song = {
  id: 'song-1',
  title: 'Morning Bell',
  artist: 'Demo Band',
  sourceUrl: 'https://example.test/morning-bell',
  sourceSite: 'Demo',
  originalKey: 'G',
  sections: [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [{ kind: 'lyric', text: 'Ring the morning bell again', chords: [] }],
    },
  ],
}

const session: Session = {
  id: 'session-1',
  createdAt: 0,
  name: 'Sunday Set',
  songs: [
    {
      entryId: 'entry-1',
      url: song.sourceUrl,
      title: song.title,
      artist: song.artist,
    },
  ],
}

function renderModal(modalSession: Session) {
  return render(
    <MemoryRouter>
      <ShareMenuModal
        session={modalSession}
        songsData={new Map([['entry-1', song]])}
        isOpen
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  )
}

function panel(name: 'set' | 'lyrics') {
  const element = document.getElementById(`share-tabs-panel-${name}`)
  if (!element) throw new Error(`Missing ${name} panel`)
  return element
}

describe('ShareMenuModal', () => {
  it('shows the set sharing options first and hides the lyrics panel', () => {
    renderModal(session)

    expect(screen.getByRole('tab', { name: 'Full set' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(
      screen.getByRole('tab', { name: 'Lyrics only' }).getAttribute('aria-selected'),
    ).toBe('false')

    expect(panel('set').hasAttribute('hidden')).toBe(false)
    expect(panel('lyrics').hasAttribute('hidden')).toBe(true)

    expect(
      within(panel('set')).getByText('Chords, keys and sections for the whole band.'),
    ).toBeTruthy()
  })

  it('switches to the lyrics panel when the lyrics tab is chosen', async () => {
    const user = userEvent.setup()
    renderModal(session)

    await user.click(screen.getByRole('tab', { name: 'Lyrics only' }))

    expect(
      screen.getByRole('tab', { name: 'Lyrics only' }).getAttribute('aria-selected'),
    ).toBe('true')
    expect(panel('lyrics').hasAttribute('hidden')).toBe(false)
    expect(panel('set').hasAttribute('hidden')).toBe(true)

    expect(
      within(panel('lyrics')).getByText(
        'Words only, no chords. Changes you make update it automatically.',
      ),
    ).toBeTruthy()
  })

  it('marks the lyrics tab as on when a publication is already live', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue({
      sessionId: 'session-1',
      publicationId: 'pub-id-123',
      updateSecret: 'secret-123',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })

    renderModal(session)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Lyrics only · On' })).toBeTruthy()
    })
  })

  it('uses the live copy intro for a set opened from a live share', () => {
    renderModal({ ...session, liveSourceId: 'live-abc' })

    expect(
      within(panel('set')).getByText('Copy the live link or make your own copy.'),
    ).toBeTruthy()
  })
})
