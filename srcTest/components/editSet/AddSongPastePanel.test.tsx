// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddSongPastePanel from '../../../src/components/editSet/AddSongPastePanel'
import { importSources } from '../../../src/lib/setlistImport'

vi.mock('../../../src/lib/setlistImport', async () => ({
  ...(await vi.importActual('../../../src/lib/setlistImport')),
  importSources: vi.fn(),
}))

vi.mock('../../../src/lib/analytics', async () => ({
  ...(await vi.importActual('../../../src/lib/analytics')),
  trackSongImport: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('AddSongPastePanel', () => {
  it('keeps pasted links in the textarea when every link fails to import', async () => {
    const user = userEvent.setup()
    const failedUrl = 'https://essentialworship.com/songs/broken-chart'
    vi.mocked(importSources).mockResolvedValue({
      session: { id: 'session-1', createdAt: 0, name: 'Sunday Set', songs: [] },
      items: [],
      outcomes: [{ url: failedUrl, reason: 'Blocked' }],
      failures: [{ url: failedUrl, reason: 'Blocked' }],
      imported: 0,
      attempted: 1,
      firstNewIndex: 0,
    })

    const onSessionUpdated = vi.fn()
    render(<AddSongPastePanel sessionId="session-1" onSessionUpdated={onSessionUpdated} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(textarea, failedUrl)
    await user.click(screen.getByRole('button', { name: 'Add to setlist' }))

    expect(await screen.findByText(/No songs could be added/i)).toBeTruthy()
    expect(textarea.value).toBe(failedUrl)
    expect(onSessionUpdated).not.toHaveBeenCalled()
  })
})
