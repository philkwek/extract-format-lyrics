// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import DisplayControls from './DisplayControls'
import type { SongDisplayPrefs } from '../lib/songPrefs'

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
    const matchTab = screen.getByRole('tab', { name: 'Match Song Key' })
    const customTab = screen.getByRole('tab', { name: 'Custom Key' })
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

    const customTab = screen.getByRole('tab', { name: 'Custom Key' })
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
})
