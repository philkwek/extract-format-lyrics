import { describe, expect, it, vi } from 'vitest'
import { buildIdFromUrl, fetchLatestBuildId, hasNewBuild } from '../../src/lib/appUpdate'

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response
}

describe('buildIdFromUrl', () => {
  it('takes the file name out of a bundle URL', () => {
    expect(buildIdFromUrl('https://setsandsheets.com/assets/index-CvaoCZ9b.js')).toBe(
      'index-CvaoCZ9b.js',
    )
    expect(buildIdFromUrl('file:///repo/dist/assets/index-a.js')).toBe('index-a.js')
    expect(buildIdFromUrl('https://setsandsheets.com/assets/index-a.js?v=2')).toBe('index-a.js')
  })

  it('reports an unknown build instead of throwing', () => {
    expect(buildIdFromUrl('not a url')).toBe('')
  })
})

describe('hasNewBuild', () => {
  it('only prompts when the deployed entry differs', () => {
    expect(hasNewBuild('index-a.js', 'index-a.js')).toBe(false)
    expect(hasNewBuild('index-a.js', 'index-b.js')).toBe(true)
  })

  it('says nothing when the version file is missing or empty', () => {
    expect(hasNewBuild('index-a.js', null)).toBe(false)
    expect(hasNewBuild('index-a.js', '')).toBe(false)
  })
})

describe('fetchLatestBuildId', () => {
  it('reads the entry name and bypasses the HTTP cache', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ entry: 'assets/index-b.js' }))
    await expect(fetchLatestBuildId(fetcher)).resolves.toBe('index-b.js')
    expect(fetcher).toHaveBeenCalledWith('/version.json', { cache: 'no-store' })
  })

  it('stays quiet when the file is absent, unreadable or the wrong shape', async () => {
    await expect(fetchLatestBuildId(vi.fn(async () => jsonResponse({}, false)))).resolves.toBeNull()
    await expect(
      fetchLatestBuildId(vi.fn(async () => jsonResponse({ entry: 7 }))),
    ).resolves.toBeNull()
    await expect(fetchLatestBuildId(vi.fn(async () => jsonResponse(null)))).resolves.toBeNull()
    await expect(
      fetchLatestBuildId(
        vi.fn(async () => {
          throw new TypeError('offline')
        }),
      ),
    ).resolves.toBeNull()
    await expect(
      fetchLatestBuildId(
        vi.fn(
          async () => ({ ok: true, json: async () => JSON.parse('<html>') }) as unknown as Response,
        ),
      ),
    ).resolves.toBeNull()
  })
})
