// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ShareSetPanel from '../../../src/components/share/ShareSetPanel'
import { sessionStore, type Session } from '../../../src/lib/sessionStore'

const mocks = vi.hoisted(() => ({
  ensureSetLinkFresh: vi.fn<
    () => Promise<{ ok: true } | { ok: false; reason: 'empty' | 'too_many' | 'failed' }>
  >(async () => ({ ok: true })),
  getLiveShare: vi.fn<(id: string) => Promise<{ url: string; expiresAt?: string } | null>>(
    async () => null,
  ),
  startLiveShare: vi.fn(async () => ({
    url: 'https://example.test/live/abc',
    expiresAt: '2026-12-01T00:00:00Z',
  })),
  stopLiveShare: vi.fn(async () => {}),
  statusCb: null as null | ((status: 'ok' | 'failing') => void),
}))

vi.mock('../../../src/lib/setLinkSync', () => ({ ensureSetLinkFresh: mocks.ensureSetLinkFresh }))
vi.mock('../../../src/lib/liveShareSync', () => ({
  getLiveShare: mocks.getLiveShare,
  startLiveShare: mocks.startLiveShare,
  stopLiveShare: mocks.stopLiveShare,
  subscribeLiveShareStatus: (_id: string, cb: (status: 'ok' | 'failing') => void) => {
    mocks.statusCb = cb
    return () => {}
  },
}))

const session: Session = {
  id: 'session-1',
  publicId: 'pub-1',
  createdAt: 0,
  name: 'Sunday Set',
  songs: [{ entryId: 'e1', url: 'https://example.test/a', title: 'A', artist: 'B' }],
}

const followedSession: Session = {
  ...session,
  liveSourceId: 'live-abc',
  liveRev: 4,
  lastHostHash: 'host-hash',
  songs: [
    {
      entryId: 'e1',
      url: 'https://example.test/a',
      title: 'A',
      artist: 'B',
      targetKey: 'D',
      simplified: true,
      padKeyMode: 'custom',
      customPadKey: 'E',
      customSections: [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [{ kind: 'lyric', text: 'la la la', chords: [{ pos: 0, chord: 'D' }] }],
        },
      ],
      customFlow: [0],
      customSimplifiedSections: [
        {
          type: 'Chorus',
          label: 'Chorus',
          lines: [{ kind: 'lyric', text: 'na na na', chords: [] }],
        },
      ],
      customSimplifiedFlow: [0],
    },
  ],
}

const uploadsSession: Session = {
  ...session,
  songs: [{ ...session.songs[0], url: 'upload://x' }],
}

const writeText = vi.fn(async () => {})

function renderPanel(ui: ReactNode, initialEntries = ['/']) {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensureSetLinkFresh.mockResolvedValue({ ok: true })
  mocks.getLiveShare.mockResolvedValue(null)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ShareSetPanel', () => {
  it('defaults to Send a copy and copies the page address after refreshing the set link', async () => {
    const order: string[] = []
    mocks.ensureSetLinkFresh.mockImplementationOnce(async () => {
      order.push('ensure')
      return { ok: true }
    })
    writeText.mockImplementationOnce(async () => {
      order.push('copy')
    })
    renderPanel(<ShareSetPanel session={session} />)
    expect(screen.getByText('This is the same as copying this page’s address.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/session/pub-1`)
    expect(order).toEqual(['ensure', 'copy'])
  })

  it.each([
    ['empty', 'Add a song before you share this set.'],
    ['too_many', 'A set link holds up to 30 songs. Remove some and try again.'],
    ['failed', 'Could not make the link. Check your connection and try again.'],
  ] as const)('shows a clear %s error instead of copying', async (reason, message) => {
    mocks.ensureSetLinkFresh.mockResolvedValueOnce({ ok: false, reason })
    renderPanel(<ShareSetPanel session={session} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await screen.findByText(message)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('shows the uploads line only when the set has uploaded sheets', () => {
    const { unmount } = renderPanel(<ShareSetPanel session={session} />)
    expect(screen.queryByText(/Uploaded sheets/)).toBeNull()
    unmount()
    renderPanel(<ShareSetPanel session={uploadsSession} />)
    expect(screen.getByText(/Uploaded sheets/)).toBeTruthy()
  })

  it('hides the Share live uploads hint when live sharing is unavailable', () => {
    renderPanel(<ShareSetPanel session={uploadsSession} canShareLive={false} />)
    expect(screen.queryByText(/Uploaded sheets/)).toBeNull()
  })

  it('starts, copies and stops a live share', async () => {
    renderPanel(<ShareSetPanel session={session} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Share live' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start live share' }))
    await screen.findByDisplayValue('https://example.test/live/abc')
    expect(mocks.startLiveShare).toHaveBeenCalledWith('session-1')

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.test/live/abc'))

    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))
    await screen.findByRole('button', { name: 'Start live share' })
    expect(mocks.stopLiveShare).toHaveBeenCalledWith('session-1')
  })

  it('shows an error when the live share cannot start', async () => {
    mocks.startLiveShare.mockRejectedValueOnce(new Error('Check your connection.'))
    renderPanel(<ShareSetPanel session={session} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Share live' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start live share' }))
    await screen.findByText('Check your connection.')
  })

  it('opens on Share live when the set is already live, and shows when it is not updating', async () => {
    mocks.getLiveShare.mockResolvedValue({
      url: 'https://example.test/live/xyz',
      expiresAt: '2026-12-01T00:00:00Z',
    })
    renderPanel(<ShareSetPanel session={session} />)
    await screen.findByDisplayValue('https://example.test/live/xyz')
    expect(screen.getByRole('tab', { name: 'Share live' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(/Expires/)).toBeTruthy()
    mocks.statusCb?.('failing')
    await screen.findByText(/Not updating\. Your latest changes/)
  })

  it('hides Share live when canShareLive is false', () => {
    renderPanel(<ShareSetPanel session={session} canShareLive={false} />)
    expect(screen.queryByRole('tab', { name: 'Share live' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    expect(mocks.getLiveShare).not.toHaveBeenCalled()
  })

  it('shows the source live link and makes an exact normal copy for a followed set', async () => {
    const getAllSessions = vi.spyOn(sessionStore, 'getAllSessions').mockResolvedValue([session])
    const createSession = vi.spyOn(sessionStore, 'createSession')
    createSession.mockImplementation(async (songs, name) => ({
      id: 'copy-1',
      publicId: 'copy-pub',
      createdAt: 1,
      name: name ?? 'Copy',
      songs,
    }))

    renderPanel(
      <Routes>
        <Route path="/" element={<ShareSetPanel session={followedSession} />} />
        <Route path="/session/copy-pub" element={<div>Copy opened</div>} />
      </Routes>,
    )

    expect(screen.queryByRole('tab', { name: 'Send a copy' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Share live' })).toBeNull()
    const sourceUrl = `${window.location.origin}/live/live-abc`
    expect(screen.getByDisplayValue(sourceUrl)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sourceUrl))

    fireEvent.click(screen.getByRole('button', { name: 'Create a copy' }))
    await screen.findByText('Copy opened')

    expect(getAllSessions).toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledTimes(1)
    const [songs, name, options] = createSession.mock.calls[0]
    expect(name).toBe('Sunday Set - Copy #1')
    expect(options).toBeUndefined()
    expect(songs).toEqual(followedSession.songs)
    expect(songs).not.toBe(followedSession.songs)
    expect(songs[0].customSections).not.toBe(followedSession.songs[0].customSections)
  })
})
