import { parseKey } from './transpose'

export const PAD_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

export type PadKey = (typeof PAD_KEYS)[number]

/**
 * Resolves any major key string (including enharmonic spellings like C#, F#, G#, D#, A#)
 * to its corresponding canonical PadKey used for `/pads/${padKey}.mp3`.
 */
export function resolvePadKey(key: string | null | undefined): PadKey | null {
  if (!key) return null
  const parsed = parseKey(key)
  if (!parsed || parsed.minor) return null
  return PAD_KEYS[((parsed.root % 12) + 12) % 12] ?? null
}

export function getPadAudioUrl(padKey: PadKey): string {
  return `/pads/${padKey}.mp3`
}

/** Cache Storage bucket for pad audio. Bump when the files are replaced. */
export const PAD_CACHE_NAME = 'pads-v1'

/** Every pad, so the installed app can keep the whole set for offline use. */
export const PAD_URLS = PAD_KEYS.map(getPadAudioUrl)
