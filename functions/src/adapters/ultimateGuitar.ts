import * as cheerio from 'cheerio'
import type { RawSong, SiteAdapter } from './types.js'

interface UgStoreData {
  store?: {
    page?: {
      data?: {
        tab?: {
          song_name?: string
          artist_name?: string
        }
        tab_view?: {
          meta?: {
            tonality?: string
            capo?: number
          }
          is_simplify_available?: boolean
          wiki_tab?: {
            content?: string
          }
        }
      }
    }
  }
}

export const ultimateGuitarAdapter: SiteAdapter = {
  site: 'ultimate-guitar',

  matches(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname === 'tabs.ultimate-guitar.com' || u.hostname.endsWith('.ultimate-guitar.com')
    } catch {
      return false
    }
  },

  extract(html: string): RawSong {
    const $ = cheerio.load(html)
    const storeEl = $('div.js-store')
    const rawData = storeEl.attr('data-content')

    if (!rawData) {
      throw new Error('Ultimate Guitar: Could not find tab data container (.js-store)')
    }

    let parsed: UgStoreData
    try {
      parsed = JSON.parse(rawData) as UgStoreData
    } catch (err) {
      throw new Error(`Ultimate Guitar: Failed to parse data JSON: ${(err as Error).message}`, {
        cause: err,
      })
    }

    const pageData = parsed?.store?.page?.data
    if (!pageData) {
      throw new Error('Ultimate Guitar: Invalid page data structure')
    }

    const songName = pageData.tab?.song_name ?? 'Unknown Title'
    const artistName = pageData.tab?.artist_name ?? 'Unknown Artist'
    const originalKey = pageData.tab_view?.meta?.tonality ?? null
    const capo = pageData.tab_view?.meta?.capo ?? undefined

    const wikiContent = pageData.tab_view?.wiki_tab?.content
    if (!wikiContent) {
      throw new Error('Ultimate Guitar: Tab content is missing or empty')
    }

    const isSimplifyAvailable = Boolean(pageData.tab_view?.is_simplify_available)

    // Strip [ch]...[/ch] and [tab]...[/tab] BBCode markers, preserving the text inside
    const cleanedContent = wikiContent
      .replace(/\[\/?ch\]/g, '')
      .replace(/\[\/?tab\]/g, '')

    return {
      title: songName,
      artist: artistName,
      originalKey,
      capo: typeof capo === 'number' && capo > 0 ? capo : undefined,
      content: cleanedContent,
      isSimplifyAvailable,
    }
  },
}
