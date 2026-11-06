// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShareSetPanel from '../../../src/components/share/ShareSetPanel'
import type { Session } from '../../../src/lib/sessionStore'

const mocks = vi.hoisted(() => ({
  ensureSetLinkFresh: vi.fn(async () => {}),
  getLiveShare: vi.fn<(id: string) => Promise<string | null>>(async () => null),
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
  songs: [{ entryId: 'e1', url: 'https://example.test/a', title: 'A', artist: 'B', status: 'ok' }],
}

const writeText = vi.fn(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLiveShare.mockResolvedValue(null)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(cleanup)

describe('ShareSetPanel', () => {
  it('defaults to Send a copy and copies the page address after refreshing the set link', async () => {
    const order: string[] = []
    mocks.ensureSetLinkFresh.mockImplementationOnce(async () => {
      order.push('ensure')
    })
    writeText.mockImplementationOnce(async () => {
      order.push('copy')
    })
    render(<ShareSetPanel session={session} />)
    expect(screen.getByText('This is the same as copying this page’s address.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/session/pub-1`)
    expect(order).toEqual(['ensure', 'copy'])
  })

  it('shows the uploads line only when the set has uploaded sheets', () => {
    const { unmount } = render(<ShareSetPanel session={session} />)
    expect(screen.queryByText(/Uploaded sheets/)).toBeNull()
    unmount()
    render(
      <ShareSetPanel
        session={{ ...session, songs: [{ ...session.songs[0], url: 'upload://x' }] }}
      />,
    )
    expect(screen.getByText(/Uploaded sheets/)).toBeTruthy()
  })

  it('starts, copies and stops a live share', async () => {
    render(<ShareSetPanel session={session} />)
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
    render(<ShareSetPanel session={session} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Share live' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start live share' }))
    await screen.findByText('Check your connection.')
  })

  it('opens on Share live when the set is already live, and shows when it is not updating', async () => {
    mocks.getLiveShare.mockResolvedValue('https://example.test/live/xyz')
    render(<ShareSetPanel session={session} />)
    await screen.findByDisplayValue('https://example.test/live/xyz')
    expect(screen.getByRole('tab', { name: 'Share live' }).getAttribute('aria-selected')).toBe('true')
    mocks.statusCb?.('failing')
    await screen.findByText(/Not updating\. Your latest changes/)
  })

  it('hides Share live when canShareLive is false', () => {
    render(<ShareSetPanel session={session} canShareLive={false} />)
    expect(screen.queryByRole('tab', { name: 'Share live' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    expect(mocks.getLiveShare).not.toHaveBeenCalled()
  })
})
