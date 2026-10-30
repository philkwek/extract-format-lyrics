import { describe, expect, it } from 'vitest'
import { BoundedMap } from '../src/boundedMap.js'

describe('BoundedMap', () => {
  it('drops the oldest entry once past the maximum', () => {
    const map = new BoundedMap<number>(2)
    map.set('a', 1)
    map.set('b', 2)
    map.set('c', 3)
    expect(map.get('a')).toBeUndefined()
    expect(map.get('b')).toBe(2)
    expect(map.get('c')).toBe(3)
  })

  it('moves a re-set key to the newest position', () => {
    const map = new BoundedMap<number>(2)
    map.set('a', 1)
    map.set('b', 2)
    map.set('a', 10)
    map.set('c', 3)
    expect(map.get('b')).toBeUndefined()
    expect(map.get('a')).toBe(10)
    expect(map.get('c')).toBe(3)
  })
})
