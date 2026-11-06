import { describe, expect, it } from 'vitest'
import {
  describeHostChanges,
  mergeHostChanges,
  summarizeHostChanges,
} from '../../src/lib/liveChanges'
import type { Session, SessionSongItem } from '../../src/lib/sessionStore'

const song = (id: string, over: Partial<SessionSongItem> = {}): SessionSongItem => ({
  entryId: id,
  url: `https://example.test/${id}`,
  title: id.toUpperCase(),
  status: 'ok',
  ...over,
})
const set = (songs: SessionSongItem[], name = 'Sunday'): Session => ({
  id: 's',
  createdAt: 0,
  name,
  songs,
})
const texts = (before: Session, after: Session) =>
  describeHostChanges(before, after).map((c) => c.text)

describe('describeHostChanges', () => {
  const a = song('a')
  const b = song('b')

  it('finds nothing when nothing changed', () => {
    expect(texts(set([a, b]), set([a, b]))).toEqual([])
  })

  it('names added and removed songs', () => {
    expect(texts(set([a]), set([a, b]))).toEqual(['Added “B”'])
    expect(texts(set([a, b]), set([a]))).toEqual(['Removed “B”'])
  })

  it('notices a new order but not one caused by an add or remove', () => {
    expect(texts(set([a, b]), set([b, a]))).toEqual(['Changed the song order'])
    expect(texts(set([a, b]), set([song('c'), a, b]))).toEqual(['Added “C”'])
  })

  it('names a key change and a return to the original key', () => {
    expect(texts(set([a]), set([song('a', { targetKey: 'A' })]))).toEqual(['“A” is now in A'])
    expect(texts(set([song('a', { targetKey: 'A' })]), set([a]))).toEqual([
      '“A” is back in its original key',
    ])
  })

  it('names chord, simplify and pad changes', () => {
    const edited = song('a', { customFlow: [1, 0] })
    expect(texts(set([a]), set([edited]))).toEqual(['Edited chords in “A”'])
    expect(texts(set([a]), set([song('a', { simplified: true })]))).toEqual(['Simplified “A”'])
    expect(texts(set([a]), set([song('a', { padKeyMode: 'custom', customPadKey: 'D' })]))).toEqual([
      'Changed the pad in “A”',
    ])
  })

  it('names a renamed set', () => {
    expect(texts(set([a]), set([a], 'Youth'))).toEqual(['Renamed the set to “Youth”'])
  })

  it('tags each change with its song', () => {
    expect(describeHostChanges(set([a]), set([a, b]))[0].songKey).toBe('b')
  })
})

describe('summarizeHostChanges', () => {
  it('shows up to two changes in full', () => {
    expect(summarizeHostChanges([{ text: 'Added “B”', songKey: 'b' }])).toEqual({
      text: 'Added “B”',
      songKey: 'b',
    })
    expect(
      summarizeHostChanges([
        { text: 'One', songKey: 'a' },
        { text: 'Two', songKey: 'b' },
      ]),
    ).toEqual({ text: 'One. Two', songKey: undefined })
  })

  it('counts songs when there are more', () => {
    const many = ['a', 'b', 'c'].map((k) => ({ text: k, songKey: k }))
    expect(summarizeHostChanges(many)?.text).toBe('Updated 3 songs')
    const oneSong = ['x', 'y', 'z'].map((t) => ({ text: t, songKey: 'a' }))
    expect(summarizeHostChanges(oneSong)).toEqual({ text: 'Made 3 changes', songKey: 'a' })
  })

  it('returns nothing for no changes', () => {
    expect(summarizeHostChanges([])).toBeNull()
  })
})

describe('mergeHostChanges', () => {
  it('adds new lines and skips repeats', () => {
    expect(
      mergeHostChanges([{ text: 'One' }], [{ text: 'One' }, { text: 'Two' }]).map((c) => c.text),
    ).toEqual(['One', 'Two'])
  })
})
