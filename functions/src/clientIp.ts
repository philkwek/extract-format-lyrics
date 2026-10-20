export interface ClientIpRequest {
  headers: Record<string, string | string[] | undefined>
  ip?: string
}

/**
 * X-Forwarded-For is append-only behind Google's front end. The first value is
 * caller-controlled, so only the last (appended) address is trusted.
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
