import { createHash } from 'node:crypto'
import type { Song } from './types.js'
import { siteForHost } from './urls.js'
import { safeFetchHtml } from './safeFetch.js'
import { normalizeSongText, inferKeyFromChords } from './normalizer.js'
import { ultimateGuitarAdapter } from './adapters/ultimateGuitar.js'
import { pnwChordsAdapter } from './adapters/pnwChords.js'
import { worshipChordsAdapter } from './adapters/worshipChords.js'
import { worshipTogetherAdapter } from './adapters/worshipTogether.js'
import { genericFallbackAdapter } from './adapters/genericFallback.js'
import type { SiteAdapter } from './adapters/types.js'

const ADAPTERS: SiteAdapter[] = [
  ultimateGuitarAdapter,
  pnwChordsAdapter,
  worshipChordsAdapter,
  worshipTogetherAdapter,
  genericFallbackAdapter,
]

export function generateSongId(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 16)
}

export async function scrapeSingleUrl(
  url: string,
  fetchFn?: typeof safeFetchHtml
): Promise<Song> {
  const fetcher = fetchFn ?? safeFetchHtml
  const { text: html, finalUrl } = await fetcher(url)

  const parsedUrl = new URL(finalUrl)
  const site = siteForHost(parsedUrl.hostname) || 'generic'

  // Pick adapter
  const adapter = ADAPTERS.find((a) => a.matches(finalUrl)) || genericFallbackAdapter
  const rawSong = adapter.extract(html, finalUrl)

  const sections = normalizeSongText(rawSong.content)
  const key = rawSong.originalKey || inferKeyFromChords(sections)

  return {
    id: generateSongId(finalUrl),
    title: rawSong.title,
    artist: rawSong.artist,
    sourceUrl: finalUrl,
    sourceSite: site,
    originalKey: key,
    capo: rawSong.capo,
    sections,
  }
}
