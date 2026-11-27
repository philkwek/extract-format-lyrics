import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountsEnabled } from '../../src/lib/accountFlag'

afterEach(() => vi.unstubAllEnvs())

describe('accountsEnabled', () => {
  it('is off by default', () => {
    expect(accountsEnabled()).toBe(false)
  })

  it('is on only when the build flag is exactly true', () => {
    vi.stubEnv('VITE_ACCOUNTS_ENABLED', 'true')
    expect(accountsEnabled()).toBe(true)

    vi.stubEnv('VITE_ACCOUNTS_ENABLED', 'false')
    expect(accountsEnabled()).toBe(false)

    vi.stubEnv('VITE_ACCOUNTS_ENABLED', '1')
    expect(accountsEnabled()).toBe(false)
  })
})
