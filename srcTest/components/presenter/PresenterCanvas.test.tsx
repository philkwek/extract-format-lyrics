// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
})
