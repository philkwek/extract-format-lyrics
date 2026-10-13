// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DisplayControls from './DisplayControls'
import type { SongDisplayPrefs } from '../lib/songPrefs'

afterEach(cleanup)

describe('DisplayControls', () => {
  const defaultPrefs: SongDisplayPrefs = {
    columns: 1,
    fontSizePx: 14,
    darkMode: false,
    simplified: false,
  }

  it('does not render Simplify button when canSimplify is false', () => {
    render(
      <DisplayControls
        prefs={defaultPrefs}
        onChangePrefs={vi.fn()}
        canSimplify={false}
      />
    )
    expect(screen.queryByRole('button', { name: /simplify/i })).toBeNull()
    expect(screen.queryByText('Auto')).toBeNull()
  })

  it('renders Simplify button and toggles it on click', async () => {
    const user = userEvent.setup()
    const onChangePrefs = vi.fn()
    render(
      <DisplayControls
        prefs={defaultPrefs}
        onChangePrefs={onChangePrefs}
        canSimplify={true}
        simplifiedSource="algorithmic"
      />
    )

    const btn = screen.getByRole('button', { name: 'Simplify' })
    expect(btn).toBeDefined()
    // Fallback is not yet active, so Auto badge must not be shown
    expect(screen.queryByText('Auto')).toBeNull()

    await user.click(btn)
    expect(onChangePrefs).toHaveBeenCalledWith({
      ...defaultPrefs,
      simplified: true,
    })
  })

  it('renders Simplified button without Auto badge when source is official', () => {
    render(
      <DisplayControls
        prefs={{ ...defaultPrefs, simplified: true }}
        onChangePrefs={vi.fn()}
        canSimplify={true}
        simplifiedSource="official"
      />
    )

    expect(screen.getByRole('button', { name: 'Simplified' })).toBeDefined()
    expect(screen.queryByText('Auto')).toBeNull()
  })

  it('renders Simplified button with Auto cue badge and tooltip when source is algorithmic', () => {
    render(
      <DisplayControls
        prefs={{ ...defaultPrefs, simplified: true }}
        onChangePrefs={vi.fn()}
        canSimplify={true}
        simplifiedSource="algorithmic"
      />
    )

    // Button label remains strictly "Simplified"
    const btn = screen.getByRole('button', { name: 'Simplified' })
    expect(btn).toBeDefined()

    // "Auto" badge is displayed alongside with expected tooltip/title
    const autoBadge = screen.getByText('Auto')
    expect(autoBadge).toBeDefined()
    expect(autoBadge.getAttribute('title')).toBe(
      'Extra chord notes removed. Some chords may sound different.'
    )
  })
})
