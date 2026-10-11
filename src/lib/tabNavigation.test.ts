import { describe, expect, it } from 'vitest'
import { getNextTabIndex } from './tabNavigation'

describe('getNextTabIndex', () => {
  it('moves in either direction and wraps at the ends', () => {
    expect(getNextTabIndex('ArrowRight', 2, 3)).toBe(0)
    expect(getNextTabIndex('ArrowLeft', 0, 3)).toBe(2)
  })

  it('supports Home and End without changing unrelated keys', () => {
    expect(getNextTabIndex('Home', 2, 4)).toBe(0)
    expect(getNextTabIndex('End', 0, 4)).toBe(3)
    expect(getNextTabIndex('Enter', 1, 4)).toBeNull()
  })

  it('does not select a tab when none exist', () => {
    expect(getNextTabIndex('ArrowRight', 0, 0)).toBeNull()
  })
})
