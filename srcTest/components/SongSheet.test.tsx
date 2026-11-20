// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import SongSheet from '../../src/components/SongSheet'
import type { Section } from '../../src/types/song'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const line = (text: string) => ({ kind: 'lyric' as const, text, chords: [{ pos: 0, chord: 'G' }] })
const sections: Section[] = ['Verse 1', 'Chorus', 'Bridge'].map((label) => ({
  type: 'Verse',
  label,
  lines: [line('Coming back to just me and you')],
}))

/** Fake a 400px wide grid with 10px character cells and the given rendered column tracks. */
function mockLayout(gridTemplateColumns: string) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.textContent === '0000000000' ? 100 : 0
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }
  })
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) =>
    element.classList.contains('song-sheet-grid')
      ? ({ columnGap: '24px', gridTemplateColumns } as CSSStyleDeclaration)
      : real(element),
  )
}

function renderedRows(container: HTMLElement) {
  return container.querySelectorAll('div.font-mono.whitespace-pre').length
}

describe('SongSheet wrap width', () => {
  it('uses the full width when a multi-column layout is stacked into one column', () => {
    mockLayout('400px')
    const { container } = render(<SongSheet sections={sections} columns={3} wrapLines />)
    expect(renderedRows(container)).toBe(3)
  })

  it('still splits the width between columns when they sit side by side', () => {
    mockLayout('120px 120px 120px')
    const { container } = render(<SongSheet sections={sections} columns={3} wrapLines />)
    expect(renderedRows(container)).toBeGreaterThan(3)
  })
})

describe('SongSheet title block', () => {
  it('draws the block once, above the first section of column 1', () => {
    mockLayout('120px 120px 120px')
    const { container, getAllByText } = render(
      <SongSheet sections={sections} columns={3} titleBlock={<div data-testid="title">Morning</div>} />,
    )
    const blocks = getAllByText('Morning')
    expect(blocks).toHaveLength(1)
    const firstColumn = container.querySelector('.song-sheet-grid > div')
    expect(firstColumn?.firstElementChild).toBe(blocks[0])
  })

  it('draws nothing extra without a title block', () => {
    mockLayout('120px 120px 120px')
    const { container } = render(<SongSheet sections={sections} columns={3} />)
    const firstColumn = container.querySelector('.song-sheet-grid > div')
    expect(firstColumn?.firstElementChild?.className).toContain('section-block')
  })
})
