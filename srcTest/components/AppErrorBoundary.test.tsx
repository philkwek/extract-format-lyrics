// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AppErrorBoundary } from '../../src/components/AppErrorBoundary'

function ThrowingChild(): never {
  throw new Error('render failed')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AppErrorBoundary', () => {
  it('renders a fallback with a home link when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <AppErrorBoundary>
        <ThrowingChild />
      </AppErrorBoundary>
    )

    expect(screen.getByText('This page could not be displayed')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/')
  })
})
