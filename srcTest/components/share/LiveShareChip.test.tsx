// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import LiveShareChip from '../../../src/components/share/LiveShareChip'
import { getLiveShare } from '../../../src/lib/liveShareSync'

vi.mock('../../../src/lib/liveShareSync', () => ({
  getLiveShare: vi.fn(),
  subscribeLiveShare: vi.fn(() => () => {}),
  subscribeLiveShareStatus: vi.fn(() => () => {}),
}))

afterEach(cleanup)

describe('LiveShareChip', () => {
  it('says Sharing live when the set is shared live', async () => {
    vi.mocked(getLiveShare).mockResolvedValue({ url: 'u' } as never)
    render(<LiveShareChip sessionId="s1" />)
    expect(await screen.findByText('Sharing live')).toBeTruthy()
  })

  it('shows nothing when the set is not shared live', async () => {
    vi.mocked(getLiveShare).mockResolvedValue(null)
    const { container } = render(<LiveShareChip sessionId="s1" />)
    await Promise.resolve()
    expect(container.textContent).toBe('')
  })
})
