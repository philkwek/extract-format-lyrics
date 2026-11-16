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
  it('shows Send a copy with Copy link and the Share live switch off', () => {
    renderPanel(<ShareSetPanel session={session} />)

    expect(screen.getByText('Send a copy')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Share live' }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })

  it('turns live sharing on and off with the copy link under the switch', async () => {
    renderPanel(<ShareSetPanel session={session} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Share live' }))

    await screen.findByText(/Link works until/)
    expect(mocks.startLiveShare).toHaveBeenCalledWith('session-1')
    expect(screen.getByRole('switch', { name: 'Share live' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(
      screen.getByText('On. People with the link see your changes as you make them.'),
    ).toBeTruthy()

    const copyButtons = screen.getAllByRole('button', { name: 'Copy link' })
    fireEvent.click(copyButtons[copyButtons.length - 1])
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.test/live/abc'))

    fireEvent.click(screen.getByRole('switch', { name: 'Share live' }))

    await waitFor(() => expect(screen.queryByText(/Link works until/)).toBeNull())
    expect(mocks.stopLiveShare).toHaveBeenCalledWith('session-1')
    expect(screen.getByRole('switch', { name: 'Share live' }).getAttribute('aria-checked')).toBe(
      'false',
    )
    expect(screen.getAllByRole('button', { name: 'Copy link' })).toHaveLength(1)
  })

  it('moves the Share live switch at once, before the network call resolves', async () => {
    let resolve!: (v: { url: string; expiresAt: string }) => void
    mocks.startLiveShare.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    renderPanel(<ShareSetPanel session={session} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Share live' }))

    expect(screen.getByRole('switch', { name: 'Share live' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    resolve({ url: 'https://example.test/live/abc', expiresAt: '2026-12-01T00:00:00Z' })
    await screen.findByText(/Link works until/)
  })

  it('shows an error when the live share cannot start', async () => {
    mocks.startLiveShare.mockRejectedValueOnce(new Error('Check your connection.'))
    renderPanel(<ShareSetPanel session={session} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Share live' }))

    await screen.findByText('Check your connection.')
    expect(screen.getByRole('switch', { name: 'Share live' }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })

  it('opens with the switch on when the set is already live, and shows when it is not updating', async () => {
    mocks.getLiveShare.mockResolvedValue({
      url: 'https://example.test/live/xyz',
      expiresAt: '2026-12-01T00:00:00Z',
    })
    renderPanel(<ShareSetPanel session={session} />)

    await screen.findByText(/Link works until/)
    expect(screen.getByRole('switch', { name: 'Share live' }).getAttribute('aria-checked')).toBe(
      'true',
    )

    mocks.statusCb?.('failing')
    await screen.findByText(/Not updating\. People can/)
  })

  it('does not offer Share live when live sharing is unavailable', () => {
    renderPanel(<ShareSetPanel session={session} canShareLive={false} />)

    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText('Send a copy')).toBeTruthy()
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

    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText(/This set follows someone else/)).toBeTruthy()

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
