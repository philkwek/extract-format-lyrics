// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useOnlineStatus } from '../../src/lib/useOnlineStatus'

afterEach(() => {
  window.dispatchEvent(new Event('online'))
})

describe('useOnlineStatus', () => {
  it('follows the browser online and offline events', () => {
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    act(() => window.dispatchEvent(new Event('offline')))
    expect(result.current).toBe(false)

    act(() => window.dispatchEvent(new Event('online')))
    expect(result.current).toBe(true)
  })
})
