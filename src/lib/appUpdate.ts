/** The running bundle's file name, e.g. index-CvaoCZ9b.js. Every deploy renames it. */
export const APP_BUILD_ID = buildIdFromUrl(import.meta.url)

/** Takes a file name out of a URL; anything unparseable counts as unknown. */
export function buildIdFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split('/').pop() ?? ''
  } catch {
    return ''
  }
}

/** Same build means nothing to do; a missing or unreadable version file never prompts. */
export function hasNewBuild(current: string, latest: string | null): boolean {
  return Boolean(latest) && latest !== current
}

/** Reads the deployed entry name. /version.json is written at build time. */
export async function fetchLatestBuildId(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher('/version.json', { cache: 'no-store' })
    if (!response.ok) return null
    const body: unknown = await response.json()
    const entry = (body as { entry?: unknown } | null)?.entry
    return typeof entry === 'string' && entry ? (entry.split('/').pop() ?? null) : null
  } catch {
    return null
  }
}
