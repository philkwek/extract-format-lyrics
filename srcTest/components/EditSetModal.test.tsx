// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditSetModal from '../../src/components/EditSetModal'
import type { Session } from '../../src/lib/sessionStore'

vi.mock('../../src/lib/fileOptimizer', () => ({
  prepareFilesForExtraction: vi.fn(async () => [
    {
      mimeType: 'application/pdf',
      base64Data: 'pdf-bytes',
      fileName: 'sheet.pdf',
      previewUrl: '',
    },
  ]),
}))

vi.mock('../../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/api')>('../../src/lib/api')
  return {
    ...actual,
    extractSongsApi: vi.fn(async () => [
      {
        id: 'song-1',
        title: 'Amazing Grace',
        artist: 'John Newton',
        sourceUrl: 'https://example.test/amazing-grace',
        sourceSite: 'Demo',
        originalKey: 'G',
        sections: [
          {
            type: 'Verse' as const,
            label: 'Verse 1',
            lines: [{ kind: 'lyric' as const, text: 'Amazing grace', chords: [] }],
          },
        ],
      },
    ]),
  }
})

afterEach(cleanup)

const session: Session = {
  id: 'session-1',
  createdAt: 0,
  name: 'Sunday Set',
  songs: [],
}

function renderEditSetModal() {
  render(
    <EditSetModal
      isOpen
      onClose={vi.fn()}
      session={session}
      onArrange={vi.fn()}
      onSessionUpdated={vi.fn()}
      onImportUploadedSongs={vi.fn()}
    />,
  )
}

describe('EditSetModal upload flow', () => {
  it('only stretches the dialog once extracted songs are being reviewed', async () => {
    const user = userEvent.setup()
    renderEditSetModal()

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).not.toContain('h-[88dvh]')

    await user.click(screen.getByRole('tab', { name: /Upload sheet/ }))
    expect(dialog.className).not.toContain('h-[88dvh]')

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).toBeTruthy()
    fireEvent.change(fileInput!, {
      target: { files: [new File(['pdf'], 'sheet.pdf', { type: 'application/pdf' })] },
    })

    await user.click(screen.getByRole('button', { name: /Extract with Gemini \(1\)/ }))
    await screen.findByRole('button', { name: /Import 1 Song to Setlist/ })

    expect(dialog.className).toContain('h-[88dvh]')

    await user.click(screen.getByRole('button', { name: /Back to Upload/ }))
    expect(dialog.className).not.toContain('h-[88dvh]')
  })
})
