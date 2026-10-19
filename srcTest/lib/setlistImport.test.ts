import { describe, expect, it, vi } from 'vitest'
import {
  importSources,
  parsePastedSources,
  sourceFromCandidate,
  type ImportProgress,
  type ImportSourceDeps,
} from '../../src/lib/setlistImport'
import type { ApiScrapeResponse } from '../../src/lib/api'
import type { Session, SessionSongItem } from '../../src/lib/sessionStore'
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
    saveSong: vi.fn<(song: Song) => Promise<void>>(async () => {}),
    recordFailed: vi.fn<(url: string, reason: string) => Promise<void>>(async () => {}),
  }
  const sessions = {
    createSession: vi.fn(async (songs: SessionSongItem[]) => makeSession(songs)),
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

    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      url: 'https://pnwchords.com/a',
      status: 'error',
      errorMessage: 'quota exceeded',
    })
    expect(result.items[1]).toMatchObject({
      url: 'https://pnwchords.com/b/',
      status: 'ok',
    })
    expect(result.imported).toBe(1)
    expect(result.failures).toEqual([
      { url: 'https://pnwchords.com/a', reason: 'quota exceeded' },
    ])
  })

  it('marks an entire chunk as failed only once when the network request fails', async () => {
    const deps = makeDeps()
    deps.scrape.mockRejectedValue(new Error('network down'))

    const result = await importSources(
      [{ url: 'https://pnwchords.com/a' }, { url: 'https://pnwchords.com/b' }],
      { deps: asDeps(deps) }
    )

    expect(result.items).toHaveLength(2)
    expect(result.items.every((item) => item.status === 'error')).toBe(true)
    expect(result.items.every((item) => item.errorMessage === 'network down')).toBe(true)
    expect(result.failures).toHaveLength(2)
  })

  it('includes invalid paste input as error entries', async () => {
    const deps = makeDeps()
    const song = makeSong('https://pnwchords.com/song/')
    deps.cache.getSong.mockResolvedValue(song)

    const result = await importSources([{ url: 'https://pnwchords.com/song' }], {
      deps: asDeps(deps),
      invalidInputs: [{ input: 'not-a-url', reason: 'Not a valid URL' }],
    })

    expect(result.items).toHaveLength(2)
    expect(result.items[1]).toMatchObject({
      url: 'not-a-url',
      status: 'error',
      errorMessage: 'Not a valid URL',
    })
    expect(result.imported).toBe(1)
    expect(result.attempted).toBe(2)
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
      importSources([{ url: 'https://pnwchords.com/song' }], { deps: asDeps(deps), requireAll: true })
    ).rejects.toThrow('Could not extract chords')
    expect(deps.sessions.createSession).not.toHaveBeenCalled()
    expect(deps.sessions.addSongsToSession).not.toHaveBeenCalled()
  })

  it('appends to an existing session and reports the first new index', async () => {
    const deps = makeDeps()
    const song = makeSong('https://pnwchords.com/song/')
    deps.cache.getSong.mockResolvedValue(song)
    deps.sessions.addSongsToSession.mockResolvedValue({
      session: makeSession([{ url: song.sourceUrl, status: 'ok' }]),
      firstNewIndex: 4,
    })

    const result = await importSources([{ url: 'https://pnwchords.com/song' }], {
      deps: asDeps(deps),
      targetSessionId: 'session-1',
    })

    expect(result.firstNewIndex).toBe(4)
    expect(deps.sessions.createSession).not.toHaveBeenCalled()
    expect(deps.sessions.addSongsToSession).toHaveBeenCalledWith('session-1', [
      expect.objectContaining({ url: song.sourceUrl, status: 'ok' }),
    ])
  })
})
