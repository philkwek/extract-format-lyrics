import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractSongsApi } from './api'

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

    expect(onProgress).toHaveBeenCalledWith('Found 3 of 4 songs - checking for missing songs...')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ expectedSongCount: 4 })
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
