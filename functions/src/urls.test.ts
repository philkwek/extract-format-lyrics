import { describe, expect, it } from 'vitest'
import { checkUrl, isAllowedHost, splitUrls, validateUrls } from './urls'

describe('splitUrls', () => {
  it('splits on newlines, spaces and commas', () => {
    expect(splitUrls('a\nb  c,d,\n\n e')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('isAllowedHost', () => {
  it('allows listed domains and subdomains only', () => {
    expect(isAllowedHost('tabs.ultimate-guitar.com')).toBe(true)
    expect(isAllowedHost('www.worshiptogether.com')).toBe(true)
    expect(isAllowedHost('evilultimate-guitar.com')).toBe(false)
    expect(isAllowedHost('ultimate-guitar.com.evil.com')).toBe(false)
  })
})

describe('checkUrl', () => {
  it('accepts allow-listed https URLs and strips the hash', () => {
    const r = checkUrl('https://tabs.ultimate-guitar.com/tab/a/b-chords-1#x')
    expect(r).toEqual({
      ok: true,
      url: 'https://tabs.ultimate-guitar.com/tab/a/b-chords-1',
      site: 'ultimate-guitar',
    })
  })

  it('rejects http, other hosts, credentials and bad input', () => {
    expect(checkUrl('http://tabs.ultimate-guitar.com/x').ok).toBe(false)
    expect(checkUrl('https://example.com/x').ok).toBe(false)
    expect(checkUrl('https://user:pw@pnwchords.com/x').ok).toBe(false)
    expect(checkUrl('https://pnwchords.com:8443/x').ok).toBe(false)
    expect(checkUrl('not a url').ok).toBe(false)
    expect(checkUrl('https://127.0.0.1/x').ok).toBe(false)
  })
})

describe('validateUrls', () => {
  it('dedupes and separates invalid entries', () => {
    const r = validateUrls([
      'https://pnwchords.com/song-1',
      'https://pnwchords.com/song-1',
      'https://example.com/a',
    ])
    expect(r.valid).toHaveLength(1)
    expect(r.invalid).toHaveLength(1)
    expect(r.invalid[0].reason).toMatch(/not supported/)
  })
})
