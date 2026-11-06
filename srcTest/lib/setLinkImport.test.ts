import { describe, expect, it, vi } from 'vitest'
import { importFromSetLink, refreshFromSetLink } from '../../src/lib/setLinkImport'
import { ShareApiError } from '../../src/lib/api'
import type { Session } from '../../src/lib/sessionStore'
import type { SetLinkPayload } from '../../src/types/song'

const payload: SetLinkPayload = {
  v: 1,
  name: 'Sunday',
  songs: [
    { entryId: 'e1', url: 'https://a.test/1', title: 'One', targetKey: 'A', simplified: true, padKeyMode: 'custom', customPadKey: 'C' },
    { entryId: 'e2', url: 'https://a.test/2', title: 'Two' },
  ],
}
const LINK = 'L'.repeat(22)

function setup(opts: { existing?: Session | null; fail?: string[]; fetchError?: unknown } = {}) {
  const fetchLink = vi.fn(async () => {
    if (opts.fetchError) throw opts.fetchError
    return { payload }
  })
  const created: Array<{ items: unknown[]; name?: string; options?: unknown }> = []
  const sessions = {
    findByImportedLinkId: vi.fn(async () => opts.existing ?? null),
    createSession: vi.fn(async (items: unknown[], name?: string, options?: unknown) => {
      created.push({ items, name, options })
      return { id: 's', publicId: 'p', createdAt: 0, name: name ?? '', songs: items } as Session
    }),
  }
  const runImport = vi.fn(async (sources: Array<{ url: string; title?: string }>, o: { deps?: { sessions?: { createSession: (i: unknown[]) => Promise<unknown> } } }) => {
    const items = sources.map((s) =>
      opts.fail?.includes(s.url)
        ? { url: s.url, title: s.title, status: 'error' as const, errorMessage: 'nope' }
        : { url: s.url, title: s.title, status: 'ok' as const },
    )
    await o.deps?.sessions?.createSession(items)
    return {} as never
  })
  return { fetchLink, sessions, runImport, created, deps: { fetchLink, sessions, importSources: runImport as never } }
}

describe('importFromSetLink', () => {
  it('reuses an existing copy without any network', async () => {
    const existing = { id: 'x', createdAt: 0, name: 'Mine', songs: [] } as Session
    const t = setup({ existing })
    const r = await importFromSetLink(LINK, { deps: t.deps })
    expect(r).toEqual({ kind: 'reused', session: existing })
    expect(t.fetchLink).not.toHaveBeenCalled()
    expect(t.runImport).not.toHaveBeenCalled()
  })

  it('creates exactly one session with per-song settings', async () => {
    const t = setup()
    const r = await importFromSetLink(LINK, { deps: t.deps })
    expect(r.kind).toBe('imported')
    expect(t.sessions.createSession).toHaveBeenCalledTimes(1)
    expect(t.created[0].name).toBe('Sunday')
    expect(t.created[0].options).toEqual({ importedFromLinkId: LINK })
    expect(t.created[0].items[0]).toMatchObject({ entryId: 'e1', targetKey: 'A', simplified: true, padKeyMode: 'custom', customPadKey: 'C', status: 'ok' })
    expect(t.created[0].items[1]).toMatchObject({ entryId: 'e2', status: 'ok' })
  })

  it('counts failed songs and keeps them as error items', async () => {
    const t = setup({ fail: ['https://a.test/2'] })
    const r = await importFromSetLink(LINK, { deps: t.deps })
    expect(r).toMatchObject({ kind: 'imported', failed: 1 })
    expect(t.created[0].items[1]).toMatchObject({ status: 'error', errorMessage: 'nope', entryId: 'e2' })
  })

  it('maps expired and missing links', async () => {
    const expired = setup({ fetchError: new ShareApiError('gone', 'EXPIRED', 410) })
    expect(await importFromSetLink(LINK, { deps: expired.deps })).toEqual({ kind: 'expired' })
    const missing = setup({ fetchError: new ShareApiError('no', 'NOT_FOUND', 404) })
    expect(await importFromSetLink(LINK, { deps: missing.deps })).toEqual({ kind: 'missing' })
    expect(missing.sessions.createSession).not.toHaveBeenCalled()
  })

  it('rethrows other errors', async () => {
    const t = setup({ fetchError: new Error('boom') })
    await expect(importFromSetLink(LINK, { deps: t.deps })).rejects.toThrow('boom')
  })

  it('refresh creates a new copy even when one exists', async () => {
    const existing = { id: 'x', createdAt: 0, name: 'Mine', songs: [] } as Session
    const t = setup({ existing })
    const r = await refreshFromSetLink(LINK, { deps: t.deps })
    expect(r.kind).toBe('imported')
    expect(t.sessions.createSession).toHaveBeenCalledTimes(1)
  })
})
