const SERVER_DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'

/**
 * The server pays for extraction unless the caller supplies their own key, so
 * only that case may choose a model.
 */
export function resolveExtractionModel(requested: unknown, apiKey: unknown): string {
  if (
    typeof apiKey === 'string' &&
    apiKey.trim() &&
    typeof requested === 'string' &&
    requested.trim()
  ) {
    return requested.trim()
  }
  return SERVER_DEFAULT_MODEL
}
