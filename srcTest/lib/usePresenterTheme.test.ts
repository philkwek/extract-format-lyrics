// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { usePresenterTheme } from '../../src/lib/usePresenterTheme'

const isDark = () => document.documentElement.classList.contains('dark')

describe('usePresenterTheme', () => {
  afterEach(() => {
    cleanup()
    document.documentElement.classList.remove('dark')
  })

  it('applies the theme and restores the page theme on unmount', () => {
    const view = renderHook(({ theme }) => usePresenterTheme(theme), {
      initialProps: { theme: 'dark' as 'dark' | 'light' | undefined },
    })
    expect(isDark()).toBe(true)

    view.rerender({ theme: 'light' })
    expect(isDark()).toBe(false)

    view.unmount()
    expect(isDark()).toBe(false)
  })

  it('leaves the page alone without a theme', () => {
    document.documentElement.classList.add('dark')
    renderHook(() => usePresenterTheme(undefined))
    expect(isDark()).toBe(true)
  })
})
