import type { LiveSongContent } from './types.js'

// Pure and dependency-free: the browser imports this too, so both sides hash the same string.

/** Rebuilds the content from whitelisted fields only. */
export function sanitizeLiveSongContent(content: LiveSongContent): LiveSongContent {
  const clean: LiveSongContent = { song: content.song }
  if (content.customSections !== undefined) clean.customSections = content.customSections
  if (content.customFlow !== undefined) clean.customFlow = content.customFlow
  if (content.customSimplifiedSections !== undefined) {
    clean.customSimplifiedSections = content.customSimplifiedSections
  }
  if (content.customSimplifiedFlow !== undefined) {
    clean.customSimplifiedFlow = content.customSimplifiedFlow
  }
  return clean
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const fields = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}

/** The exact string that gets hashed for a content doc. */
export function canonicalLiveSongContent(content: LiveSongContent): string {
  return canonicalJson(sanitizeLiveSongContent(content))
}
