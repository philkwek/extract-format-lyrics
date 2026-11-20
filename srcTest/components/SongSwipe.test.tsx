// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SongSwipe, { decideSwipe } from '../../src/components/SongSwipe'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
})

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

interface SwipeProps {
  enabled?: boolean
  canPrev?: boolean
  canNext?: boolean
  prevTitle?: string
  nextTitle?: string
  onPrev?: () => void
  onNext?: () => void
}

function renderSwipe({
  enabled = true,
  canPrev = true,
  canNext = true,
  prevTitle = 'Early Light',
  nextTitle = 'Lantern Song',
  onPrev = vi.fn(),
  onNext = vi.fn(),
}: SwipeProps = {}) {
  render(
    <SongSwipe
      contentKey={0}
      enabled={enabled}
      canPrev={canPrev}
      canNext={canNext}
      prevTitle={prevTitle}
      nextTitle={nextTitle}
      onPrev={onPrev}
      onNext={onNext}
    >
      <p>Sheet body</p>
    </SongSwipe>,
  )
  return { onPrev, onNext }
}

describe('decideSwipe', () => {
  it('commits a drag past a third of the width', () => {
    expect(decideSwipe(-400, 0, 900, true, true)).toBe('next')
    expect(decideSwipe(400, 0, 900, true, true)).toBe('prev')
  })

  it('stays put below the distance threshold', () => {
    expect(decideSwipe(-200, 0, 900, true, true)).toBe('cancel')
    expect(decideSwipe(200, 0, 900, true, true)).toBe('cancel')
  })

  it('commits a quick flick even below the distance threshold', () => {
    expect(decideSwipe(-80, -700, 900, true, true)).toBe('next')
    expect(decideSwipe(80, 700, 900, true, true)).toBe('prev')
  })

  it('ignores velocity that fights the offset', () => {
    expect(decideSwipe(-80, 700, 900, true, true)).toBe('cancel')
    expect(decideSwipe(80, -700, 900, true, true)).toBe('cancel')
  })

  it('never commits a song past either end of the set', () => {
    expect(decideSwipe(-400, -700, 900, true, false)).toBe('cancel')
    expect(decideSwipe(400, 700, 900, false, true)).toBe('cancel')
  })
})

describe('SongSwipe chevrons', () => {
  it('shows only the chevron whose neighbour exists', () => {
    renderSwipe({ canPrev: false })

    expect(screen.queryByRole('button', { name: 'Previous song: Early Light' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Next song: Lantern Song' })).toBeTruthy()
  })

  it('shows no chevrons in a one-song set', () => {
    renderSwipe({ canPrev: false, canNext: false })

    expect(screen.queryByRole('button', { name: /song:/ })).toBeNull()
  })

  it('selects the neighbouring songs from the chevrons', async () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    renderSwipe({ onPrev, onNext })

    fireEvent.click(screen.getByRole('button', { name: 'Next song: Lantern Song' }))
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1), { timeout: 2000 })

    fireEvent.click(screen.getByRole('button', { name: 'Previous song: Early Light' }))
    await waitFor(() => expect(onPrev).toHaveBeenCalledTimes(1), { timeout: 2000 })
  })
})

describe('SongSwipe hint pill', () => {
  it('shows the next song on the first three opens only', async () => {
    for (let open = 1; open <= 3; open += 1) {
      const { unmount } = render(
        <SongSwipe
          contentKey={0}
          enabled
          canPrev={false}
          canNext
          prevTitle=""
          nextTitle="Lantern Song"
          onPrev={vi.fn()}
          onNext={vi.fn()}
        >
          <p>Sheet body</p>
        </SongSwipe>,
      )

      expect(await screen.findByText('Lantern Song')).toBeTruthy()
      expect(localStorage.getItem('sets_swipe_hint_count')).toBe(String(open))
      unmount()
    }

    render(
      <SongSwipe
        contentKey={0}
        enabled
        canPrev={false}
        canNext
        prevTitle=""
        nextTitle="Lantern Song"
        onPrev={vi.fn()}
        onNext={vi.fn()}
      >
        <p>Sheet body</p>
      </SongSwipe>,
    )

    expect(screen.queryByText('Lantern Song')).toBeNull()
  })

  it('does not show a hint when there is no next song', () => {
    renderSwipe({ canNext: false })

    expect(screen.queryByText('Lantern Song')).toBeNull()
    expect(screen.queryByRole('button', { name: /next song/i })).toBeNull()
  })
})

describe('SongSwipe disabled', () => {
  it('renders only the sheet and no swipe controls', () => {
    renderSwipe({ enabled: false })

    expect(screen.getByText('Sheet body')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /song:/ })).toBeNull()
    expect(screen.queryByText('Lantern Song')).toBeNull()
  })
})

function trackOffset(track: HTMLElement): number {
  const match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform)
  return match ? Number(match[1]) : 0
}

describe('SongSwipe track', () => {
  it('renders the pages inside one moving track', () => {
    render(
      <SongSwipe
        contentKey={0}
        enabled
        canPrev={false}
        canNext
        prevTitle=""
        nextTitle="Lantern Song"
        onPrev={vi.fn()}
        onNext={vi.fn()}
      >
        <p>Sheet body</p>
        <p>Next sheet</p>
      </SongSwipe>,
    )

    const track = document.querySelector<HTMLElement>('[data-song-track]')
    expect(track).toBeTruthy()
    expect(track!.contains(screen.getByText('Sheet body'))).toBe(true)
    expect(track!.contains(screen.getByText('Next sheet'))).toBe(true)
  })

  it('slides the track towards the neighbour and resets it when the content key changes', async () => {
    const onNext = vi.fn()
    const view = render(
      <SongSwipe
        contentKey={0}
        enabled
        canPrev={false}
        canNext
        prevTitle=""
        nextTitle="Lantern Song"
        onPrev={vi.fn()}
        onNext={onNext}
      >
        <p>Sheet body</p>
        <p>Next sheet</p>
      </SongSwipe>,
    )

    const track = document.querySelector<HTMLElement>('[data-song-track]')!
    fireEvent.click(screen.getByRole('button', { name: 'Next song: Lantern Song' }))
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1), { timeout: 2000 })
    await waitFor(() => expect(trackOffset(track)).toBeLessThan(0))

    // The neighbours shift left in the same commit, so the track must return to 0.
    view.rerender(
      <SongSwipe
        contentKey={1}
        enabled
        canPrev
        canNext={false}
        prevTitle="Early Light"
        nextTitle=""
        onPrev={vi.fn()}
        onNext={onNext}
      >
        <p>Sheet body</p>
        <p>Next sheet</p>
      </SongSwipe>,
    )

    await waitFor(() => expect(trackOffset(track)).toBe(0))
  })
})
