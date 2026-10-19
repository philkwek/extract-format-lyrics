// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SearchForm from './SearchForm'

afterEach(cleanup)

function renderForm(overrides: Partial<Parameters<typeof SearchForm>[0]> = {}) {
  const props = {
    query: '',
    onQueryChange: vi.fn(),
    onSubmit: vi.fn(),
    isSearching: false,
    ...overrides,
  }
  render(<SearchForm {...props} />)
  return props
}

describe('SearchForm', () => {
  it('renders the description, query, placeholder, and search button', () => {
    renderForm({
      query: 'Goodness of God',
      description: 'Search across every supported site.',
      placeholder: 'Song or artist',
    })

    expect(screen.getByText('Search across every supported site.')).toBeTruthy()
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'Goodness of God')
    expect(screen.getByPlaceholderText('Song or artist')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy()
  })

  it('forwards query changes and form submissions', () => {
    const props = renderForm({ query: 'Grace' })

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Grace alone' } })
    fireEvent.submit(screen.getByRole('textbox').closest('form')!)

    expect(props.onQueryChange).toHaveBeenCalledWith('Grace alone')
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('disables search for empty input or while searching', () => {
    renderForm()
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows an error banner', () => {
    renderForm({ error: 'Search failed' })
    expect(screen.getByText('Search failed')).toBeTruthy()
  })
})
