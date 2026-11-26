// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PresenterOutputPage from '../../src/pages/PresenterOutputPage'
import type { OutputState } from '../../src/lib/presenterChannel'
import type { PresenterDisplay } from '../../src/lib/presenterSettings'

const display: PresenterDisplay = {
  textScale: 100,
  align: null,
  caps: false,
  theme: 'dark',
  sectionPosition: 'center',
  lyricsView: 'sections',
}

const state: OutputState = {
  setName: 'Sunday Morning Set',
  song: {
    entryId: 'entry-1',
    title: 'Demo Song',
    sections: [{ label: 'Verse 1', lines: ['A demo line'] }],
  },
  view: 'sections',
  sectionIndex: 0,
  display,
  blackout: false,
}

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()

  public name: string

  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.push(this)
  }

  emitClose() {
    this.onmessage?.({ data: { type: 'close' } } as MessageEvent)
  }

  emit(next: OutputState) {
    this.onmessage?.({ data: { type: 'state', state: next } } as MessageEvent)
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/present/pub-1/output']}>
      <Routes>
        <Route path="/present/:id/output" element={<PresenterOutputPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  FakeBroadcastChannel.instances = []
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
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PresenterOutputPage', () => {
  it('waits in black before the console sends state', () => {
    renderPage()

    expect(screen.getByText('Waiting for the presenter console…')).toBeTruthy()
    expect(document.title).toBe('Presenter Screen')
    expect(FakeBroadcastChannel.instances[0].name).toBe('presenter:pub-1')
    expect(FakeBroadcastChannel.instances[0].postMessage).toHaveBeenCalledWith({
      type: 'hello',
    })
  })

  it('closes its window when the console asks it to', () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    renderPage()

    act(() => FakeBroadcastChannel.instances[0].emitClose())

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('renders the state it receives and applies the display theme', () => {
    renderPage()

    act(() => FakeBroadcastChannel.instances[0].emit(state))

    expect(screen.getByText('Demo Song')).toBeTruthy()
    expect(screen.getByText('Verse 1')).toBeTruthy()
    expect(screen.getByText('A demo line')).toBeTruthy()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('says goodbye when it closes', () => {
    renderPage()

    cleanup()

    expect(FakeBroadcastChannel.instances[0].postMessage).toHaveBeenCalledWith({ type: 'bye' })
    expect(FakeBroadcastChannel.instances[0].close).toHaveBeenCalled()
  })

  it('hides the full-screen button 800ms after pointer activity', () => {
    vi.useFakeTimers()
    renderPage()

    fireEvent.mouseMove(window)
    const button = screen.getByRole('button', { name: 'Go full screen' })
    const corner = button.closest('div.fixed')
    expect(corner?.className).toContain('opacity-100')

    act(() => {
      vi.advanceTimersByTime(800)
    })

    expect(corner?.className).toContain('opacity-0')
  })

  it('keeps the full-screen button visible while hovered and hides 800ms after mouse leave', () => {
    vi.useFakeTimers()
    renderPage()

    fireEvent.mouseMove(window)
    const corner = screen.getByRole('button', { name: 'Go full screen' }).closest('div.fixed')!
    fireEvent.mouseEnter(corner)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(corner.className).toContain('opacity-100')

    fireEvent.mouseLeave(corner)
    act(() => {
      vi.advanceTimersByTime(799)
    })
    expect(corner.className).toContain('opacity-100')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(corner.className).toContain('opacity-0')
  })
})
