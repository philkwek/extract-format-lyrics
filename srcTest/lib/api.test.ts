import { afterEach, describe, expect, it, vi } from 'vitest'
import { resumeLiveSetApi, searchApiStream } from '../../src/lib/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchApiStream', () => {
  it('asks each source separately and reports each one as it answers', async () => {
    const candidate = (site: string, n: number) => ({
      site,
      title: `Good Grace ${n}`,
      artist: 'Demo Artist',
      url: `https://${site}.example/good-grace-${n}`,
    })
    const pending = new Map<string, (res: Response) => void>()
    const fetchMock = vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          pending.set(new URL(url, 'https://app.example').searchParams.get('site')!, resolve)
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const answer = (site: string, count: number) => {
      const results = Array.from({ length: count }, (_, n) => candidate(site, n))
      pending.get(site)!(
        Response.json({
          query: 'good grace',
          results,
          sources: [{ site, status: count ? 'ok' : 'empty', count, durationMs: 5 }],
          partial: false,
        })
      )
    }
    const onSource = vi.fn()

    const running = searchApiStream('good grace', { onSource })
    expect([...pending.keys()]).toEqual([
      'ultimate-guitar',
      'pnwchords',
      'worshiptogether',
      'worshipchords-net',
      'worshipchords',
    ])

    // The slowest source is still pending when the first one is reported.
    answer('pnwchords', 6)
    await vi.waitFor(() => expect(onSource).toHaveBeenCalledTimes(1))
    expect(onSource.mock.calls[0][0]).toMatchObject({ site: 'pnwchords', status: 'ok', count: 6 })
    expect(onSource.mock.calls[0][0].candidates).toHaveLength(2)

    answer('ultimate-guitar', 3)
    answer('worshipchords-net', 0)
    answer('worshipchords', 0)
    pending.get('worshiptogether')!(
      Response.json({ error: { message: 'Source failed' } }, { status: 500 })
    )

    const response = await running
    expect(response.partial).toBe(true)
    expect(response.sources?.map((source) => source.status)).toEqual([
      'ok',
      'ok',
      'failed',
      'empty',
      'empty',
    ])
    // Ultimate Guitar's three first, then the rest of the eight from PNW Chords.
    expect(response.results.map((result) => result.site)).toEqual([
      ...Array(3).fill('ultimate-guitar'),
      ...Array(5).fill('pnwchords'),
    ])
  })

  it('reports the server error when no source could be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: { message: 'Rate limit exceeded. Try again in 30s' } }, { status: 429 })
      )
    )

    await expect(searchApiStream('song')).rejects.toThrow(/Rate limit exceeded/)
  })
})

describe('resumeLiveSetApi', () => {
  it('posts to the resume endpoint with the bearer secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await resumeLiveSetApi('abc', 'secret')

    expect(fetchMock).toHaveBeenCalledWith('/api/live-set/abc/resume', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
    })
  })

  it('throws the server error when the resume is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not yours' } }), {
          status: 403,
        }),
      )
    )

    await expect(resumeLiveSetApi('abc', 'secret')).rejects.toThrow('Not yours')
  })
})
