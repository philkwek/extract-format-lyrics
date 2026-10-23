// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import ShareMenuModal from '../../src/components/ShareMenuModal'
import type { Session } from '../../src/lib/sessionStore'
import type { SharedSetSnapshot, Song } from '../../src/types/song'

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

const snapshot: SharedSetSnapshot = {
  v: 2,
  name: session.name,
  songs: [{ entryId: 'entry-1', song }],
}

describe('ShareMenuModal', () => {
  it('shows a generate button for both the set and the lyrics', async () => {
    render(
      <ShareMenuModal
        snapshot={snapshot}
        session={session}
        songsData={new Map([['entry-1', song]])}
        isOpen
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Share this set')).toBeTruthy()
    expect(screen.getByText('Share lyrics')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Generate link' })).toHaveLength(2)

    await waitFor(() => {
      expect(screen.getByText('A link has not been generated yet.')).toBeTruthy()
    })
  })

  it('keeps lyrics sharing available when the set snapshot cannot be prepared', async () => {
    render(
      <ShareMenuModal
        snapshot={null}
        snapshotError="All songs must finish loading successfully before this set can be shared."
        session={session}
        songsData={new Map([['entry-1', song]])}
        isOpen
        onClose={vi.fn()}
      />
    )

    expect(
      screen.getByText('All songs must finish loading successfully before this set can be shared.')
    ).toBeTruthy()
    expect(screen.getByText('Share lyrics')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Generate link' })).toHaveLength(1)
  })
})
