// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddSongSearchPanel from '../../../src/components/editSet/AddSongSearchPanel'
import { searchApiStream } from '../../../src/lib/api'
import { importSources } from '../../../src/lib/setlistImport'

vi.mock('../../../src/lib/setlistImport', async () => ({
  ...(await vi.importActual('../../../src/lib/setlistImport')),
  importSources: vi.fn(),
}))
vi.mock('../../../src/lib/api', async () => ({
  ...(await vi.importActual('../../../src/lib/api')),
  searchApiStream: vi.fn(),
}))
vi.mock('../../../src/lib/analytics', async () => ({
  ...(await vi.importActual('../../../src/lib/analytics')),
  trackEvent: vi.fn(),
  trackSearchTiming: vi.fn(),
  trackSongImport: vi.fn(),
}))

const candidate = {
  site: 'pnwchords',
  title: 'Good Grace',
  artist: 'Hillsong Worship',
  url: 'https://pnwchords.com/good-grace',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(searchApiStream).mockResolvedValue({
    query: 'Good Grace',
    results: [candidate],
    sources: [],
    partial: false,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderPanel() {
  const onSessionUpdated = vi.fn()
  render(<AddSongSearchPanel sessionId="session-1" onSessionUpdated={onSessionUpdated} />)
  return { onSessionUpdated }
}

async function runSearch(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByPlaceholderText(/Goodness of God, Way Maker/)
  await user.type(input, 'Good Grace')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByText(candidate.title)
}

describe('AddSongSearchPanel add failures', () => {
  it('changes the button to Failed to add and does not alert', async () => {
    const user = userEvent.setup()
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.mocked(importSources).mockRejectedValue(new Error('That page has no chords.'))
    renderPanel()
    await runSearch(user)

    await user.click(screen.getByRole('button', { name: 'Add to setlist' }))

    expect(await screen.findByRole('button', { name: 'Failed to add' })).toBeTruthy()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('shows the reason in a dialog without importing again, and Close closes it', async () => {
    const user = userEvent.setup()
    vi.mocked(importSources).mockRejectedValue(new Error('That page has no chords.'))
    renderPanel()
    await runSearch(user)
    await user.click(screen.getByRole('button', { name: 'Add to setlist' }))
    await screen.findByRole('button', { name: 'Failed to add' })

    await user.click(screen.getByRole('button', { name: 'Failed to add' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText("Couldn't add this song")).toBeTruthy()
    expect(within(dialog).getByText(candidate.title)).toBeTruthy()
    expect(within(dialog).getByText('That page has no chords.')).toBeTruthy()
    expect(importSources).toHaveBeenCalledTimes(1)

    await user.click(within(dialog).getByText('Close'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(importSources).toHaveBeenCalledTimes(1)
  })

  it('still shows Added ✓ after a successful add', async () => {
    const user = userEvent.setup()
    vi.mocked(importSources).mockResolvedValue({
      session: { id: 'session-1', createdAt: 0, name: 'Sunday Set', songs: [] },
      items: [],
      outcomes: [],
      imported: 1,
      attempted: 1,
      firstNewIndex: 0,
      failures: [],
    })
    const { onSessionUpdated } = renderPanel()
    await runSearch(user)

    await user.click(screen.getByRole('button', { name: 'Add to setlist' }))

    expect(await screen.findByRole('button', { name: 'Added ✓' })).toBeTruthy()
    expect(onSessionUpdated).toHaveBeenCalled()
  })
})
