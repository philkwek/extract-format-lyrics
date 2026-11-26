// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PresenterConsole from '../../../src/components/presenter/PresenterConsole'
import {
  resetPresenterEditsStore,
  setPresenterEditsStoreForTesting,
  type PresenterEditsStore,
} from '../../../src/lib/presenterEdits'
import type { PresenterFeedState } from '../../../src/lib/usePresenterFeed'
import type { OutputState } from '../../../src/lib/presenterChannel'
import type { SharedLyricsPayload } from '../../../src/types/song'

vi.mock('../../../src/lib/analytics', async () => ({
  ...(await vi.importActual('../../../src/lib/analytics')),
  trackEvent: vi.fn(),
}))

const lyrics: SharedLyricsPayload = {
  v: 1,
  name: 'Sunday Morning Set',
  songs: [
    {
      entryId: 'entry-1',
      title: 'First Song',
      artist: 'Demo Artist',
      sections: [
        { label: 'Verse 1', lines: ['First line'] },
        { label: 'Chorus', lines: ['Second line'] },
      ],
    },
    {
      entryId: 'entry-2',
      title: 'Second Song',
      sections: [{ label: 'Bridge', lines: ['Third line'] }],
    },
  ],
}

const sent: unknown[] = []

class FakeBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null

  public name: string

  constructor(name: string) {
    this.name = name
  }

  postMessage(data: unknown) {
    sent.push(data)
  }

  close() {}
}

function live(currentEntryId: string | null = 'entry-1'): PresenterFeedState {
  return { status: 'live', lyrics, currentEntryId }
}

function renderConsole(feed: PresenterFeedState = live()) {
  return render(<PresenterConsole id="pub-1" feed={feed} onSwitchToAuto={vi.fn()} />)
}

function lastState(): OutputState {
  const messages = sent.filter(
    (message): message is { type: 'state'; state: OutputState } =>
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: string }).type === 'state',
  )
  return messages[messages.length - 1].state
}

function createMemoryEditsStore(): PresenterEditsStore {
  const map = new Map<string, unknown>()
  return {
    get: async <T,>(key: string) => map.get(key) as T | undefined,
    set: async (key: string, val: unknown) => {
      map.set(key, val)
    },
    del: async (key: string) => {
      map.delete(key)
    },
  }
}

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  setPresenterEditsStoreForTesting(createMemoryEditsStore())
  document.documentElement.classList.remove('dark')
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  cleanup()
  resetPresenterEditsStore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PresenterConsole', () => {
  it('shows the songs and marks the host song and projected song', () => {
    renderConsole()

    expect(screen.getByText('Presenter · Sunday Morning Set')).toBeTruthy()
    expect(screen.getAllByText('First Song').length).toBeGreaterThan(0)
    expect(screen.getByText('Demo Artist')).toBeTruthy()
    expect(screen.getByText('Host is here')).toBeTruthy()
    expect(screen.getAllByText('On screen').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: /First Song/ }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('starts on the host song and first section', () => {
    renderConsole(live('entry-2'))

    expect(lastState()).toMatchObject({
      view: 'sections',
      sectionIndex: 0,
      song: { entryId: 'entry-2' },
    })
  })

  it('publishes the section when a section card is clicked', () => {
    renderConsole()

    fireEvent.click(screen.getByRole('button', { name: /Chorus/ }))

    expect(lastState()).toMatchObject({
      view: 'sections',
      sectionIndex: 1,
      song: { entryId: 'entry-1' },
    })
  })

  it('moves to the next section and then the next song with the keyboard', () => {
    renderConsole()

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(lastState()).toMatchObject({ sectionIndex: 1, song: { entryId: 'entry-1' } })

    fireEvent.keyDown(window, { key: ' ' })
    expect(lastState()).toMatchObject({ sectionIndex: 0, song: { entryId: 'entry-2' } })

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(lastState()).toMatchObject({ sectionIndex: 1, song: { entryId: 'entry-1' } })
  })

  it('switches whole view and hides section positioning', () => {
    renderConsole()

    expect(screen.getByText('Section positioning')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Whole song' }))

    expect(lastState().view).toBe('whole')
    expect(screen.queryByText('Section positioning')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Sections' }))

    expect(screen.getByText('Section positioning')).toBeTruthy()
  })

  it('shows the stopped message and keeps the last songs', () => {
    renderConsole({ status: 'stopped', lyrics, currentEntryId: 'entry-1' })

    expect(screen.getByText('The host stopped sharing these lyrics.')).toBeTruthy()
    expect(screen.getAllByText('First Song').length).toBeGreaterThan(0)
  })

  it('edits lyrics locally, projects them, survives host updates, and resets', () => {
    const view = renderConsole()

    fireEvent.click(screen.getByRole('button', { name: 'Edit song lyrics and titles' }))
    expect(screen.getByText('Editing: First Song')).toBeTruthy()
    expect(screen.queryByRole('button', { name: "Reset to host's version" })).toBeNull()

    const titleInputs = screen.getAllByLabelText('Section title') as HTMLInputElement[]
    const lyricsBoxes = screen.getAllByLabelText('Lyrics') as HTMLTextAreaElement[]

    fireEvent.change(titleInputs[0], { target: { value: 'Verse 1 (Local)' } })
    fireEvent.change(lyricsBoxes[0], { target: { value: 'Updated local line\nSecond line' } })
    expect(screen.getByText('Edited')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByText('Edited on this laptop')).toBeTruthy()
    expect(lastState().song?.sections[0]).toEqual({
      label: 'Verse 1 (Local)',
      lines: ['Updated local line', 'Second line'],
    })

    const updatedHostLyrics: SharedLyricsPayload = {
      ...lyrics,
      songs: [
        {
          ...lyrics.songs[0],
          sections: [
            { label: 'Verse 1', lines: ['Host changed this'] },
            { label: 'Chorus', lines: ['Host chorus'] },
          ],
        },
        lyrics.songs[1],
      ],
    }
    view.rerender(
      <PresenterConsole
        id="pub-1"
        feed={{ status: 'live', lyrics: updatedHostLyrics, currentEntryId: 'entry-1' }}
        onSwitchToAuto={vi.fn()}
      />,
    )

    expect(lastState().song?.sections[0]).toEqual({
      label: 'Verse 1 (Local)',
      lines: ['Updated local line', 'Second line'],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit song lyrics and titles' }))
    fireEvent.click(screen.getByRole('button', { name: "Reset to host's version" }))

    expect(screen.queryByText('Edited on this laptop')).toBeNull()
    expect(lastState().song?.sections[0]).toEqual({
      label: 'Verse 1',
      lines: ['Host changed this'],
    })
  })

  it('deletes the edit if saved identical to the host version', () => {
    renderConsole()

    fireEvent.click(screen.getByRole('button', { name: 'Edit song lyrics and titles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.queryByText('Edited on this laptop')).toBeNull()
  })

  it('disables keyboard shortcuts while editing and keeps editor on its song when another song is projected', () => {
    renderConsole()

    fireEvent.click(screen.getByRole('button', { name: 'Edit song lyrics and titles' }))

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: 'PageDown' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'PageUp' })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(lastState()).toMatchObject({
      song: { entryId: 'entry-1' },
      sectionIndex: 0,
      blackout: false,
    })

    fireEvent.click(screen.getByRole('button', { name: /Second Song/ }))
    expect(lastState().song?.entryId).toBe('entry-2')
    expect(screen.getByText('Editing: First Song')).toBeTruthy()
  })

  it('confirms section deletion, cancels cleanly, and restores via Undo', async () => {
    renderConsole()

    fireEvent.click(screen.getByRole('button', { name: 'Edit song lyrics and titles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Verse 1' }))

    expect(screen.getByText('Remove this section?')).toBeTruthy()
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButtons[cancelButtons.length - 1])
    await waitFor(() => {
      expect(screen.queryByText('Remove this section?')).toBeNull()
    })
    expect(screen.getByDisplayValue('Verse 1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Verse 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.getAllByText('Section removed').length).toBeGreaterThan(0)
    expect(screen.queryByDisplayValue('Verse 1')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    const titleInputs = screen.getAllByLabelText('Section title') as HTMLInputElement[]
    expect(titleInputs.map((input) => input.value)).toEqual(['Verse 1', 'Chorus'])
  })

  it('saves deleted sections even during the undo window and resets to host version', () => {
    renderConsole()

    fireEvent.click(screen.getByRole('button', { name: 'Edit song lyrics and titles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Chorus' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByText('Edited on this laptop')).toBeTruthy()
    expect(lastState().song?.sections).toEqual([{ label: 'Verse 1', lines: ['First line'] }])

    fireEvent.click(screen.getByRole('button', { name: 'Edit song lyrics and titles' }))
    fireEvent.click(screen.getByRole('button', { name: "Reset to host's version" }))

    expect(screen.queryByText('Edited on this laptop')).toBeNull()
    expect(lastState().song?.sections).toHaveLength(2)
  })

  it('disables removing the last remaining section', () => {
    renderConsole(live('entry-2'))

    fireEvent.click(screen.getByRole('button', { name: 'Edit song lyrics and titles' }))
    const removeButton = screen.getByRole('button', { name: 'Remove Bridge' }) as HTMLButtonElement
    expect(removeButton.disabled).toBe(true)
  })
})
