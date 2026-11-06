// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LiveFollowPage from '../../src/pages/LiveFollowPage'
import { openLiveShareOnce } from '../../src/lib/liveFollow'
import { trackEvent } from '../../src/lib/analytics'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}))
vi.mock('../../src/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../../src/lib/liveFollow', () => ({ openLiveShareOnce: vi.fn() }))

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/live/abc']}>
      <Routes>
        <Route path="/live/:liveId" element={<LiveFollowPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LiveFollowPage', () => {
  it('opens the set once it is ready', async () => {
    vi.mocked(openLiveShareOnce).mockResolvedValue({
      kind: 'opened',
      session: { id: 's1', publicId: 'pub', createdAt: 0, name: 'Set', songs: [] },
    })
    renderPage()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session/pub', { replace: true }))
    expect(trackEvent).toHaveBeenCalledWith('live_share_followed', { outcome: 'opened' })
  })

  it('explains a stopped share', async () => {
    vi.mocked(openLiveShareOnce).mockResolvedValue({ kind: 'stopped' })
    renderPage()
    expect(await screen.findByText('This live share was stopped. Ask the person sharing for a new link.')).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith('live_share_followed', { outcome: 'stopped' })
  })

  it('shows an error card when opening fails', async () => {
    vi.mocked(openLiveShareOnce).mockRejectedValue(new Error('x'))
    renderPage()
    expect(await screen.findByText('Could not open the live set')).toBeTruthy()
  })
})
