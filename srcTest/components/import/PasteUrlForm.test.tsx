// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import PasteUrlForm from '../../../src/components/import/PasteUrlForm'

afterEach(cleanup)

function renderForm(overrides: Partial<Parameters<typeof PasteUrlForm>[0]> = {}) {
  const props = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    isProcessing: false,
    submitLabel: 'Extract and open',
    linkCount: 0,
    ...overrides,
  }
  render(<PasteUrlForm {...props} />)
  return props
}

describe('PasteUrlForm', () => {
  it('renders the shared description, link count, and submit label', () => {
    renderForm({ value: 'https://pnwchords.com/song', linkCount: 1 })

    expect(screen.getByText(/Paste one or more chord sheet URLs/)).toBeTruthy()
    expect(screen.getByText('1 link(s) entered')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Extract and open' })).toBeTruthy()
  })

  it('forwards textarea changes and submit clicks', () => {
    const props = renderForm({ value: 'https://pnwchords.com/a' })

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://pnwchords.com/b' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Extract and open' }))

    expect(props.onChange).toHaveBeenCalledWith('https://pnwchords.com/b')
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('disables the action for empty input or while processing', () => {
    renderForm()
    expect((screen.getByRole('button', { name: 'Extract and open' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a custom processing label and disables the textarea', () => {
    renderForm({
      value: 'https://pnwchords.com/song',
      isProcessing: true,
      processingLabel: 'Extracting songs',
    })

    expect((screen.getByRole('button', { name: 'Extracting songs' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('shows an error banner', () => {
    renderForm({ error: 'No valid URLs found' })
    expect(screen.getByText('No valid URLs found')).toBeTruthy()
  })
})
