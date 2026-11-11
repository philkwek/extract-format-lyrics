import { describe, expect, it, vi } from 'vitest'
import { importFromSetLink, refreshFromSetLink } from '../../src/lib/setLinkImport'
import { ShareApiError } from '../../src/lib/api'
import type { Session, SessionSongItem } from '../../src/lib/sessionStore'
import type { SetLinkPayload } from '../../src/types/song'

const payload: SetLinkPayload = {
  v: 1,
  name: 'Sunday',
  songs: [
    {
      entryId: 'e1',
      url: 'https://a.test/1',
      title: 'One',
      targetKey: 'A',
      simplified: true,
      padKeyMode: 'custom',
      customPadKey: 'C',
    },
    { entryId: 'e2', url: 'https://a.test/2', title: 'Two' },
  ],
}
const LINK = 'L'.repeat(22)

interface MockOutcome {
  url: string
  item?: SessionSongItem
  reason?: string
}

function setup(
  opts: {
    existing?: Session | null
    fail?: string[]
    fetchError?: unknown
    payload?: SetLinkPayload
  } = {}
) {
  const linkPayload = opts.payload ?? payload
  const fetchLink = vi.fn(async () => {
    if (opts.fetchError) throw opts.fetchError
    return { payload: linkPayload }
  })
  const created: Array<{ items: SessionSongItem[]; name?: string; options?: unknown }> = []
  const sessions = {
    findByImportedLinkId: vi.fn(async () => opts.existing ?? null),
    createSession: vi.fn(async (items: SessionSongItem[], name?: string, options?: unknown) => {
      created.push({ items, name, options })
      return { id: 's', publicId: 'p', createdAt: 0, name: name ?? '', songs: items } as Session
    }),
  }
  const loadSources = vi.fn(async (sources: Array<{ url: string; title?: string }>) => {
    const outcomes: MockOutcome[] = sources.map((source) =>
      opts.fail?.includes(source.url)
        ? { url: source.url, reason: 'nope' }
        : { url: source.url, item: { url: source.url, title: source.title } }
    )
    const items = outcomes.flatMap((outcome) => (outcome.item ? [outcome.item] : []))
    const failures = outcomes.flatMap((outcome) =>
      outcome.item ? [] : [{ url: outcome.url, reason: outcome.reason ?? 'Import failed' }]
    )
    return { outcomes, items, failures, imported: items.length, attempted: sources.length }
  })
  return {
    fetchLink,
    sessions,
    loadSources,
    created,
    deps: { fetchLink, sessions, loadSources: loadSources as never },
  }
}

describe('importFromSetLink', () => {
  it('reuses an existing copy without any network', async () => {
    const existing = { id: 'x', createdAt: 0, name: 'Mine', songs: [] } as Session
    const t = setup({ existing })
    const r = await importFromSetLink(LINK, { deps: t.deps })
    expect(r).toEqual({ kind: 'reused', session: existing })
    expect(t.fetchLink).not.toHaveBeenCalled()
    expect(t.loadSources).not.toHaveBeenCalled()
  })

  it('creates exactly one session with per-song settings', async () => {
    const t = setup()
    const r = await importFromSetLink(LINK, { deps: t.deps })
    expect(r.kind).toBe('imported')
    expect(t.sessions.createSession).toHaveBeenCalledTimes(1)
    expect(t.created[0].name).toBe('Sunday')
    expect(t.created[0].options).toEqual({ importedFromLinkId: LINK, importFailures: [] })
    expect(t.created[0].items[0]).toMatchObject({
      entryId: 'e1',
      targetKey: 'A',
      simplified: true,
      padKeyMode: 'custom',
      customPadKey: 'C',
    })
    expect(t.created[0].items[1]).toMatchObject({ entryId: 'e2' })
  })

  it('counts failed songs as import failures, not error items', async () => {
    const t = setup({ fail: ['https://a.test/2'] })
    const r = await importFromSetLink(LINK, { deps: t.deps })
    expect(r).toMatchObject({ kind: 'imported' })
    expect(t.created[0].items).toHaveLength(1)
    expect(t.created[0].items[0]).toMatchObject({ entryId: 'e1' })
    expect(t.created[0].options).toEqual({
      importedFromLinkId: LINK,
      importFailures: [{ url: 'https://a.test/2', reason: 'nope' }],
    })
  })

  it('keeps each song with its own settings when the first song fails', async () => {
    const threeSongs: SetLinkPayload = {
      v: 1,
      name: 'Three',
      songs: [
        {
          entryId: 'e1',
          url: 'https://a.test/1',
          title: 'One',
          targetKey: 'A',
          simplified: true,
          padKeyMode: 'custom',
          customPadKey: 'C',
        },
        {
          entryId: 'e2',
          url: 'https://a.test/2',
          title: 'Two',
          targetKey: 'G',
          simplified: false,
          padKeyMode: 'match',
        },
        {
          entryId: 'e3',
          url: 'https://a.test/3',
          title: 'Three',
          targetKey: 'D',
          simplified: true,
          padKeyMode: 'custom',
          customPadKey: 'E',
        },
      ],
    }
    const t = setup({ payload: threeSongs, fail: ['https://a.test/1'] })
    const r = await importFromSetLink(LINK, { deps: t.deps })

    expect(r).toMatchObject({ kind: 'imported' })
    expect(t.sessions.createSession).toHaveBeenCalledTimes(1)
    expect(t.created[0].items).toHaveLength(2)
    expect(t.created[0].items[0]).toMatchObject({
      entryId: 'e2',
      targetKey: 'G',
      simplified: false,
      padKeyMode: 'match',
    })
    expect(t.created[0].items[1]).toMatchObject({
      entryId: 'e3',
      targetKey: 'D',
      simplified: true,
      padKeyMode: 'custom',
      customPadKey: 'E',
    })
    expect(t.created[0].options).toEqual({
      importedFromLinkId: LINK,
      importFailures: [{ url: 'https://a.test/1', reason: 'nope' }],
    })
  })

  it('returns empty and creates nothing when no song loads', async () => {
    const t = setup({ fail: ['https://a.test/1', 'https://a.test/2'] })
    const r = await importFromSetLink(LINK, { deps: t.deps })
    expect(r).toEqual({ kind: 'empty' })
    expect(t.sessions.createSession).not.toHaveBeenCalled()
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
