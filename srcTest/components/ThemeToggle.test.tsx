// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThemeToggle from '../../src/components/ThemeToggle'

function installMatchMedia(matches = false) {
  const query = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => query),
  })
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  installMatchMedia()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('ThemeToggle', () => {
  it('cycles device, light, dark, and back to device', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(
      screen.getByRole('button', { name: 'Theme follows device. Switch to light mode' }),
    )
    expect(localStorage.getItem('app_theme')).toBe('light')

    await user.click(screen.getByRole('button', { name: 'Light theme. Switch to dark mode' }))
    expect(localStorage.getItem('app_theme')).toBe('dark')

    await user.click(screen.getByRole('button', { name: 'Dark theme. Switch to device mode' }))
    expect(localStorage.getItem('app_theme')).toBe('system')
    expect(
      screen.getByRole('button', { name: 'Theme follows device. Switch to light mode' }),
    ).toBeTruthy()
  })
})
