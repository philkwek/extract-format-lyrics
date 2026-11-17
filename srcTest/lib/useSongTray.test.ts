// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SearchCandidate } from '../../src/lib/api'

const importSources = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/setlistImport', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/setlistImport')>()),
  importSources,
}))

import { TRAY_MAX_SONGS, useSongTray } from '../../src/lib/useSongTray'

const song = (n: number): SearchCandidate => ({
  site: 'pnwchords',
  title: `Song ${n}`,
  artist: 'Artist',
  url: `https://pnwchords.com/song-${n}`,
})

beforeEach(() => {
  importSources.mockReset()
})

describe('useSongTray', () => {
  it('adds songs in order and ignores the same chart twice', () => {
    const { result } = renderHook(() => useSongTray())
    act(() => {
      result.current.add(song(1))
      result.current.add(song(2))
      result.current.add(song(1))
    })
    expect(result.current.items.map((i) => i.title)).toEqual(['Song 1', 'Song 2'])
    expect(result.current.urls.has(song(1).url)).toBe(true)
  })

  it('stops at the song limit', () => {
    const { result } = renderHook(() => useSongTray())
    act(() => {
      for (let n = 0; n <= TRAY_MAX_SONGS; n += 1) result.current.add(song(n))
    })
    expect(result.current.items).toHaveLength(TRAY_MAX_SONGS)
    expect(result.current.isFull).toBe(true)
  })

  it('moves songs and ignores moves past either end', () => {
    const { result } = renderHook(() => useSongTray())
    act(() => {
      result.current.add(song(1))
      result.current.add(song(2))
      result.current.add(song(3))
    })
    act(() => result.current.move(2, 0))
    expect(result.current.items.map((i) => i.title)).toEqual(['Song 3', 'Song 1', 'Song 2'])
    act(() => result.current.move(0, -1))
    act(() => result.current.move(2, 3))
    expect(result.current.items.map((i) => i.title)).toEqual(['Song 3', 'Song 1', 'Song 2'])
  })

  it('removes a song', () => {
    const { result } = renderHook(() => useSongTray())
    act(() => {
      result.current.add(song(1))
      result.current.add(song(2))
    })
    act(() => result.current.remove(song(1).url))
    expect(result.current.items.map((i) => i.title)).toEqual(['Song 2'])
  })

  it('creates one set from every song in tray order', async () => {
    const session = { id: 's1' }
    importSources.mockResolvedValue({ session, imported: 2 })
    const { result } = renderHook(() => useSongTray())
    act(() => {
      result.current.add(song(1))
      result.current.add(song(2))
    })
    act(() => result.current.move(1, 0))
    let created: unknown
    await act(async () => {
      created = await result.current.create()
    })
    expect(created).toBe(session)
    expect(importSources).toHaveBeenCalledTimes(1)
    const [sources, options] = importSources.mock.calls[0]
    expect(sources.map((s: { title: string }) => s.title)).toEqual(['Song 2', 'Song 1'])
    expect(options.requireAll).toBe(true)
  })

  it('keeps the tray and marks the failed song when the import fails', async () => {
    importSources.mockImplementation(async (...args: unknown[]) => {
      const options = args[1] as { onProgress: (s: unknown) => void }
      options.onProgress([
        { url: song(1).url, status: 'done' },
        { url: song(2).url, status: 'error', message: 'Scrape failed' },
      ])
      throw new Error('Scrape failed')
    })
    const { result } = renderHook(() => useSongTray())
    act(() => {
      result.current.add(song(1))
      result.current.add(song(2))
    })
    let created: unknown = 'unset'
    await act(async () => {
      created = await result.current.create()
    })
    expect(created).toBeNull()
    expect(importSources).toHaveBeenCalledTimes(1)
    expect(result.current.items).toHaveLength(2)
    expect([...result.current.failedUrls]).toEqual([song(2).url])
    expect(result.current.error).toBe('Scrape failed')
  })
})
