// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ShareMenuModal from '../../src/components/ShareMenuModal'
import type { Session } from '../../src/lib/sessionStore'
import type { Song } from '../../src/types/song'

vi.mock('../../src/lib/lyricsPublishIdentity', async () => {
  const actual = await vi.importActual('../../src/lib/lyricsPublishIdentity')
  return {
    ...actual,
    getLyricsPublicationIdentity: vi.fn(async () => null),
    publishLyricsForSession: vi.fn(),
  }
})

afterEach(cleanup)

const song: Song = {
  id: 'song-1',
  title: 'Great Are You Lord',
  artist: 'All Sons & Daughters',
  sourceUrl: 'https://example.test/great-are-you-lord',
  sourceSite: 'Demo',
  originalKey: 'G',
  sections: [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [{ kind: 'lyric', text: 'You give life, You are love', chords: [] }],
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
      status: 'ok',
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
  it('offers sending a copy for the set and a link for the lyrics', async () => {
    renderModal(session)

    expect(screen.getByText('Share this set')).toBeTruthy()
    expect(screen.getByText('Share lyrics')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Send a copy' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Share live' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Copy link' })).toHaveLength(1)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate link' })).toBeTruthy()
    })
  })

  it('offers the live link and a copy for a set opened from a live share', () => {
    renderModal({ ...session, liveSourceId: 'live-abc' })

    expect(screen.getByText('Copy the live link or make your own copy.')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Send a copy' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Share live' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Create a copy' })).toBeTruthy()
    expect(
      screen.getByDisplayValue(`${window.location.origin}/live/live-abc`),
    ).toBeTruthy()
  })
})
