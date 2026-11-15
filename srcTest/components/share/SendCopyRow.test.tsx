// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SendCopyRow from '../../../src/components/share/SendCopyRow'
import type { Session } from '../../../src/lib/sessionStore'

const mocks = vi.hoisted(() => ({
  ensureSetLinkFresh: vi.fn<
    () => Promise<{ ok: true } | { ok: false; reason: 'empty' | 'too_many' | 'failed' }>
  >(async () => ({ ok: true })),
}))

vi.mock('../../../src/lib/setLinkSync', () => ({ ensureSetLinkFresh: mocks.ensureSetLinkFresh }))

const session: Session = {
  id: 'session-1',
  publicId: 'pub-1',
  createdAt: 0,
  name: 'Sunday Set',
  songs: [
    { entryId: 'e1', url: 'https://example.test/a', title: 'First Light', artist: 'Demo Band' },
  ],
}

const uploadsSession: Session = {
  ...session,
  songs: [{ ...session.songs[0], url: 'upload://x' }],
}

const writeText = vi.fn(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensureSetLinkFresh.mockResolvedValue({ ok: true })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SendCopyRow', () => {
  it('refreshes the set link, copies the set address and shows Copied', async () => {
    const order: string[] = []
    mocks.ensureSetLinkFresh.mockImplementationOnce(async () => {
      order.push('ensure')
      return { ok: true }
    })
    writeText.mockImplementationOnce(async () => {
      order.push('copy')
    })
    render(<SendCopyRow session={session} canShareLive />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await screen.findByRole('button', { name: 'Copied' })

    expect(mocks.ensureSetLinkFresh).toHaveBeenCalledWith(session)
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/session/pub-1`)
    expect(order).toEqual(['ensure', 'copy'])
  })

  it('shows the 30-song message as an alert and does not copy', async () => {
    mocks.ensureSetLinkFresh.mockResolvedValueOnce({ ok: false, reason: 'too_many' })
    render(<SendCopyRow session={session} canShareLive />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('A set link holds up to 30 songs. Remove some and try again.')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('shows the uploads note only for uploaded sheets with live sharing available', () => {
    const { unmount } = render(<SendCopyRow session={session} canShareLive />)
    expect(screen.queryByText(/Uploaded sheets/)).toBeNull()
    unmount()

    render(<SendCopyRow session={uploadsSession} canShareLive={false} />)
    expect(screen.queryByText(/Uploaded sheets/)).toBeNull()
    cleanup()

    render(<SendCopyRow session={uploadsSession} canShareLive />)
    expect(screen.getByText(/Uploaded sheets/)).toBeTruthy()
  })
})
