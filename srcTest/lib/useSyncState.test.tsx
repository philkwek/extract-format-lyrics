// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncState } from '../../src/lib/useSyncState'

const store = vi.hoisted(() => {
  let state = {
    pendingRemote: new Set<string>(),
    deletedElsewhere: new Set<string>(),
    conflicts: new Map<string, { clashes: string[] }>(),
  }
  const listeners = new Set<(next: typeof state) => void>()
  return {
    get: () => state,
    subscribe: (listener: (next: typeof state) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (next: typeof state) => {
      state = next
      for (const listener of listeners) listener(next)
    },
    reset: () => {
      state = { pendingRemote: new Set(), deletedElsewhere: new Set(), conflicts: new Map() }
    },
  }
})

vi.mock('../../src/lib/accountSync', () => ({
  getSyncState: store.get,
  subscribeSyncState: store.subscribe,
  setOpenSet: vi.fn(),
  applyPendingRemote: vi.fn(),
  resolveConflict: vi.fn(),
  keepDeletedCopy: vi.fn(),
  dismissDeleted: vi.fn(),
}))

afterEach(() => {
  cleanup()
  store.reset()
})

describe('useSyncState', () => {
  it('returns the current state', () => {
    const { result } = renderHook(() => useSyncState())
    expect(result.current.pendingRemote.size).toBe(0)
    expect(result.current.deletedElsewhere.size).toBe(0)
    expect(result.current.conflicts.size).toBe(0)
  })

  it('re-renders when the sync state changes', () => {
    const { result } = renderHook(() => useSyncState())
    const next = {
      pendingRemote: new Set(['set-1']),
      deletedElsewhere: new Set(['set-2']),
      conflicts: new Map([['set-3', { clashes: ['Song A key changed'] }]]),
    }

    act(() => store.set(next))

    expect(result.current.pendingRemote.has('set-1')).toBe(true)
    expect(result.current.deletedElsewhere.has('set-2')).toBe(true)
    expect(result.current.conflicts.get('set-3')?.clashes).toEqual(['Song A key changed'])
  })
})
