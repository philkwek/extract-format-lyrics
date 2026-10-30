// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ShareImportPage from '../../src/pages/ShareImportPage'
import { songCache } from '../../src/lib/songCache'
import { sessionStore } from '../../src/lib/sessionStore'
import { getShareApi } from '../../src/lib/api'
import type { Song } from '../../src/types/song'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}))
vi.mock('../../src/lib/analytics', async () => ({
  ...(await vi.importActual('../../src/lib/analytics')),
  trackEvent: vi.fn(),
  trackSongImport: vi.fn(),
}))
vi.mock('../../src/lib/api', async () => ({
  ...(await vi.importActual('../../src/lib/api')),
  searchApiStream: vi.fn(),
  scrapeApi: vi.fn(),
  createShareApi: vi.fn(),
  getShareApi: vi.fn(),
}))

const sharedSong = {
  sourceUrl: 'https://pnwchords.com/shared/',
  title: 'Shared title',
  artist: 'Shared artist',
  sections: [],
} as unknown as Song
const ownCachedSong = {
  sourceUrl: 'https://pnwchords.com/shared/',
  title: 'My own copy',
  artist: 'My own artist',
  sections: [],
} as unknown as Song

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(sessionStore, 'createSession').mockResolvedValue({
    id: 'imported-set',
    songs: [],
  } as never)
  vi.mocked(getShareApi).mockResolvedValue({
    v: 2,
    name: 'Shared set',
    songs: [{ entryId: 'entry-1', song: sharedSong, transpose: 0 }],
  } as never)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderImport() {
  render(
    <MemoryRouter initialEntries={['/s/abc']}>
      <Routes>
        <Route path="/s/:shortId" element={<ShareImportPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('shared set import', () => {
  it('keeps the cached song when the URL is already cached', async () => {
    vi.spyOn(songCache, 'getSong').mockResolvedValue(ownCachedSong)
    const saveSong = vi.spyOn(songCache, 'saveSong').mockResolvedValue()
    renderImport()
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(saveSong).not.toHaveBeenCalled()
  })

  it('caches the shared song when the URL is not cached yet', async () => {
    vi.spyOn(songCache, 'getSong').mockResolvedValue(null)
    const saveSong = vi.spyOn(songCache, 'saveSong').mockResolvedValue()
    renderImport()
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(saveSong).toHaveBeenCalledTimes(1)
    expect(saveSong).toHaveBeenCalledWith(sharedSong)
  })
})
