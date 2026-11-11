import { describe, expect, it, vi } from 'vitest'
import {
  diffLinkSnapshot,
  findSavedCopy,
  loadSetLinkPreview,
  savePreviewAsNew,
  updateCopyFromPreview,
  type SetLinkPreview,
} from '../../src/lib/setLinkImport'
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

function previewDeps(t: ReturnType<typeof setup>) {
  return { fetchLink: t.fetchLink, loadSources: t.loadSources as never }
}

describe('loadSetLinkPreview', () => {
  it('returns a preview without creating a session', async () => {
    const t = setup()

    const r = await loadSetLinkPreview(LINK, { deps: previewDeps(t) })

    expect(r).toEqual({
      kind: 'preview',
      preview: {
        linkId: LINK,
        name: 'Sunday',
        items: [
          {
            url: 'https://a.test/1',
            title: 'One',
            entryId: 'e1',
            targetKey: 'A',
            simplified: true,
            padKeyMode: 'custom',
            customPadKey: 'C',
          },
          { url: 'https://a.test/2', title: 'Two', entryId: 'e2' },
        ],
        failures: [],
        snapshot: [
          { entryId: 'e1', url: 'https://a.test/1', targetKey: 'A' },
          { entryId: 'e2', url: 'https://a.test/2' },
        ],
      },
    })
    expect(t.sessions.createSession).not.toHaveBeenCalled()
  })

  it('keeps settings with their songs when the first song fails', async () => {
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

    const r = await loadSetLinkPreview(LINK, { deps: previewDeps(t) })

    expect(r.kind).toBe('preview')
    if (r.kind !== 'preview') return
    expect(r.preview.items.map((item) => item.entryId)).toEqual(['e2', 'e3'])
    expect(r.preview.items[0]).toMatchObject({
      targetKey: 'G',
      simplified: false,
      padKeyMode: 'match',
    })
    expect(r.preview.items[1]).toMatchObject({
      targetKey: 'D',
      simplified: true,
      padKeyMode: 'custom',
      customPadKey: 'E',
    })
    expect(r.preview.failures).toEqual([{ url: 'https://a.test/1', reason: 'nope' }])
    expect(r.preview.snapshot.map((entry) => entry.entryId)).toEqual(['e1', 'e2', 'e3'])
  })

  it('returns empty when no song loads', async () => {
    const t = setup({ fail: ['https://a.test/1', 'https://a.test/2'] })

    expect(await loadSetLinkPreview(LINK, { deps: previewDeps(t) })).toEqual({ kind: 'empty' })
  })

  it('maps expired and missing links', async () => {
    const expired = setup({ fetchError: new ShareApiError('gone', 'EXPIRED', 410) })
    expect(await loadSetLinkPreview(LINK, { deps: previewDeps(expired) })).toEqual({
      kind: 'expired',
    })
    const missing = setup({ fetchError: new ShareApiError('no', 'NOT_FOUND', 404) })
    expect(await loadSetLinkPreview(LINK, { deps: previewDeps(missing) })).toEqual({
      kind: 'missing',
    })
  })

  it('rethrows other errors', async () => {
    const t = setup({ fetchError: new Error('boom') })
    await expect(loadSetLinkPreview(LINK, { deps: previewDeps(t) })).rejects.toThrow('boom')
  })
})

const preview: SetLinkPreview = {
  linkId: LINK,
  name: 'Sunday',
  items: [{ entryId: 'e1', url: 'https://a.test/1', title: 'One', targetKey: 'A' }],
  failures: [{ url: 'https://a.test/2', reason: 'nope' }],
  snapshot: [
    { entryId: 'e1', url: 'https://a.test/1', targetKey: 'A' },
    { entryId: 'e2', url: 'https://a.test/2' },
  ],
}

describe('savePreviewAsNew', () => {
  it('saves under a unique name with the link fields', async () => {
    const sessions = [
      { id: 'a', createdAt: 0, name: 'Sunday', songs: [] },
      { id: 'b', createdAt: 0, name: 'Sunday - Copy #1', songs: [] },
    ] as Session[]
    const getAllSessions = vi.fn(async () => sessions)
    const createSession = vi.fn(
      async (items: SessionSongItem[], name?: string) =>
        ({ id: 'new', createdAt: 0, name: name ?? '', songs: items }) as Session,
    )

    const session = await savePreviewAsNew(preview, {
      sessions: { getAllSessions, createSession },
    })

    expect(createSession).toHaveBeenCalledWith(preview.items, 'Sunday - Copy #2', {
      importedFromLinkId: LINK,
      linkSnapshot: preview.snapshot,
      importFailures: preview.failures,
    })
    expect(session.id).toBe('new')
  })
})

describe('updateCopyFromPreview', () => {
  it('replaces the copy from the preview', async () => {
    const session = { id: 's', createdAt: 0, name: 'Sunday', songs: [] } as Session
    const replaceSongsFromLink = vi.fn(async () => session)

    const result = await updateCopyFromPreview('s', preview, {
      sessions: { replaceSongsFromLink },
    })

    expect(result).toBe(session)
    expect(replaceSongsFromLink).toHaveBeenCalledWith(
      's',
      preview.items,
      preview.snapshot,
      preview.failures,
    )
  })
})

describe('diffLinkSnapshot', () => {
  it('counts added, removed and key changes by entryId', () => {
    const saved = [
      { entryId: 'a', url: 'https://a.test/1', targetKey: 'G' },
      { entryId: 'b', url: 'https://a.test/2' },
      { entryId: 'c', url: 'https://a.test/3' },
    ]
    const latest = [
      { entryId: 'a', url: 'https://a.test/1', targetKey: 'A' },
      { entryId: 'b', url: 'https://a.test/2', targetKey: 'C' },
      { entryId: 'd', url: 'https://a.test/4' },
    ]

    expect(diffLinkSnapshot(saved, latest)).toEqual({ added: 1, removed: 1, keyChanged: 2 })
  })

  it('returns zeros for a copy saved before snapshots existed', () => {
    expect(diffLinkSnapshot(undefined, [{ entryId: 'a', url: 'https://a.test/1' }])).toEqual({
      added: 0,
      removed: 0,
      keyChanged: 0,
    })
  })
})

describe('findSavedCopy', () => {
  it('asks the store for the copy saved from the link', async () => {
    const session = { id: 's', createdAt: 0, name: 'Sunday', songs: [] } as Session
    const findByImportedLinkId = vi.fn(async () => session)

    const result = await findSavedCopy(LINK, { sessions: { findByImportedLinkId } })

    expect(result).toBe(session)
    expect(findByImportedLinkId).toHaveBeenCalledWith(LINK)
  })
})
