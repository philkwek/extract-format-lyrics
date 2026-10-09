import type { SharePayload } from '../types/song'

/**
 * Encodes a SharePayload into a base64url string with URL-safe characters.
 */
export function encodeSharePayload(payload: SharePayload): string {
  const json = JSON.stringify(payload)
  // UTF-8 safe base64 encoding in browser / JS
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Decodes a base64url string back into a SharePayload.
 */
export function decodeSharePayload(encoded: string): SharePayload | null {
  try {
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    while (base64.length % 4) {
      base64 += '='
    }
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json) as SharePayload
    if (parsed && parsed.name && Array.isArray(parsed.songs)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * Safely extracts the base64 share payload from a raw hash string,
 * accommodating various formats (#..., #/share#..., #share=...).
 */
export function parseHashPayload(rawHash: string): string {
  let s = rawHash
  if (s.startsWith('#/share#')) {
    s = s.slice(8)
  } else if (s.startsWith('#share=')) {
    s = s.slice(7)
  } else if (s.startsWith('#')) {
    s = s.slice(1)
  }
  if (s.startsWith('/share#')) {
    s = s.slice(7)
  }
  if (s.startsWith('#')) {
    s = s.slice(1)
  }
  return s
}

