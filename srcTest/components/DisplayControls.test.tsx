// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import DisplayControls from '../../src/components/DisplayControls'
import type { SongDisplayPrefs } from '../../src/lib/songPrefs'

afterEach(() => {
  cleanup()
})

const defaultPrefs: SongDisplayPrefs = {
  columns: 2,
  fontSizePx: 14,
  darkMode: false,
  simplified: false,
}

describe('DisplayControls — Play Ambient Pad button', () => {
  it('renders Play Ambient Pad button immediately to the left of Simplify button', () => {
    const onTogglePad = vi.fn()
    render(
      <DisplayControls
        prefs={defaultPrefs}
        onChangePrefs={vi.fn()}
        canSimplify={true}
        currentKey="G"
        isPadPlaying={false}
        onTogglePad={onTogglePad}
      />
    )

    const padButton = screen.getByRole('button', { name: 'Play Ambient Pad' })
    const simplifyButton = screen.getByRole('button', { name: 'Simplify' })

    expect(padButton).toBeTruthy()
    expect(simplifyButton).toBeTruthy()

    // Ensure Play Ambient Pad appears before Simplify in DOM order
    const position = padButton.compareDocumentPosition(simplifyButton)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(padButton)
    expect(onTogglePad).toHaveBeenCalledTimes(1)
  })

  it('displays Playing Pad (<Key>) and aria-pressed=true when pad is playing', () => {
    render(
      <DisplayControls
        prefs={defaultPrefs}
        onChangePrefs={vi.fn()}
        canSimplify={true}
        currentKey="Eb"
        isPadPlaying={true}
        onTogglePad={vi.fn()}
      />
    )

    const padButton = screen.getByRole('button', { name: 'Playing Pad (Eb)' })
    expect(padButton.getAttribute('aria-pressed')).toBe('true')
  })

  it('renders Pads Key slider defaulting to Match Song Key without custom key dropdown', () => {
    const onChangePadKeyMode = vi.fn()
    render(
      <DisplayControls
        prefs={defaultPrefs}
        onChangePrefs={vi.fn()}
        currentKey="G"
        padKeyMode="match"
        customPadKey="A"
        onChangePadKeyMode={onChangePadKeyMode}
        onSelectCustomPadKey={vi.fn()}
        onTogglePad={vi.fn()}
      />
    )

    expect(screen.getByText('Pads Key:')).toBeTruthy()
    const matchTab = screen.getByRole('tab', { name: 'Match Song' })
    const customTab = screen.getByRole('tab', { name: 'Custom' })
    expect(matchTab.getAttribute('aria-selected')).toBe('true')
    expect(customTab.getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByLabelText('Custom pad key')).toBeNull()

    fireEvent.click(customTab)
    expect(onChangePadKeyMode).toHaveBeenCalledWith('custom')
  })

  it('shows custom key dropdown on the right when Custom Key is selected and uses custom key for pad playback label', () => {
    const onSelectCustomPadKey = vi.fn()
    render(
      <DisplayControls
        prefs={defaultPrefs}
        onChangePrefs={vi.fn()}
        currentKey="G"
        padKeyMode="custom"
        customPadKey="A"
        isPadPlaying={true}
        onChangePadKeyMode={vi.fn()}
        onSelectCustomPadKey={onSelectCustomPadKey}
        onTogglePad={vi.fn()}
      />
    )

    const customTab = screen.getByRole('tab', { name: 'Custom' })
    const dropdown = screen.getByLabelText('Custom pad key') as HTMLSelectElement
    expect(dropdown.value).toBe('A')

    // Ensure custom key dropdown appears to the right (after) the Pads Key segmented control
    const position = customTab.compareDocumentPosition(dropdown)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Ensure Playing Pad button shows the custom key (A) rather than the song key (G)
    expect(screen.getByRole('button', { name: 'Playing Pad (A)' })).toBeTruthy()

    fireEvent.change(dropdown, { target: { value: 'Bb' } })
    expect(onSelectCustomPadKey).toHaveBeenCalledWith('Bb')
  })

  it('defaults the Custom Key dropdown to the current song key when switching from Match Song Key', () => {
    render(
      <DisplayControls
        prefs={defaultPrefs}
        onChangePrefs={vi.fn()}
        currentKey="D"
        padKeyMode="custom"
        onChangePadKeyMode={vi.fn()}
        onSelectCustomPadKey={vi.fn()}
        onTogglePad={vi.fn()}
      />
    )

    const dropdown = screen.getByLabelText('Custom pad key') as HTMLSelectElement
    expect(dropdown.value).toBe('D')
  })
})

describe('DisplayControls — columns and fit', () => {
  it('offers four manual columns', () => {
    const onChangePrefs = vi.fn()
    render(<DisplayControls prefs={defaultPrefs} onChangePrefs={onChangePrefs} />)

    const fourthColumn = screen.getByRole('button', { name: '4' })
    expect(fourthColumn.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(fourthColumn)
    expect(onChangePrefs).toHaveBeenCalledWith(
      expect.objectContaining({ columns: 4 })
    )
  })

  it('marks the manual column active and leaves Fit available', () => {
    const onChangePrefs = vi.fn()
    const onToggleFit = vi.fn()
    render(
      <DisplayControls
        prefs={{ ...defaultPrefs, columns: 3 }}
        onChangePrefs={onChangePrefs}
        variant="fullscreen"
        fitActive={false}
        fitLayout={{ columns: 3, fontSizePx: 14, fitsOnScreen: true }}
        onToggleFit={onToggleFit}
      />
    )

    expect(screen.getByRole('button', { name: '3' }).getAttribute('aria-pressed')).toBe('true')
    const fitButton = screen.getByRole('button', { name: 'Fit' })
    expect(fitButton.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(fitButton)
    expect(onToggleFit).toHaveBeenCalledTimes(1)
  })

  it('turns Fit off when a manual column is selected and shows the auto caption', () => {
    const onChangePrefs = vi.fn()
    render(
      <DisplayControls
        prefs={defaultPrefs}
        onChangePrefs={onChangePrefs}
        variant="fullscreen"
        fitActive={true}
        fitLayout={{ columns: 4, fontSizePx: 12, fitsOnScreen: true }}
        onToggleFit={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Fit' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Auto layout · 4 columns · 12px')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '2' }))
    expect(onChangePrefs).toHaveBeenCalledWith(
      expect.objectContaining({ columns: 2, fitToScreen: false })
    )
  })

  it('uses the fitted font size for manual size changes and turns Fit off', () => {
    const onChangePrefs = vi.fn()
    render(
      <DisplayControls
        prefs={{ ...defaultPrefs, fontSizePx: 16 }}
        onChangePrefs={onChangePrefs}
        variant="fullscreen"
        fitActive={true}
        fitLayout={{ columns: 3, fontSizePx: 12, fitsOnScreen: true }}
        onToggleFit={vi.fn()}
      />
    )

    expect(screen.getByText('12')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Increase song font size' }))
    expect(onChangePrefs).toHaveBeenCalledWith(
      expect.objectContaining({ fontSizePx: 13, fitToScreen: false })
    )
  })

  it('hides normal-mode editing controls in full screen', () => {
    render(
      <DisplayControls
        prefs={defaultPrefs}
        onChangePrefs={vi.fn()}
        variant="fullscreen"
        canSimplify={true}
        onToggleEditChords={vi.fn()}
        onRestoreOriginal={vi.fn()}
        fitActive={true}
        fitLayout={{ columns: 2, fontSizePx: 14, fitsOnScreen: true }}
        onToggleFit={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Simplify' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit chords' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
  })
})
