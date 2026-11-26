// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import PresenterConsole from '../../../src/components/presenter/PresenterConsole'
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

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
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
})
