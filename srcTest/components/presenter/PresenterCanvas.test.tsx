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
    expect(blackoutLayer(container).style.transition).toBe('opacity 300ms ease')
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
      vi.advanceTimersByTime(150)
    })
    expect(fadeWrapper.style.opacity).toBe('1')
    expect(screen.getByText('Next Song')).toBeTruthy()
    expect(screen.getByText('Next song line')).toBeTruthy()
  })
})
