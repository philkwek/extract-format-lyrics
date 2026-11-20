// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { shouldPrefetchPads } from '../../src/lib/prefetchPads'

describe('shouldPrefetchPads', () => {
  const base = { standalone: true, online: true, saveData: false }

  it('downloads only in the installed app, while online', () => {
    expect(shouldPrefetchPads(base)).toBe(true)
    expect(shouldPrefetchPads({ ...base, standalone: false })).toBe(false)
    expect(shouldPrefetchPads({ ...base, online: false })).toBe(false)
  })

  it('respects a metered connection', () => {
    expect(shouldPrefetchPads({ ...base, saveData: true })).toBe(false)
  })
})
