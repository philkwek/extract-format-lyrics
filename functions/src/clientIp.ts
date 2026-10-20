export interface ClientIpRequest {
  headers: Record<string, string | string[] | undefined>
  ip?: string
}

/**
 * Direct cloudfunctions.net requests are appended by Google's front end, which
 * puts the connecting client last; caller-supplied prefixes stay to the left.
 * Firebase Hosting adds proxy hops before Cloud Run, so the last value is a
 * proxy there. Recovering the browser on that path needs a trusted platform
 * header or ingress restriction; a fixed index or Fastly-Client-IP would be
 * spoofable through the public direct function URL.
 */
export function clientIpFromRequest(req: ClientIpRequest): string {
  const header = req.headers['x-forwarded-for']
  const values = Array.isArray(header) ? header : header ? [header] : []
  const forwarded = values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1)
  return forwarded || req.ip || 'unknown'
}
