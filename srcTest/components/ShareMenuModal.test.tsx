// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

describe('ShareMenuModal', () => {
  it('shows both share methods on one screen, each with a switch', () => {
    renderModal(session)

    expect(screen.getByRole('heading', { name: 'Full set' })).toBeTruthy()
    expect(screen.getByText('Share with other musicians')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Lyrics' })).toBeTruthy()
    expect(screen.getByText('For people to follow along')).toBeTruthy()

    expect(screen.getByText('Send a copy')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Share live' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Lyrics link' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
  })

  it('shows the lyrics link as on when a publication is active', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue({
      sessionId: 'session-1',
      publicationId: 'pub-id-123',
      updateSecret: 'secret-123',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })

    renderModal(session)

    await waitFor(() => {
      expect(
        screen.getByRole('switch', { name: 'Lyrics link' }).getAttribute('aria-checked'),
      ).toBe('true')
    })
  })

  it('shows the followed live link instead of a Share live switch', () => {
    renderModal({ ...session, liveSourceId: 'live-abc' })

    expect(screen.queryByRole('switch', { name: 'Share live' })).toBeNull()
    expect(screen.getByText(/This set follows someone else/)).toBeTruthy()

    const liveLink = screen.getByLabelText('Live link') as HTMLInputElement
    expect(liveLink.value).toMatch(/\/live\/live-abc$/)
  })
})
