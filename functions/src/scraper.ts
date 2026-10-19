import { createHash } from 'node:crypto'
import type { Song } from './types.js'
import { siteForHost } from './urls.js'
import { safeFetchHtml } from './safeFetch.js'
import { normalizeSongText, inferKeyFromChords } from './normalizer.js'
import { normalizeSongKey } from './keyDetector.js'
import { simplifySections } from './simplifyChords.js'
import { ultimateGuitarAdapter } from './adapters/ultimateGuitar.js'
import { pnwChordsAdapter } from './adapters/pnwChords.js'
import { worshipChordsAdapter } from './adapters/worshipChords.js'
import { worshipTogetherAdapter } from './adapters/worshipTogether.js'
import { genericFallbackAdapter } from './adapters/genericFallback.js'
import type { SiteAdapter } from './adapters/types.js'
import { elapsedMs, recordTiming } from './metrics.js'

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

export function adapterForUrl(url: string): SiteAdapter {
  return ADAPTERS.find((adapter) => adapter.matches(url)) || genericFallbackAdapter
}

export async function scrapeSingleUrl(
  url: string,
  fetchFn?: typeof safeFetchHtml
): Promise<Song> {
  const fetcher = fetchFn ?? safeFetchHtml
  const site = siteForHost(new URL(url).hostname) || 'generic'
  const fetchStartedAt = Date.now()
  let html: string
  let finalUrl: string
  try {
    ;({ text: html, finalUrl } = await fetcher(url))
    recordTiming({ operation: 'chart.fetch', site, durationMs: elapsedMs(fetchStartedAt), outcome: 'ok' })
  } catch (err) {
    const code = (err as { code?: string })?.code
    recordTiming({
      operation: 'chart.fetch',
      site,
      durationMs: elapsedMs(fetchStartedAt),
      outcome: code === 'TIMEOUT' ? 'timeout' : code === 'BLOCKED' ? 'blocked' : 'error',
    })
    throw err
  }

  const parsedUrl = new URL(finalUrl)
  const sourceSite = siteForHost(parsedUrl.hostname) || 'generic'

  // Pick adapter
  const adapter = adapterForUrl(finalUrl)
  const parseStartedAt = Date.now()
  let rawSong: ReturnType<SiteAdapter['extract']>
  let sections: ReturnType<typeof normalizeSongText>
  let key: string | null
  try {
    rawSong = adapter.extract(html, finalUrl)
    sections = normalizeSongText(rawSong.content)
    key = inferKeyFromChords(sections) ?? normalizeSongKey(rawSong.originalKey)
    recordTiming({
      operation: 'chart.parse',
      site: sourceSite,
      durationMs: elapsedMs(parseStartedAt),
      outcome: 'ok',
    })
  } catch (err) {
    recordTiming({
      operation: 'chart.parse',
      site: sourceSite,
      durationMs: elapsedMs(parseStartedAt),
      outcome: 'error',
    })
    throw err
  }

  let simplifiedSections: typeof sections | undefined
  let simplifiedSource: 'official' | 'algorithmic' | undefined
  let simplificationPending = false

  if (rawSong.simplifiedContent) {
    simplifiedSections = normalizeSongText(rawSong.simplifiedContent)
    simplifiedSource = 'official'
  } else if (sourceSite === 'ultimate-guitar' && rawSong.isSimplifyAvailable) {
    // Do not delay the original chart for the optional official simplification.
    // The client requests it lazily through /api/simplify.
    simplificationPending = true
  }

  // If no usable official simplified chart was obtained, generate algorithmic fallback
  if (!simplifiedSections || simplifiedSections.length === 0) {
    const { sections: fallbackSections, changedCount } = simplifySections(sections)
    if (changedCount > 0) {
      simplifiedSections = fallbackSections
      simplifiedSource = 'algorithmic'
    } else {
      simplifiedSections = undefined
      simplifiedSource = undefined
    }
  }

  return {
    id: generateSongId(finalUrl),
    title: rawSong.title,
    artist: rawSong.artist,
    sourceUrl: finalUrl,
    sourceSite: sourceSite,
    originalKey: key,
    capo: rawSong.capo,
    sections,
    simplifiedSections,
    simplifiedSource,
    simplificationPending: simplificationPending || undefined,
  }
}
