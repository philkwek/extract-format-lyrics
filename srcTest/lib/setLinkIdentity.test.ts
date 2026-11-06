import { describe, expect, it } from 'vitest'
import {
  deriveSetLinkId,
  generateSetLinkSecret,
  getOrCreateSetLinkIdentity,
  getSetLinkIdentity,
  deleteSetLinkIdentity,
  isSetLinkId,
  type SetLinkIdentityStore,
} from '../../src/lib/setLinkIdentity'

function memoryStore(): SetLinkIdentityStore {
  const m = new Map<string, unknown>()
  return {
    get: async <T>(k: string) => m.get(k) as T | undefined,
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
  }
}

describe('set link identity', () => {
  it('concurrent get-or-create for one session yields a single identity', async () => {
    const store = memoryStore()
    const results = await Promise.all(
      Array.from({ length: 5 }, () => getOrCreateSetLinkIdentity('session_race', store))
    )
    const ids = new Set(results.map((r) => r.publicId))
    expect(ids.size).toBe(1)
    expect((await getSetLinkIdentity('session_race', store))?.publicId).toBe(results[0].publicId)
  })

  it('generates 64 hex char secrets', () => {
    expect(generateSetLinkSecret()).toMatch(/^[0-9a-f]{64}$/)
    expect(generateSetLinkSecret()).not.toBe(generateSetLinkSecret())
  })

  it('derives a deterministic 22 char base64url id', async () => {
    const secret = 'a'.repeat(64)
    const id = await deriveSetLinkId(secret)
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(isSetLinkId(id)).toBe(true)
    expect(await deriveSetLinkId(secret)).toBe(id)
    expect(await deriveSetLinkId('b'.repeat(64))).not.toBe(id)
  })

  it('rejects malformed ids', () => {
    expect(isSetLinkId('short')).toBe(false)
    expect(isSetLinkId('a'.repeat(23))).toBe(false)
    expect(isSetLinkId('a'.repeat(21) + '+')).toBe(false)
  })

  it('creates once, then returns the same identity until deleted', async () => {
    const store = memoryStore()
    const a = await getOrCreateSetLinkIdentity('s1', store)
    const b = await getOrCreateSetLinkIdentity('s1', store)
    expect(b).toEqual(a)
    expect(a.publicId).toBe(await deriveSetLinkId(a.secret))
    await deleteSetLinkIdentity('s1', store)
    expect(await getSetLinkIdentity('s1', store)).toBeNull()
  })
})
