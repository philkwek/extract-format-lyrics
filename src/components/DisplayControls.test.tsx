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
})
