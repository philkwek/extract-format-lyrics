// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import PresenterCanvas from '../../../src/components/presenter/PresenterCanvas'
import type { PresenterDisplay } from '../../../src/lib/presenterSettings'
import type { SharedLyricsSong } from '../../../src/types/song'

const display: PresenterDisplay = {
  textScale: 100,
  align: null,
  caps: false,
  theme: 'dark',
  sectionPosition: 'center',
  lyricsView: 'whole',
}

const song: SharedLyricsSong = {
  entryId: 'entry-1',
  title: 'Demo Song',
  sections: [{ label: 'Verse 1', lines: ['A demo line'] }],
}

function blackoutLayer(container: HTMLElement) {
  return container.querySelector('.pointer-events-none.absolute.inset-0') as HTMLElement
}

describe('PresenterCanvas blackout', () => {
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('fades to black over the lyrics instead of removing them', () => {
    const { container } = render(
      <PresenterCanvas
        song={song}
        display={display}
        view="whole"
        sectionIndex={0}
        blackout={true}
        heightPx={1080}
      />,
    )

    expect(screen.getByText('A demo line')).toBeTruthy()
    expect(blackoutLayer(container).style.opacity).toBe('1')
    expect(blackoutLayer(container).style.transition).toBe('opacity 600ms ease')
  })

  it('shows the lyrics with the black layer hidden when blackout is off', () => {
    const { container } = render(
      <PresenterCanvas
        song={song}
        display={display}
        view="whole"
        sectionIndex={0}
        blackout={false}
        heightPx={1080}
      />,
    )

    expect(screen.getByText('A demo line')).toBeTruthy()
    expect(blackoutLayer(container).style.opacity).toBe('0')
  })

  it('shows the title but no lyrics on the blank section in both views', () => {
    for (const view of ['whole', 'sections'] as const) {
      const { unmount } = render(
        <PresenterCanvas
          song={song}
          display={{ ...display, lyricsView: view }}
          view={view}
          sectionIndex={-1}
          blackout={false}
          heightPx={1080}
        />,
      )

      expect(screen.getByText('Demo Song')).toBeTruthy()
      expect(screen.queryByText('A demo line')).toBeNull()
      expect(screen.queryByText('Verse 1')).toBeNull()
      unmount()
    }
  })

  it('aligns whole-song columns to the top regardless of sectionPosition', () => {
    const { container, rerender } = render(
      <PresenterCanvas
        song={song}
        display={{ ...display, sectionPosition: 'center' }}
        view="whole"
        sectionIndex={0}
        blackout={false}
        heightPx={1080}
      />,
    )

    const content = () => container.querySelector('[data-presenter-content]') as HTMLElement
    expect(content().className).toContain('items-start')
    expect(content().className).not.toContain('items-center')

    rerender(
      <PresenterCanvas
        song={song}
        display={{ ...display, sectionPosition: 'center' }}
        view="sections"
        sectionIndex={0}
        blackout={false}
        heightPx={1080}
      />,
    )

    expect(content().className).toContain('items-center')
  })

  it('uses symmetric top and bottom insets in centered section view so lyrics center on the window', () => {
    const { container, rerender } = render(
      <PresenterCanvas
        song={song}
        display={{ ...display, sectionPosition: 'center' }}
        view="sections"
        sectionIndex={0}
        blackout={false}
        heightPx={1080}
      />,
    )

    const frame = () =>
      container.querySelector('[data-presenter-content]')?.parentElement
        ?.parentElement as HTMLElement
    expect(frame().style.top).toBe('10.4%')
    expect(frame().style.bottom).toBe('10.4%')

    rerender(
      <PresenterCanvas
        song={song}
        display={{ ...display, sectionPosition: 'top' }}
        view="sections"
        sectionIndex={0}
        blackout={false}
        heightPx={1080}
      />,
    )
    expect(frame().style.top).toBe('10.4%')
    expect(frame().style.bottom).toBe('4%')

    rerender(
      <PresenterCanvas
        song={song}
        display={{ ...display, sectionPosition: 'center' }}
        view="whole"
        sectionIndex={0}
        blackout={false}
        heightPx={1080}
      />,
    )
    expect(frame().style.top).toBe('10.4%')
    expect(frame().style.bottom).toBe('4%')
  })

  it('switches sections within the same song immediately without fading', () => {
    vi.useFakeTimers()
    const multiSectionSong: SharedLyricsSong = {
      entryId: 'entry-1',
      title: 'Demo Song',
      sections: [
        { label: 'Verse 1', lines: ['First section line'] },
        { label: 'Chorus', lines: ['Second section line'] },
      ],
    }

    const { container, rerender } = render(
      <PresenterCanvas
        song={multiSectionSong}
        display={display}
        view="sections"
        sectionIndex={0}
        blackout={false}
        heightPx={1080}
      />,
    )

    const fadeWrapper = container.firstElementChild?.firstElementChild as HTMLElement
    expect(fadeWrapper.style.opacity).toBe('1')

    rerender(
      <PresenterCanvas
        song={multiSectionSong}
        display={display}
        view="sections"
        sectionIndex={1}
        blackout={false}
        heightPx={1080}
      />,
    )

    expect(screen.getByText('Second section line')).toBeTruthy()
    expect(fadeWrapper.style.opacity).toBe('1')

    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(fadeWrapper.style.opacity).toBe('1')

    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(fadeWrapper.style.opacity).toBe('1')
  })

  it('fades only the lyrics when moving into and out of the blank section', () => {
    vi.useFakeTimers()
    const props = { display, view: 'sections' as const, blackout: false, heightPx: 1080 }
    const { container, rerender } = render(
      <PresenterCanvas {...props} song={song} sectionIndex={0} />,
    )
    const fadeWrapper = container.firstElementChild?.firstElementChild as HTMLElement
    const lyricsFrame = container.querySelector('[style*="top: 10.4%"]') as HTMLElement

    rerender(<PresenterCanvas {...props} song={song} sectionIndex={-1} />)
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(lyricsFrame.style.opacity).toBe('0')
    expect(fadeWrapper.style.opacity).toBe('1')
    expect(screen.getByText('A demo line')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(lyricsFrame.style.opacity).toBe('1')
    expect(screen.getByText('Demo Song')).toBeTruthy()
    expect(screen.queryByText('A demo line')).toBeNull()

    rerender(<PresenterCanvas {...props} song={song} sectionIndex={0} />)
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(lyricsFrame.style.opacity).toBe('0')
    expect(screen.queryByText('A demo line')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(lyricsFrame.style.opacity).toBe('1')
    expect(screen.getByText('A demo line')).toBeTruthy()
  })

  it('fades out and back in when switching to a different song', () => {
    vi.useFakeTimers()
    const secondSong: SharedLyricsSong = {
      entryId: 'entry-2',
      title: 'Next Song',
      sections: [{ label: 'Verse 1', lines: ['Next song line'] }],
    }

    const { container, rerender } = render(
      <PresenterCanvas
        song={song}
        display={display}
        view="sections"
        sectionIndex={0}
        blackout={false}
        heightPx={1080}
      />,
    )

    const fadeWrapper = container.firstElementChild?.firstElementChild as HTMLElement
    expect(fadeWrapper.style.opacity).toBe('1')

    rerender(
      <PresenterCanvas
        song={secondSong}
        display={display}
        view="sections"
        sectionIndex={0}
        blackout={false}
        heightPx={1080}
      />,
    )

    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(fadeWrapper.style.opacity).toBe('0')
    expect(screen.getByText('Demo Song')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(fadeWrapper.style.opacity).toBe('1')
    expect(screen.getByText('Next Song')).toBeTruthy()
    expect(screen.getByText('Next song line')).toBeTruthy()
  })
})
