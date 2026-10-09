import { describe, it, expect } from 'vitest'
import { encodeSharePayload, decodeSharePayload } from './shareLink'
import type { SharePayload } from '../types/song'

describe('shareLink encode and decode', () => {
  it('correctly roundtrips a simple share payload', () => {
    const payload: SharePayload = {
      v: 1,
      name: 'Sunday Worship',
      songs: [
        {
          url: 'https://tabs.ultimate-guitar.com/tab/elevation-worship/goodness-of-god-chords-2678229',
          title: 'Goodness of God',
          artist: 'Elevation Worship',
          targetKey: 'G',
          simplified: true,
        },
      ],
    }

    const encoded = encodeSharePayload(payload)
    expect(typeof encoded).toBe('string')
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')

    const decoded = decodeSharePayload(encoded)
    expect(decoded).toEqual(payload)
  })

  it('handles unicode song titles and artist names', () => {
    const payload: SharePayload = {
      v: 1,
      name: 'Worship • 敬拜讚美',
      songs: [
        {
          url: 'https://pnwchords.com/song/1',
          title: '愛是不保留 (Love is Unreserved)',
          artist: '林以諾',
        },
      ],
    }

    const encoded = encodeSharePayload(payload)
    const decoded = decodeSharePayload(encoded)
    expect(decoded).toEqual(payload)
  })

  it('returns null on invalid or corrupted string', () => {
    expect(decodeSharePayload('invalid-base64-random-string@@@')).toBeNull()
    expect(decodeSharePayload('')).toBeNull()
  })
})
