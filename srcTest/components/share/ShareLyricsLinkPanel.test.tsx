// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShareLyricsLinkPanel from '../../../src/components/share/ShareLyricsLinkPanel'
import type { Session } from '../../../src/lib/sessionStore'
import type { Song } from '../../../src/types/song'

const mocks = vi.hoisted(() => ({
  getLyricsPublicationIdentity: vi.fn(),
  deleteLyricsPublicationIdentity: vi.fn(async () => {}),
  ensureLyricsFresh: vi.fn(async () => ({ ok: true })),
  publishLyricsForSession: vi.fn(),
  withLyricsPublicationLock: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock('../../../src/lib/lyricsPublishIdentity', () => ({
  getLyricsPublicationIdentity: mocks.getLyricsPublicationIdentity,
  deleteLyricsPublicationIdentity: mocks.deleteLyricsPublicationIdentity,
  publishLyricsForSession: mocks.publishLyricsForSession,
  withLyricsPublicationLock: mocks.withLyricsPublicationLock,
}))
vi.mock('../../../src/lib/lyricsSync', () => ({
  ensureLyricsFresh: mocks.ensureLyricsFresh,
}))
vi.mock('../../../src/lib/analytics', () => ({ trackEvent: vi.fn() }))

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://example.test' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const session: Session = {
  id: 'session-1',
  publicId: 'pub-1',
  createdAt: 0,
  name: 'Sunday Set',
  songs: [{ entryId: 'e1', url: 'https://example.test/a', title: 'A', artist: 'B' }],
}

const songsData = new Map<string, Song>([
  [
    'https://example.test/a',
    {
      id: 'song-1',
      title: 'A',
      artist: 'B',
      sourceUrl: 'https://example.test/a',
      sourceSite: 'example',
      originalKey: 'G',
      sections: [],
    },
  ],
])

const now = new Date().toISOString()

function lyricsSwitch() {
  return screen.getByRole('switch', { name: 'Lyrics link' }) as HTMLButtonElement
}

async function findReadySwitch() {
  await waitFor(() => expect(lyricsSwitch().disabled).toBe(false))
  return lyricsSwitch()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLyricsPublicationIdentity.mockResolvedValue({
    sessionId: 'session-1',
    publicationId: 'pub-id-123',
    updateSecret: 'secret-123',
    expiresAt: now,
  })
  mocks.deleteLyricsPublicationIdentity.mockResolvedValue(undefined)
  mocks.ensureLyricsFresh.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ShareLyricsLinkPanel', () => {
  it('calls ensureLyricsFresh once when rendered with a published identity', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalled()
      },
      { timeout: 5000 },
    )

    expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
  })

  it('starts with the switch off when there is no publication', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await findReadySwitch()
    expect(lyricsSwitch().getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
  })

  it('turns the lyrics link on and shows Copy link and Preview', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)
    mocks.publishLyricsForSession.mockResolvedValue({
      id: 'pub-new',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      shareUrl: 'https://example.test/lyrics/pub-new',
    })

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    fireEvent.click(await findReadySwitch())

    await waitFor(() => {
      expect(mocks.publishLyricsForSession).toHaveBeenCalledWith('session-1', expect.anything())
    })
    expect(await screen.findByRole('button', { name: 'Copy link' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(screen.getByText('On. Updates when you change the set.')).toBeTruthy()
    expect(screen.getByText(/Link works until/)).toBeTruthy()
    expect(
      screen.getByText(
        'Turning this off stops updates. The last version stays viewable for up to 7 days. Turning it on again makes a new link.',
      ),
    ).toBeTruthy()
  })

  it('turns the lyrics link off and hides the actions', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await screen.findByRole('button', { name: 'Copy link' })
    expect(lyricsSwitch().getAttribute('aria-checked')).toBe('true')

    fireEvent.click(lyricsSwitch())

    await waitFor(() => {
      expect(mocks.deleteLyricsPublicationIdentity).toHaveBeenCalledWith('session-1')
    })
    expect(mocks.withLyricsPublicationLock).toHaveBeenCalledWith('session-1', expect.any(Function))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
    })
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
    expect(lyricsSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('moves the switch at once and puts it back when publishing fails', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)
    let reject!: (err: Error) => void
    mocks.publishLyricsForSession.mockReturnValue(
      new Promise((_, r) => {
        reject = r
      }),
    )

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)
    fireEvent.click(await findReadySwitch())

    expect(lyricsSwitch().getAttribute('aria-checked')).toBe('true')
    await act(async () => reject(new Error('Network down')))
    await waitFor(() => expect(lyricsSwitch().getAttribute('aria-checked')).toBe('false'))
    expect(screen.getByRole('alert').textContent).toContain('Network down')
  })

  it('starts with the switch on when an existing publication is restored', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await screen.findByRole('button', { name: 'Copy link' })

    expect(lyricsSwitch().getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(mocks.getLyricsPublicationIdentity).toHaveBeenCalledWith('session-1')
  })

  it('calls ensureLyricsFresh again when window online is dispatched', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(2)
      },
      { timeout: 5000 },
    )
  })

  it('does not call ensureLyricsFresh after unmount when online is dispatched', async () => {
    const { unmount } = render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )

    unmount()

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
  })
})
