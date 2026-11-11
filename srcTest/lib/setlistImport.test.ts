import { describe, expect, it, vi } from 'vitest'
import {
  importSources,
  loadSources,
  parsePastedSources,
  sourceFromCandidate,
  type ImportProgress,
  type ImportSourceDeps,
} from '../../src/lib/setlistImport'
import type { ApiScrapeResponse } from '../../src/lib/api'
import type { ImportFailure, Session, SessionSongItem } from '../../src/lib/sessionStore'
import type { Song } from '../../src/types/song'

function makeSong(sourceUrl: string, title = 'Song'): Song {
  return {
    id: sourceUrl,
    title,
    artist: 'Artist',
    sourceUrl,
    sourceSite: 'pnwchords',
    originalKey: null,
    sections: [],
  }
}

function makeSession(songs: SessionSongItem[] = []): Session {
  return { id: 'session-1', createdAt: 0, name: 'Session 1', songs }
}

function makeDeps() {
  const cache = {
    getSong: vi.fn<(url: string) => Promise<Song | null>>(async () => null),
    saveSong: vi.fn<(song: Song, requestedUrl?: string) => Promise<void>>(async () => {}),
    recordFailed: vi.fn<(url: string, reason: string) => Promise<void>>(async () => {}),
    getFailed: vi.fn<(url: string) => Promise<string | null>>(async () => null),
  }
  const sessions = {
    createSession: vi.fn(
      async (
        songs: SessionSongItem[],
        _name?: string,
        options?: { importFailures?: ImportFailure[] }
      ) => ({
        ...makeSession(songs),
        ...(options?.importFailures?.length ? { importFailures: options.importFailures } : {}),
      })
    ),
    addSongsToSession: vi.fn(async (_id: string, songs: SessionSongItem[]) => ({
      session: makeSession([...songs]),
      firstNewIndex: 0,
    })),
  }
  const scrape = vi.fn<(urls: string[]) => Promise<ApiScrapeResponse>>(async () => ({
    results: [],
    invalid: [],
  }))
  return { cache, sessions, scrape }
}

function asDeps(deps: ReturnType<typeof makeDeps>): ImportSourceDeps {
  return deps as unknown as ImportSourceDeps
}

describe('parsePastedSources', () => {
  it('splits, validates, de-duplicates, and counts raw tokens', () => {
    const parsed = parsePastedSources(
      'https://pnwchords.com/song https://example.com/nope https://pnwchords.com/song'
    )

    expect(parsed.sources).toEqual([{ url: 'https://pnwchords.com/song' }])
    expect(parsed.invalid).toEqual([
      { input: 'https://example.com/nope', reason: 'This website is not supported' },
    ])
    expect(parsed.tokenCount).toBe(3)
  })
})

describe('sourceFromCandidate', () => {
  it('keeps candidate metadata for the import pipeline', () => {
    expect(
      sourceFromCandidate({
        url: 'https://pnwchords.com/song',
        title: 'Song',
        artist: 'Artist',
        site: 'pnwchords',
      })
    ).toEqual({
      url: 'https://pnwchords.com/song',
      title: 'Song',
      artist: 'Artist',
      site: 'pnwchords',
    })
  })
})

describe('loadSources', () => {
  it('keeps outcomes aligned with source order when an earlier source fails', async () => {
    const deps = makeDeps()
    const song = makeSong('https://pnwchords.com/b/')
    deps.scrape.mockResolvedValue({
      results: [{ url: 'https://pnwchords.com/b', status: 'ok', song }],
      invalid: [],
    })

    const result = await loadSources(
      [{ url: 'https://pnwchords.com/a' }, { url: 'https://pnwchords.com/b' }],
      { deps: asDeps(deps) }
    )

    expect(result.outcomes).toHaveLength(2)
    expect(result.outcomes[0]).toMatchObject({
      url: 'https://pnwchords.com/a',
      reason: 'Scrape failed',
    })
    expect(result.outcomes[0].item).toBeUndefined()
    expect(result.outcomes[1].item).toMatchObject({
      url: song.sourceUrl,
    })
    expect(result.items).toEqual([
      { url: song.sourceUrl, title: 'Song', artist: 'Artist' },
    ])
    expect(result.imported).toBe(1)
    expect(result.attempted).toBe(2)
    expect(deps.sessions.createSession).not.toHaveBeenCalled()
    expect(deps.sessions.addSongsToSession).not.toHaveBeenCalled()
  })

  it('reports invalid paste input as a failure, never as an item', async () => {
    const deps = makeDeps()
    const song = makeSong('https://pnwchords.com/song/')
    deps.cache.getSong.mockResolvedValue(song)

    const result = await loadSources([{ url: 'https://pnwchords.com/song' }], {
      deps: asDeps(deps),
      invalidInputs: [{ input: 'not-a-url', reason: 'Not a valid URL' }],
    })

    expect(result.items).toEqual([
      { url: song.sourceUrl, title: 'Song', artist: 'Artist' },
    ])
    expect(result.failures).toEqual([{ url: 'not-a-url', reason: 'Not a valid URL' }])
    expect(result.imported).toBe(1)
    expect(result.attempted).toBe(2)
    expect(deps.sessions.createSession).not.toHaveBeenCalled()
  })

  it('skips a recently failed source but allows an explicit retry', async () => {
    const deps = makeDeps()
    deps.cache.getFailed.mockResolvedValue('HTTP error 503')
    const song = makeSong('https://pnwchords.com/song/')

    const skipped = await loadSources([{ url: 'https://pnwchords.com/song' }], {
      deps: asDeps(deps),
    })
    expect(deps.scrape).not.toHaveBeenCalled()
    expect(skipped.imported).toBe(0)
    expect(skipped.items).toEqual([])
    expect(skipped.failures[0].reason).toMatch(/Recent attempt failed/)

    deps.scrape.mockResolvedValue({
      results: [{ url: 'https://pnwchords.com/song', status: 'ok', song }],
      invalid: [],
    })
    const retried = await loadSources([{ url: 'https://pnwchords.com/song' }], {
      deps: asDeps(deps),
      ignoreFailureCache: true,
    })
    expect(retried.imported).toBe(1)
    expect(deps.scrape).toHaveBeenCalledTimes(1)
    expect(deps.cache.saveSong).toHaveBeenCalledWith(song, 'https://pnwchords.com/song')
  })
})

describe('importSources', () => {
  it('loads cached and scraped sources in input order using canonical URLs', async () => {
    const deps = makeDeps()
    const cachedSong = makeSong('https://pnwchords.com/cached/', 'Cached')
    const scrapedSong = makeSong('https://pnwchords.com/scraped/', 'Scraped')
    deps.cache.getSong.mockImplementation(async (url: string) =>
      url === 'https://pnwchords.com/cached' ? cachedSong : null
    )
    deps.scrape.mockResolvedValue({
      results: [
        {
          url: 'https://pnwchords.com/scraped',
          status: 'ok',
          song: scrapedSong,
        },
      ],
      invalid: [],
    })
    const progress: ImportProgress[][] = []

    const result = await importSources(
      [
        { url: 'https://pnwchords.com/scraped' },
        { url: 'https://pnwchords.com/cached' },
      ],
      { deps: asDeps(deps), onProgress: (statuses) => progress.push(statuses) }
    )

    expect(result.items.map((item) => item.url)).toEqual([
      'https://pnwchords.com/scraped/',
      'https://pnwchords.com/cached/',
    ])
    expect(result.imported).toBe(2)
    expect(result.attempted).toBe(2)
    expect(deps.scrape).toHaveBeenCalledWith(['https://pnwchords.com/scraped'])
    expect(progress.at(-1)?.map((status) => status.status)).toEqual(['done', 'cached'])
  })

  it('saves only the songs that loaded and keeps failures off the set', async () => {
    const deps = makeDeps()
    const song = makeSong('https://pnwchords.com/ok/')
    deps.scrape.mockResolvedValue({
      results: [
        { url: 'https://pnwchords.com/ok', status: 'ok', song },
        {
          url: 'https://pnwchords.com/bad',
          status: 'error',
          code: 'SCRAPE_FAILED',
          message: 'No chords here',
        },
      ],
      invalid: [],
    })

    const result = await importSources(
      [{ url: 'https://pnwchords.com/ok' }, { url: 'https://pnwchords.com/bad' }],
      { deps: asDeps(deps) }
    )

    expect(result.items).toEqual([
      { url: song.sourceUrl, title: 'Song', artist: 'Artist' },
    ])
    expect(result.failures).toEqual([
      { url: 'https://pnwchords.com/bad', reason: 'No chords here' },
    ])
    expect(result.imported).toBe(1)
    expect(result.attempted).toBe(2)
    expect(result.session?.songs).toHaveLength(1)
    expect(result.session?.songs.map((item) => item.url)).toEqual([song.sourceUrl])
    expect(result.session?.importFailures).toEqual([
      { url: 'https://pnwchords.com/bad', reason: 'No chords here' },
    ])
    expect(deps.sessions.createSession).toHaveBeenCalledWith(result.items, undefined, {
      importFailures: result.failures,
    })
  })

  it('isolates cache write failures instead of duplicating chunk entries', async () => {
    const deps = makeDeps()
    const songA = makeSong('https://pnwchords.com/a/', 'A')
    const songB = makeSong('https://pnwchords.com/b/', 'B')
    deps.scrape.mockResolvedValue({
      results: [
        { url: 'https://pnwchords.com/a', status: 'ok', song: songA },
        { url: 'https://pnwchords.com/b', status: 'ok', song: songB },
      ],
      invalid: [],
    })
    deps.cache.saveSong.mockImplementation(async (song: Song) => {
      if (song.title === 'A') throw new Error('quota exceeded')
    })

    const result = await importSources(
      [{ url: 'https://pnwchords.com/a' }, { url: 'https://pnwchords.com/b' }],
      { deps: asDeps(deps) }
    )

    expect(result.items).toEqual([
      { url: songB.sourceUrl, title: 'B', artist: 'Artist' },
    ])
    expect(result.failures).toEqual([{ url: 'https://pnwchords.com/a', reason: 'quota exceeded' }])
    expect(result.imported).toBe(1)
  })

  it('reports a whole failed chunk once per source and creates no empty set', async () => {
    const deps = makeDeps()
    deps.scrape.mockRejectedValue(new Error('network down'))

    const result = await importSources(
      [{ url: 'https://pnwchords.com/a' }, { url: 'https://pnwchords.com/b' }],
      { deps: asDeps(deps) }
    )

    expect(result.items).toEqual([])
    expect(result.failures).toEqual([
      { url: 'https://pnwchords.com/a', reason: 'network down' },
      { url: 'https://pnwchords.com/b', reason: 'network down' },
    ])
    expect(result.session).toBeNull()
    expect(result.firstNewIndex).toBe(0)
    expect(deps.sessions.createSession).not.toHaveBeenCalled()
  })

  it('includes invalid paste input in failures, not in the set', async () => {
    const deps = makeDeps()
    const song = makeSong('https://pnwchords.com/song/')
    deps.cache.getSong.mockResolvedValue(song)

    const result = await importSources([{ url: 'https://pnwchords.com/song' }], {
      deps: asDeps(deps),
      invalidInputs: [{ input: 'not-a-url', reason: 'Not a valid URL' }],
    })

    expect(result.items).toEqual([
      { url: song.sourceUrl, title: 'Song', artist: 'Artist' },
    ])
    expect(result.items.some((item) => item.url === 'not-a-url')).toBe(false)
    expect(result.failures).toEqual([{ url: 'not-a-url', reason: 'Not a valid URL' }])
    expect(result.imported).toBe(1)
    expect(result.attempted).toBe(2)
    expect(result.session?.importFailures).toEqual(result.failures)
  })

  it('throws before persistence when requireAll is set and a source fails', async () => {
    const deps = makeDeps()
    deps.scrape.mockResolvedValue({
      results: [
        {
          url: 'https://pnwchords.com/song',
          status: 'error',
          code: 'SCRAPE_FAILED',
          message: 'Could not extract chords',
        },
      ],
      invalid: [],
    })

    await expect(
      importSources([{ url: 'https://pnwchords.com/song' }], {
        deps: asDeps(deps),
        requireAll: true,
      })
    ).rejects.toThrow('Could not extract chords')
    expect(deps.sessions.createSession).not.toHaveBeenCalled()
    expect(deps.sessions.addSongsToSession).not.toHaveBeenCalled()
  })

  it('throws for invalid paste input when requireAll is set', async () => {
    const deps = makeDeps()
    deps.cache.getSong.mockResolvedValue(makeSong('https://pnwchords.com/song/'))

    await expect(
      importSources([{ url: 'https://pnwchords.com/song' }], {
        deps: asDeps(deps),
        invalidInputs: [{ input: 'not-a-url', reason: 'Not a valid URL' }],
        requireAll: true,
      })
    ).rejects.toThrow('Not a valid URL')
    expect(deps.sessions.createSession).not.toHaveBeenCalled()
  })

  it('appends to an existing session and reports the first new index', async () => {
    const deps = makeDeps()
    const song = makeSong('https://pnwchords.com/song/')
    deps.cache.getSong.mockResolvedValue(song)
    deps.sessions.addSongsToSession.mockResolvedValue({
      session: makeSession([{ url: song.sourceUrl }]),
      firstNewIndex: 4,
    })

    const result = await importSources([{ url: 'https://pnwchords.com/song' }], {
      deps: asDeps(deps),
      targetSessionId: 'session-1',
    })

    expect(result.firstNewIndex).toBe(4)
    expect(deps.sessions.createSession).not.toHaveBeenCalled()
    expect(deps.sessions.addSongsToSession).toHaveBeenCalledWith(
      'session-1',
      [expect.objectContaining({ url: song.sourceUrl })],
      []
    )
  })

  it('does no session write when every source fails adding to an existing set', async () => {
    const deps = makeDeps()
    const existing = makeSession([{ url: 'https://pnwchords.com/old/' }])
    deps.scrape.mockRejectedValue(new Error('network down'))
    deps.sessions.addSongsToSession.mockResolvedValue({ session: existing, firstNewIndex: 1 })

    const result = await importSources(
      [{ url: 'https://pnwchords.com/a' }, { url: 'https://pnwchords.com/b' }],
      { deps: asDeps(deps), targetSessionId: 'session-1' }
    )

    const failures = [
      { url: 'https://pnwchords.com/a', reason: 'network down' },
      { url: 'https://pnwchords.com/b', reason: 'network down' },
    ]
    expect(result.items).toEqual([])
    expect(result.failures).toEqual(failures)
    expect(result.session).toBe(existing)
    expect(result.firstNewIndex).toBe(1)
    expect(deps.sessions.createSession).not.toHaveBeenCalled()
    expect(deps.sessions.addSongsToSession).toHaveBeenCalledWith('session-1', [], failures)
  })
})
