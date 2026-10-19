import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractSongsApi, searchApiStream } from '../../src/lib/api'

const song = {
  id: 'song-1',
  title: 'Test Song',
  sections: [],
  sourceUrl: 'upload://song-1',
  sourceLabel: 'Upload',
  fetchedAt: 0,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractSongsApi', () => {
  it('forwards progress updates before returning the streamed song result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `${JSON.stringify({ type: 'progress', message: 'Found 3 of 4 songs - checking for missing songs...' })}\n${JSON.stringify({ type: 'result', songs: [song] })}\n`,
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const onProgress = vi.fn()

    await expect(
      extractSongsApi([{ mimeType: 'application/pdf', base64Data: 'data' }], 'key', 4, onProgress)
    ).resolves.toEqual([song])

    expect(onProgress).toHaveBeenCalledWith({
      message: 'Found 3 of 4 songs - checking for missing songs...',
      completed: undefined,
      total: undefined,
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ expectedSongCount: 4 })
  })

  it('streams out-of-order source events before the complete result', async () => {
    const source = {
      site: 'pnwchords',
      status: 'ok',
      count: 1,
      durationMs: 12,
      candidates: [
        {
          site: 'pnwchords',
          title: 'Good Grace',
          artist: 'Hillsong Worship',
          url: 'https://pnwchords.com/good-grace',
        },
      ],
    }
    const complete = {
      type: 'complete',
      query: 'good grace',
      results: source.candidates,
      sources: [source],
      partial: false,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`${JSON.stringify({ type: 'source', source, candidates: source.candidates })}\n${JSON.stringify(complete)}\n`, {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
        })
      )
    )
    const onSource = vi.fn()

    await expect(searchApiStream('good grace', { onSource })).resolves.toMatchObject({
      query: 'good grace',
      results: source.candidates,
      partial: false,
    })
    expect(onSource).toHaveBeenCalledWith(source)
  })

  it('falls back to JSON and reports malformed streams cleanly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ query: 'song', results: [], sources: [], partial: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response('{not-json}\n', {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchApiStream('song')).resolves.toMatchObject({ query: 'song', results: [] })
    await expect(searchApiStream('broken')).rejects.toThrow()
  })

  it('surfaces a streamed extraction error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`${JSON.stringify({ type: 'error', message: 'Could not reliably extract all 4 songs.' })}\n`)
      )
    )

    await expect(extractSongsApi([{ mimeType: 'application/pdf', base64Data: 'data' }])).rejects.toThrow(
      'Could not reliably extract all 4 songs.'
    )
  })
})
