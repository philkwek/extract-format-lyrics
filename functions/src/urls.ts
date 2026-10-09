/** URL splitting, normalisation and domain allow-list. */

/** Hosts (and their subdomains) the scraper is allowed to contact. */
export const ALLOWED_DOMAINS = [
  'ultimate-guitar.com',
  'pnwchords.com',
  'worshipchords.com',
  'worshiptogether.com',
] as const

export const MAX_URLS_PER_REQUEST = 20

export type SiteId = 'ultimate-guitar' | 'pnwchords' | 'worshipchords' | 'worshiptogether'

const SITE_BY_DOMAIN: Record<(typeof ALLOWED_DOMAINS)[number], SiteId> = {
  'ultimate-guitar.com': 'ultimate-guitar',
  'pnwchords.com': 'pnwchords',
  'worshipchords.com': 'worshipchords',
  'worshiptogether.com': 'worshiptogether',
}

export function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
}

export function siteForHost(hostname: string): SiteId | null {
  const host = hostname.toLowerCase()
  const domain = ALLOWED_DOMAINS.find((d) => host === d || host.endsWith(`.${d}`))
  return domain ? SITE_BY_DOMAIN[domain] : null
}

/** Splits pasted text on whitespace/commas, trimming and dropping empties. */
export function splitUrls(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export type UrlCheck =
  | { ok: true; url: string; site: SiteId }
  | { ok: false; input: string; reason: string }

/** Validates one URL: https only, no credentials, allow-listed host. Returns a normalised URL. */
export function checkUrl(input: string): UrlCheck {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return { ok: false, input, reason: 'Not a valid URL' }
  }
  if (u.protocol !== 'https:') return { ok: false, input, reason: 'Only https links are supported' }
  if (u.username || u.password) return { ok: false, input, reason: 'URLs with credentials are not allowed' }
  if (u.port && u.port !== '443') return { ok: false, input, reason: 'Custom ports are not allowed' }
  const site = siteForHost(u.hostname)
  if (!site) return { ok: false, input, reason: 'This website is not supported' }
  u.hash = ''
  return { ok: true, url: u.toString(), site }
}

export interface UrlBatch {
  valid: { url: string; site: SiteId }[]
  invalid: { input: string; reason: string }[]
}

/** Splits, validates and de-duplicates a batch of URLs. */
export function validateUrls(inputs: string[]): UrlBatch {
  const valid: UrlBatch['valid'] = []
  const invalid: UrlBatch['invalid'] = []
  const seen = new Set<string>()
  for (const input of inputs) {
    const r = checkUrl(input)
    if (!r.ok) {
      invalid.push({ input: r.input, reason: r.reason })
    } else if (!seen.has(r.url)) {
      seen.add(r.url)
      valid.push({ url: r.url, site: r.site })
    }
  }
  return { valid, invalid }
}
