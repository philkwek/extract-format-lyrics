import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'
import type { SearchAdapter } from '../src/search/types.js'

const searchSites = vi.hoisted(() => vi.fn())

vi.mock('../src/search/searchSites.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/search/searchSites.js')>()
  return { ...actual, searchSites }
})
vi.mock('../src/search/searchCache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/search/searchCache.js')>()
  const store = { get: async () => null, set: async () => {} }
  return { ...actual, searchCache: new actual.SearchCache({ store }) }
})

import { api } from '../src/index.js'
import { SEARCH_SITES } from '../src/search/types.js'

function search(query: Record<string, string>) {
  const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() }
  const req = { method: 'GET', path: '/api/search', headers: {}, query }
  const done = api(req as unknown as Request, res as unknown as Response)
  return { res, done }
}

const found = (site: string) =>
  Array.from({ length: 10 }, (_, index) => ({
    site,
    title: `Song ${index}`,
    artist: 'Artist',
    url: `https://${site}.example/${index}`,
  }))

beforeEach(() => {
  searchSites.mockReset()
  searchSites.mockImplementation(async (adapters: SearchAdapter[]) => ({
    candidates: adapters.flatMap((adapter) => found(adapter.site)),
    outcomes: adapters.map((adapter) => ({
      site: adapter.site,
      status: 'ok',
      candidates: found(adapter.site),
      durationMs: 1,
    })),
  }))
})

describe('GET /api/search', () => {
  it('searches only the requested source and returns everything it found', async () => {
    const { res, done } = search({ q: 'one source', site: 'pnwchords' })
    await done

    expect(searchSites.mock.calls[0][0].map((adapter: SearchAdapter) => adapter.site)).toEqual([
      'pnwchords',
    ])
    expect(res.status).toHaveBeenCalledWith(200)
    const body = res.json.mock.calls[0][0]
    expect(body.results).toHaveLength(10)
    expect(body.sources).toEqual([{ site: 'pnwchords', status: 'ok', count: 10, durationMs: 1 }])
  })

  it('accepts every source the browser asks for and rejects an unknown one', async () => {
    for (const site of SEARCH_SITES) {
      const { res, done } = search({ q: 'each source', site })
      await done
      expect(res.status).toHaveBeenCalledWith(200)
    }

    const { res, done } = search({ q: 'each source', site: 'nope' })
    await done
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('still answers the combined search without a site', async () => {
    const { res, done } = search({ q: 'all sources' })
    await done

    expect(searchSites.mock.calls[0][0]).toHaveLength(SEARCH_SITES.length)
    expect(res.json.mock.calls[0][0].results).toHaveLength(8)
  })
})
