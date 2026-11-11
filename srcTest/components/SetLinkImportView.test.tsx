// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import SetLinkImportView from '../../src/components/SetLinkImportView'
import { loadSetLinkPreview } from '../../src/lib/setLinkImport'
import { sessionStore } from '../../src/lib/sessionStore'

vi.mock('../../src/lib/setLinkImport', () => ({
  loadSetLinkPreview: vi.fn(),
}))

vi.mock('../../src/lib/sessionStore', () => ({
  sessionPath: (s: { id: string; publicId?: string }) => `/session/${s.publicId ?? s.id}`,
  sessionStore: { findByImportedLinkId: vi.fn() },
}))

const findSavedCopy = vi.mocked(sessionStore.findByImportedLinkId)

vi.mock('../../src/lib/analytics', () => ({ trackEvent: vi.fn() }))

const PUBLIC_ID = 'abcdefghijklmnopqrstuv'

const preview = {
  linkId: PUBLIC_ID,
  name: 'Shared Sunday',
  items: [
    {
      entryId: 'entry-1',
      url: 'https://example.test/great-are-you-lord',
      title: 'Great Are You Lord',
      artist: 'All Sons & Daughters',
    },
  ],
  failures: [],
  snapshot: [{ entryId: 'entry-1', url: 'https://example.test/great-are-you-lord' }],
}

const savedCopy = {
  id: 'copy-1',
  publicId: 'copy-pub',
  createdAt: 0,
  name: 'My Copy',
  songs: [],
}

function LocationProbe() {
  const loc = useLocation()
  return (
    <>
      <output data-testid="loc">{loc.pathname}</output>
      <output data-testid="state">{JSON.stringify(loc.state)}</output>
    </>
  )
}

function renderView() {
  const onPreview = vi.fn()
  render(
    <MemoryRouter initialEntries={[`/session/${PUBLIC_ID}`]}>
      <LocationProbe />
      <Routes>
        <Route
          path={`/session/${PUBLIC_ID}`}
          element={<SetLinkImportView linkId={PUBLIC_ID} onPreview={onPreview} />}
        />
        <Route path="/session/copy-pub" element={<p>Saved copy</p>} />
      </Routes>
    </MemoryRouter>,
  )
  return onPreview
}

beforeEach(() => {
  vi.mocked(loadSetLinkPreview).mockReset()
  findSavedCopy.mockReset()
  findSavedCopy.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
})

describe('SetLinkImportView', () => {
  it('passes a preview to onPreview with no saved copy', async () => {
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind: 'preview', preview } as never)
    const onPreview = renderView()

    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(preview, null))
  })

  it('passes the saved copy along with a preview', async () => {
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind: 'preview', preview } as never)
    findSavedCopy.mockResolvedValueOnce(savedCopy as never)
    const onPreview = renderView()

    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(preview, savedCopy))
  })

  it.each([
    ['expired', /This set link has expired/],
    ['missing', /This set isn.t available/],
    ['empty', /None of the songs could be loaded/],
  ] as const)('shows the %s card when no copy is saved', async (kind, title) => {
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind } as never)
    renderView()

    expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
    expect(findSavedCopy).toHaveBeenCalledWith(PUBLIC_ID)
  })

  it.each(['missing', 'expired', 'empty'] as const)(
    'opens the saved copy instead of showing the %s card',
    async (kind) => {
      vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind } as never)
      findSavedCopy.mockResolvedValueOnce(savedCopy as never)
      renderView()

      await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/session/copy-pub'))
      expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toEqual({
        fromSetLink: { kind, name: 'My Copy' },
      })
    },
  )

  it('logs the error and opens the saved copy when the link throws', async () => {
    const error = new Error('offline')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadSetLinkPreview).mockRejectedValueOnce(error)
    findSavedCopy.mockResolvedValueOnce(savedCopy as never)
    renderView()

    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/session/copy-pub'))
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toEqual({
      fromSetLink: { kind: 'error', name: 'My Copy' },
    })
    expect(logError).toHaveBeenCalledWith('Could not open set link', error)
    logError.mockRestore()
  })
})
