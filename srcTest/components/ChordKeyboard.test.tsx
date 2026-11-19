// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChordKeyboard from '../../src/components/ChordKeyboard'

afterEach(() => {
  cleanup()
})

describe('ChordKeyboard', () => {
  it('disables Save and ignores Enter when the chord input is empty', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <ChordKeyboard
        initialChord="G"
        onSave={onSave}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByTitle('Clear chord'))

    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)

    const input = screen.getByPlaceholderText(/Chord \(e\.g\./i)
    await user.type(input, '{Enter}')
    expect(onSave).not.toHaveBeenCalled()
  })
})
