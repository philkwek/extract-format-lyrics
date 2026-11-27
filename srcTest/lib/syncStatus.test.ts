import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSyncStatus, setSyncStatus, subscribeSyncStatus } from '../../src/lib/syncStatus'

afterEach(() => setSyncStatus('synced'))

describe('sync status', () => {
  it('starts as synced', () => {
    expect(getSyncStatus()).toBe('synced')
  })

  it('tells subscribers about a new status until they unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSyncStatus(listener)

    setSyncStatus('offline')
    expect(getSyncStatus()).toBe('offline')
    expect(listener).toHaveBeenCalledWith('offline')

    unsubscribe()
    setSyncStatus('synced')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
