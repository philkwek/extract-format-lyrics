import { describe, expect, it } from 'vitest'
import type { Session, SessionSongItem } from '../../src/lib/sessionStore'
import { ACCOUNT_MAX_SONGS, SET_DATA_MAX, checkSetLimits } from '../../src/lib/accountLimits'

const demoSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'set-1',
  name: 'Sunday practice',
  createdAt: 1,
  songs: [],
  ...overrides,
})

const demoSongs = (count: number): SessionSongItem[] =>
  Array.from({ length: count }, (_, i) => ({
    url: `https://tabs.example.com/demo-${i}`,
    title: `Demo song ${i}`,
  }))

const savedSize = (session: Session) =>
  JSON.stringify({
    name: session.name,
    createdAt: session.createdAt,
    songs: session.songs,
  }).length

describe('account limits', () => {
  it('accepts an ordinary set', () => {
    expect(checkSetLimits(demoSession())).toBeNull()
  })

  it('accepts exactly 30 songs and rejects 31', () => {
    expect(checkSetLimits(demoSession({ songs: demoSongs(ACCOUNT_MAX_SONGS) }))).toBeNull()
    const tooMany = demoSession({ songs: demoSongs(ACCOUNT_MAX_SONGS + 1) })
    expect(checkSetLimits(tooMany)).toBe(
      "This set has more than 30 songs, so it can't be saved to your account.",
    )
  })

  it('accepts data at the size limit and rejects one character more', () => {
    const overhead = savedSize(demoSession({ name: '' }))
    const atLimit = demoSession({ name: 'x'.repeat(SET_DATA_MAX - overhead) })
    expect(savedSize(atLimit)).toBe(SET_DATA_MAX)
    expect(checkSetLimits(atLimit)).toBeNull()

    const overLimit = demoSession({ name: 'x'.repeat(SET_DATA_MAX - overhead + 1) })
    expect(checkSetLimits(overLimit)).toBe('This set is too big to save to your account.')
  })

  it('ignores device-only fields when measuring the size', () => {
    const name = 'x'.repeat(SET_DATA_MAX - savedSize(demoSession({ name: '' })))
    const session = demoSession({ name })
    expect(checkSetLimits({ ...session, publicId: 'p'.repeat(10_000) })).toBeNull()
  })
})
