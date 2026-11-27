import { describe, expect, it } from 'vitest'
import {
  clashDiff,
  mergeSet,
  sameSyncedSet,
  type Clash,
  type MergeResult,
  type SyncedEntry,
  type SyncedSet,
} from '../../src/lib/setMerge'

function song(entryId: string, overrides: Partial<SyncedEntry> = {}): SyncedEntry {
  return {
    entryId,
    url: `https://example.test/${entryId}`,
    title: `Demo Song ${entryId}`,
    artist: 'Demo Artist',
    ...overrides,
  }
}

function makeSet(name: string, songs: SyncedEntry[], createdAt = 1000): SyncedSet {
  return { name, createdAt, songs }
}

function ids(songs: SyncedEntry[]): string[] {
  return songs.map((entry) => entry.entryId)
}

function mergedOf(result: MergeResult): SyncedSet {
  if (!result.ok) throw new Error('expected a merge')
  return result.merged
}

function clashesOf(result: MergeResult): Clash[] {
  if (result.ok) throw new Error('expected a clash')
  return result.clashes
}

type FieldName = Extract<Clash, { kind: 'field' }>['field']

function fieldClash(
  field: FieldName,
  title = 'Demo Song A',
  local?: string,
  remote?: string,
): Clash {
  return {
    kind: 'field',
    entryId: 'A',
    title,
    field,
    ...(local !== undefined ? { local } : {}),
    ...(remote !== undefined ? { remote } : {}),
  }
}

const verse = { type: 'Verse' as const, label: 'Verse 1', lines: [] }
const chorus = { type: 'Chorus' as const, label: 'Chorus', lines: [] }

describe('3.3 table: set name', () => {
  it('keeps the local createdAt', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')], 1),
      makeSet('Demo Set', [song('A')], 2),
      makeSet('Demo Set', [song('A')], 3),
    )
    expect(mergedOf(result).createdAt).toBe(2)
  })

  it('takes a name changed on one side', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('Local Set', [song('A')]),
      makeSet('Demo Set', [song('A')]),
    )
    expect(mergedOf(result).name).toBe('Local Set')
  })

  it('takes a name changed on the remote side', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', [song('A')]),
      makeSet('Remote Set', [song('A')]),
    )
    expect(mergedOf(result).name).toBe('Remote Set')
  })

  it('accepts the same new name on both sides', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('New Set', [song('A')]),
      makeSet('New Set', [song('A')]),
    )
    expect(mergedOf(result).name).toBe('New Set')
  })

  it('clashes on different names', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('Local Set', [song('A')]),
      makeSet('Remote Set', [song('A')]),
    )
    expect(clashesOf(result)).toEqual([{ kind: 'name', local: 'Local Set', remote: 'Remote Set' }])
  })
})

describe('3.3 table: entries added and removed', () => {
  it('keeps an entry added on one side', () => {
    const result = mergeSet(
      makeSet('Demo Set', []),
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', []),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['A'])
  })

  it('keeps both entries when each side added a different one', () => {
    const result = mergeSet(
      makeSet('Demo Set', []),
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', [song('B')]),
    )
    expect(ids(mergedOf(result).songs).sort()).toEqual(['A', 'B'])
  })

  it('removes an entry removed on one side and unchanged on the other', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('B')]),
      makeSet('Demo Set', [song('A'), song('B')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['B'])
  })

  it('removes an entry removed on both sides', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('B')]),
      makeSet('Demo Set', [song('B')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['B'])
  })

  it('clashes when an entry was removed on one side and edited on the other', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('B')]),
      makeSet('Demo Set', [song('A', { targetKey: 'A' }), song('B')]),
    )
    expect(clashesOf(result)).toEqual([
      { kind: 'removed-edited', entryId: 'A', title: 'Demo Song A', removedOn: 'local' },
    ])
  })

  it('treats a changed chart as an edit when the other side removed the entry', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', []),
      makeSet('Demo Set', [song('A', { contentHash: 'hash-2' })]),
    )
    expect(clashesOf(result)).toEqual([
      { kind: 'removed-edited', entryId: 'A', title: 'Demo Song A', removedOn: 'local' },
    ])
  })
})

describe('3.3 table: entry fields', () => {
  interface EntryFieldRow {
    name: string
    base: Partial<SyncedEntry>
    local: Partial<SyncedEntry>
    remote: Partial<SyncedEntry>
    expected?: Partial<SyncedEntry>
    clash?: Clash
  }

  const rows: EntryFieldRow[] = [
    {
      name: 'takes a targetKey changed on one side',
      base: { targetKey: 'G' },
      local: { targetKey: 'A' },
      remote: { targetKey: 'G' },
      expected: { targetKey: 'A' },
    },
    {
      name: 'takes a targetKey changed on the remote side',
      base: { targetKey: 'G' },
      local: { targetKey: 'G' },
      remote: { targetKey: 'A' },
      expected: { targetKey: 'A' },
    },
    {
      name: 'accepts the same targetKey on both sides',
      base: { targetKey: 'G' },
      local: { targetKey: 'A' },
      remote: { targetKey: 'A' },
      expected: { targetKey: 'A' },
    },
    {
      name: 'clashes on different targetKeys',
      base: { targetKey: 'G' },
      local: { targetKey: 'A' },
      remote: { targetKey: 'B' },
      clash: fieldClash('targetKey', 'Demo Song A', 'A', 'B'),
    },
    {
      name: 'takes a padKeyMode changed on one side',
      base: { padKeyMode: 'match' },
      local: { padKeyMode: 'custom' },
      remote: { padKeyMode: 'match' },
      expected: { padKeyMode: 'custom' },
    },
    {
      name: 'accepts the same padKeyMode on both sides',
      base: { padKeyMode: 'match' },
      local: { padKeyMode: 'custom' },
      remote: { padKeyMode: 'custom' },
      expected: { padKeyMode: 'custom' },
    },
    {
      name: 'clashes on different padKeyModes',
      base: { padKeyMode: 'custom', customPadKey: 'C' },
      local: { padKeyMode: 'match' },
      remote: { padKeyMode: 'custom', customPadKey: 'D' },
      clash: fieldClash('pad', 'Demo Song A', 'match key', 'D'),
    },
    {
      name: 'takes a customPadKey changed on one side',
      base: { padKeyMode: 'custom', customPadKey: 'C' },
      local: { padKeyMode: 'custom', customPadKey: 'D' },
      remote: { padKeyMode: 'custom', customPadKey: 'C' },
      expected: { padKeyMode: 'custom', customPadKey: 'D' },
    },
    {
      name: 'clashes on different customPadKeys',
      base: {},
      local: { padKeyMode: 'custom', customPadKey: 'C' },
      remote: { padKeyMode: 'custom', customPadKey: 'D' },
      clash: fieldClash('pad', 'Demo Song A', 'C', 'D'),
    },
    {
      name: 'emits a single pad clash when both padKeyMode and customPadKey change',
      base: { padKeyMode: 'match' },
      local: { padKeyMode: 'custom', customPadKey: 'D' },
      remote: { padKeyMode: 'custom', customPadKey: 'E' },
      clash: fieldClash('pad', 'Demo Song A', 'D', 'E'),
    },
    {
      name: 'takes a simplified flag changed on one side',
      base: { simplified: false },
      local: { simplified: true },
      remote: { simplified: false },
      expected: { simplified: true },
    },
    {
      name: 'accepts the same simplified flag on both sides',
      base: { simplified: false },
      local: { simplified: true },
      remote: { simplified: true },
      expected: { simplified: true },
    },
    {
      name: 'takes simplified: true when base omits simplified and remote is false',
      base: {},
      local: { simplified: true },
      remote: { simplified: false },
      expected: { simplified: true },
    },
    {
      name: 'takes a contentHash changed on one side',
      base: { contentHash: 'hash-1' },
      local: { contentHash: 'hash-2' },
      remote: { contentHash: 'hash-1' },
      expected: { contentHash: 'hash-2' },
    },
    {
      name: 'accepts the same contentHash on both sides',
      base: { contentHash: 'hash-1' },
      local: { contentHash: 'hash-2' },
      remote: { contentHash: 'hash-2' },
      expected: { contentHash: 'hash-2' },
    },
    {
      name: 'clashes on different contentHashes',
      base: { contentHash: 'hash-1' },
      local: { contentHash: 'hash-2' },
      remote: { contentHash: 'hash-3' },
      clash: fieldClash('song'),
    },
    {
      name: 'takes a title changed on one side as part of the chart',
      base: {},
      local: { title: 'Demo Song A (new)' },
      remote: {},
      expected: { title: 'Demo Song A (new)' },
    },
    {
      name: 'clashes on different titles',
      base: {},
      local: { title: 'Local Title' },
      remote: { title: 'Remote Title' },
      clash: fieldClash('song', 'Local Title'),
    },
    {
      name: 'takes a url changed on one side as part of the chart',
      base: {},
      local: { url: 'https://example.test/other' },
      remote: {},
      expected: { url: 'https://example.test/other' },
    },
    {
      name: 'clashes on different urls',
      base: {},
      local: { url: 'https://example.test/local' },
      remote: { url: 'https://example.test/remote' },
      clash: fieldClash('song'),
    },
  ]

  for (const row of rows) {
    it(row.name, () => {
      const result = mergeSet(
        makeSet('Demo Set', [song('A', row.base)]),
        makeSet('Demo Set', [song('A', row.local)]),
        makeSet('Demo Set', [song('A', row.remote)]),
      )
      if (row.clash) {
        expect(clashesOf(result)).toEqual([row.clash])
      } else {
        expect(mergedOf(result).songs).toEqual([song('A', row.expected)])
      }
    })
  }
})

describe('3.3 table: custom sections and flow', () => {
  interface SectionsRow {
    name: string
    base: Partial<SyncedEntry>
    local: Partial<SyncedEntry>
    remote: Partial<SyncedEntry>
    expected?: Partial<SyncedEntry>
    clash?: Clash
  }

  const rows: SectionsRow[] = [
    {
      name: 'takes changed custom sections on one side',
      base: { customSections: [verse], customFlow: [0] },
      local: { customSections: [verse, chorus], customFlow: [0, 1] },
      remote: { customSections: [verse], customFlow: [0] },
      expected: { customSections: [verse, chorus], customFlow: [0, 1] },
    },
    {
      name: 'accepts the same changed custom sections on both sides',
      base: { customSections: [verse], customFlow: [0] },
      local: { customSections: [chorus], customFlow: [0] },
      remote: { customSections: [chorus], customFlow: [0] },
      expected: { customSections: [chorus], customFlow: [0] },
    },
    {
      name: 'clashes on different custom sections',
      base: { customSections: [verse], customFlow: [0] },
      local: { customSections: [chorus], customFlow: [0] },
      remote: { customSections: [verse, chorus], customFlow: [0, 1] },
      clash: {
        kind: 'sections',
        entryId: 'A',
        title: 'Demo Song A',
        simplified: false,
        arrangement: true,
        localSummary: 'Added Chorus; Removed Verse 1',
        remoteSummary: 'Added Chorus',
      },
    },
    {
      name: 'treats custom sections and flow as one unit',
      base: { customSections: [verse], customFlow: [0] },
      local: { customSections: [verse], customFlow: [0, 0] },
      remote: { customSections: [verse], customFlow: [0] },
      expected: { customSections: [verse], customFlow: [0, 0] },
    },
    {
      name: 'takes changed simplified sections on one side',
      base: { customSimplifiedSections: [verse], customSimplifiedFlow: [0] },
      local: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
      remote: { customSimplifiedSections: [verse], customSimplifiedFlow: [0] },
      expected: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
    },
    {
      name: 'accepts the same changed simplified sections on both sides',
      base: { customSimplifiedSections: [verse], customSimplifiedFlow: [0] },
      local: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
      remote: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
      expected: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
    },
    {
      name: 'clashes on different simplified sections',
      base: { customSimplifiedSections: [verse], customSimplifiedFlow: [0] },
      local: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
      remote: { customSimplifiedSections: [verse, chorus], customSimplifiedFlow: [0, 1] },
      clash: {
        kind: 'sections',
        entryId: 'A',
        title: 'Demo Song A',
        simplified: true,
        arrangement: true,
        localSummary: 'Added Chorus; Removed Verse 1',
        remoteSummary: 'Added Chorus',
      },
    },
  ]

  for (const row of rows) {
    it(row.name, () => {
      const result = mergeSet(
        makeSet('Demo Set', [song('A', row.base)]),
        makeSet('Demo Set', [song('A', row.local)]),
        makeSet('Demo Set', [song('A', row.remote)]),
      )
      if (row.clash) {
        expect(clashesOf(result)).toEqual([row.clash])
      } else {
        expect(mergedOf(result).songs).toEqual([song('A', row.expected)])
      }
    })
  }
})

describe('3.3 table: song order', () => {
  const base = makeSet('Demo Set', [song('A'), song('B'), song('C')])

  it('takes the order from the side that reordered', () => {
    const result = mergeSet(
      base,
      makeSet('Demo Set', [song('C'), song('A'), song('B')]),
      makeSet('Demo Set', [song('A'), song('B'), song('C')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['C', 'A', 'B'])
  })

  it('takes the order from the remote side when it reordered', () => {
    const result = mergeSet(
      base,
      makeSet('Demo Set', [song('A'), song('B'), song('C')]),
      makeSet('Demo Set', [song('C'), song('A'), song('B')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['C', 'A', 'B'])
  })

  it('accepts the same reorder on both sides', () => {
    const result = mergeSet(
      base,
      makeSet('Demo Set', [song('B'), song('A'), song('C')]),
      makeSet('Demo Set', [song('B'), song('A'), song('C')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['B', 'A', 'C'])
  })

  it('clashes when both sides reorder differently', () => {
    const result = mergeSet(
      base,
      makeSet('Demo Set', [song('B'), song('A'), song('C')]),
      makeSet('Demo Set', [song('C'), song('B'), song('A')]),
    )
    expect(clashesOf(result)).toEqual([
      {
        kind: 'order',
        localSummary: '1. Demo Song B\n2. Demo Song A\n3. Demo Song C',
        remoteSummary: '1. Demo Song C\n2. Demo Song B\n3. Demo Song A',
      },
    ])
  })

  it('places additions after the entry they follow on their side', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B'), song('C')]),
      makeSet('Demo Set', [song('A'), song('X'), song('B'), song('C')]),
      makeSet('Demo Set', [song('A'), song('B'), song('Y'), song('C')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['A', 'X', 'B', 'Y', 'C'])
  })

  it('places a leading addition first', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('X'), song('A'), song('B')]),
      makeSet('Demo Set', [song('A'), song('B')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['X', 'A', 'B'])
  })

  it('keeps a reordered addition with the side that reordered', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B'), song('C')]),
      makeSet('Demo Set', [song('B'), song('X'), song('A'), song('C')]),
      makeSet('Demo Set', [song('A'), song('B'), song('C')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['B', 'X', 'A', 'C'])
  })
})

describe('empty base (first sign-in, 3.6)', () => {
  it('merges identical sets and keeps the local createdAt', () => {
    const merged = mergedOf(
      mergeSet(null, makeSet('Demo Set', [song('A')], 100), makeSet('Demo Set', [song('A')], 200)),
    )
    expect(merged).toEqual(makeSet('Demo Set', [song('A')], 100))
  })

  it('keeps entries that exist on only one side', () => {
    const result = mergeSet(
      null,
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', [song('B')]),
    )
    expect(ids(mergedOf(result).songs).sort()).toEqual(['A', 'B'])
  })

  it('clashes on different names', () => {
    const result = mergeSet(
      null,
      makeSet('Local Set', [song('A')]),
      makeSet('Remote Set', [song('A')]),
    )
    expect(clashesOf(result)).toEqual([{ kind: 'name', local: 'Local Set', remote: 'Remote Set' }])
  })

  it('clashes on a field with different values on each side', () => {
    const result = mergeSet(
      null,
      makeSet('Demo Set', [song('A', { targetKey: 'G' })]),
      makeSet('Demo Set', [song('A', { targetKey: 'A' })]),
    )
    expect(clashesOf(result)).toEqual([fieldClash('targetKey', 'Demo Song A', 'G', 'A')])
  })

  it('clashes on different sections', () => {
    const result = mergeSet(
      null,
      makeSet('Demo Set', [song('A', { customSections: [verse], customFlow: [0] })]),
      makeSet('Demo Set', [song('A', { customSections: [chorus], customFlow: [0] })]),
    )
    expect(clashesOf(result)).toEqual([
      {
        kind: 'sections',
        entryId: 'A',
        title: 'Demo Song A',
        simplified: false,
        arrangement: true,
        localSummary: 'Added Verse 1; Removed Chorus',
        remoteSummary: 'Added Chorus; Removed Verse 1',
      },
    ])
  })

  it('clashes when the order of common entries differs', () => {
    const result = mergeSet(
      null,
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('B'), song('A')]),
    )
    expect(clashesOf(result)).toEqual([
      {
        kind: 'order',
        localSummary: '1. Demo Song A\n2. Demo Song B',
        remoteSummary: '1. Demo Song B\n2. Demo Song A',
      },
    ])
  })

  it('shows only affected positions for song order and pure section reorder clashes', () => {
    const orderResult = mergeSet(
      makeSet('Demo Set', [song('A'), song('B'), song('C'), song('D')]),
      makeSet('Demo Set', [song('A'), song('C'), song('B'), song('D')]),
      makeSet('Demo Set', [song('A'), song('B'), song('D'), song('C')]),
    )
    expect(clashDiff(clashesOf(orderResult)[0])).toEqual({
      label: 'Arrangement clash',
      local: '2. Demo Song C\n3. Demo Song B\n4. Demo Song D',
      remote: '2. Demo Song B\n3. Demo Song D\n4. Demo Song C',
    })

    const intro = { type: 'Intro' as const, label: 'Intro', lines: [] }
    const bridge = { type: 'Bridge' as const, label: 'Bridge', lines: [] }
    const all = [intro, verse, chorus, bridge]
    const sectionOrderResult = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', [song('A', { customSections: all, customFlow: [0, 2, 1, 3] })]),
      makeSet('Demo Set', [song('A', { customSections: all, customFlow: [0, 1, 2, 3] })]),
    )
    expect(clashDiff(clashesOf(sectionOrderResult)[0])).toEqual({
      label: 'Demo Song A · Section clash',
      local: '2. Chorus\n3. Verse 1',
      remote: '2. Verse 1\n3. Chorus',
    })
  })

  it('accepts the same order of common entries', () => {
    const result = mergeSet(
      null,
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('A'), song('B')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['A', 'B'])
  })
})

describe('inputs', () => {
  it('does not mutate its inputs on a clean merge', () => {
    const base = makeSet('Demo Set', [song('A', { customSections: [verse], customFlow: [0] })])
    const local = makeSet('Demo Set', [
      song('A', { targetKey: 'A', customSections: [chorus], customFlow: [0] }),
    ])
    const remote = makeSet('Demo Set', [song('A'), song('B')])
    const before = [structuredClone(base), structuredClone(local), structuredClone(remote)]

    mergeSet(base, local, remote)

    expect([base, local, remote]).toEqual(before)
  })

  it('does not mutate its inputs on a clash', () => {
    const base = makeSet('Demo Set', [song('A'), song('B')])
    const local = makeSet('Local Set', [song('A', { targetKey: 'A' }), song('B')])
    const remote = makeSet('Remote Set', [song('A', { targetKey: 'B' }), song('B')])
    const before = [structuredClone(base), structuredClone(local), structuredClone(remote)]

    mergeSet(base, local, remote)

    expect([base, local, remote]).toEqual(before)
  })
})

describe('nothing lost', () => {
  interface NothingLostCase {
    name: string
    base: SyncedSet | null
    local: SyncedSet
    remote: SyncedSet
  }

  const cases: NothingLostCase[] = [
    {
      name: 'name',
      base: makeSet('Demo Set', [song('A')]),
      local: makeSet('Local Set', [song('A')]),
      remote: makeSet('Remote Set', [song('A')]),
    },
    {
      name: 'field',
      base: makeSet('Demo Set', [song('A')]),
      local: makeSet('Demo Set', [song('A', { targetKey: 'A' })]),
      remote: makeSet('Demo Set', [song('A', { targetKey: 'B' })]),
    },
    {
      name: 'sections',
      base: makeSet('Demo Set', [song('A', { customSections: [verse], customFlow: [0] })]),
      local: makeSet('Demo Set', [song('A', { customSections: [chorus], customFlow: [0] })]),
      remote: makeSet('Demo Set', [
        song('A', { customSections: [verse, chorus], customFlow: [0, 1] }),
      ]),
    },
    {
      name: 'removed-edited',
      base: makeSet('Demo Set', [song('A'), song('B')]),
      local: makeSet('Demo Set', [song('B')]),
      remote: makeSet('Demo Set', [song('A', { targetKey: 'A' }), song('B')]),
    },
    {
      name: 'order',
      base: makeSet('Demo Set', [song('A'), song('B'), song('C')]),
      local: makeSet('Demo Set', [song('B'), song('A'), song('C')]),
      remote: makeSet('Demo Set', [song('C'), song('B'), song('A')]),
    },
    {
      name: 'empty base field',
      base: null,
      local: makeSet('Demo Set', [song('A', { targetKey: 'A' })]),
      remote: makeSet('Demo Set', [song('A', { targetKey: 'B' })]),
    },
  ]

  for (const item of cases) {
    it(`returns the exact local and remote sets on a ${item.name} clash`, () => {
      const localBefore = structuredClone(item.local)
      const remoteBefore = structuredClone(item.remote)

      const result = mergeSet(item.base, item.local, item.remote)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.local).toBe(item.local)
      expect(result.remote).toBe(item.remote)
      expect(result.local).toEqual(localBefore)
      expect(result.remote).toEqual(remoteBefore)
      expect(result.clashes.length).toBeGreaterThan(0)
    })
  }
})

describe('clashDiff', () => {
  it('formats name, field, sections, removed-edited, order, and chart diffs', () => {
    expect(clashDiff({ kind: 'name', local: 'Sunday AM', remote: 'Sunday PM' })).toEqual({
      label: 'Set name',
      local: 'Sunday AM',
      remote: 'Sunday PM',
    })
    expect(clashDiff(fieldClash('targetKey', 'Demo Song A', 'G', 'A'))).toEqual({
      label: 'Demo Song A · Chosen key',
      local: 'G',
      remote: 'A',
    })
    expect(clashDiff(fieldClash('pad', 'Demo Song A', 'D', 'match key'))).toEqual({
      label: 'Demo Song A · Pad key',
      local: 'D',
      remote: 'match key',
    })
    expect(clashDiff(fieldClash('simplified', 'Demo Song A', 'on', 'off'))).toEqual({
      label: 'Demo Song A · Simplified chords',
      local: 'on',
      remote: 'off',
    })
    expect(clashDiff(fieldClash('song'))).toEqual({
      label: 'Demo Song A · Chord chart',
      local: 'Updated chart',
      remote: 'Updated chart',
    })
    expect(
      clashDiff({
        kind: 'sections',
        entryId: 'A',
        title: 'Demo Song A',
        simplified: true,
        localSummary: 'Verse 1',
        remoteSummary: 'Chorus',
      }),
    ).toEqual({
      label: 'Demo Song A · Edited sections',
      local: 'Verse 1',
      remote: 'Chorus',
    })
    expect(
      clashDiff({ kind: 'sections', entryId: 'A', title: 'Demo Song A', simplified: false }),
    ).toEqual({
      label: 'Demo Song A · Edited sections',
      local: 'Edited',
      remote: 'Edited',
    })
    expect(
      clashDiff({
        kind: 'removed-edited',
        entryId: 'A',
        title: 'Demo Song A',
        removedOn: 'local',
      }),
    ).toEqual({ label: 'Demo Song A · Song in set', local: 'Removed', remote: 'Changed' })
    expect(
      clashDiff({
        kind: 'removed-edited',
        entryId: 'A',
        title: 'Demo Song A',
        removedOn: 'remote',
      }),
    ).toEqual({ label: 'Demo Song A · Song in set', local: 'Changed', remote: 'Removed' })
    expect(clashDiff({ kind: 'order' })).toEqual({
      label: 'Arrangement clash',
      local: 'Reordered',
      remote: 'Reordered',
    })
  })

  it('summarizes chord, lyric, flow, and reset differences inside edited sections', () => {
    const chordLocal = {
      type: 'Verse' as const,
      label: 'Verse 1',
      lines: [
        {
          kind: 'lyric' as const,
          text: 'Morning light',
          chords: [
            { pos: 0, chord: 'G' },
            { pos: 8, chord: 'D' },
          ],
        },
      ],
    }
    const chordRemote = {
      type: 'Verse' as const,
      label: 'Verse 1',
      lines: [
        {
          kind: 'lyric' as const,
          text: 'Morning light',
          chords: [
            { pos: 0, chord: 'A' },
            { pos: 8, chord: 'E' },
          ],
        },
      ],
    }
    const chordClash = clashesOf(
      mergeSet(
        makeSet('Demo Set', [song('A')]),
        makeSet('Demo Set', [song('A', { customSections: [chordLocal], customFlow: [0] })]),
        makeSet('Demo Set', [song('A', { customSections: [chordRemote], customFlow: [0] })]),
      ),
    )[0]
    expect(clashDiff(chordClash)).toEqual({
      label: 'Demo Song A · Edited sections',
      local: 'Verse 1: G, D',
      remote: 'Verse 1: A, E',
    })

    const lyricRemote = {
      type: 'Verse' as const,
      label: 'Verse 1',
      lines: [{ kind: 'lyric' as const, text: 'Evening shadow', chords: [{ pos: 0, chord: 'G' }] }],
    }
    const lyricClash = clashesOf(
      mergeSet(
        makeSet('Demo Set', [song('A')]),
        makeSet('Demo Set', [song('A', { customSections: [chordLocal], customFlow: [0] })]),
        makeSet('Demo Set', [song('A', { customSections: [lyricRemote], customFlow: [0] })]),
      ),
    )[0]
    expect(clashDiff(lyricClash)).toEqual({
      label: 'Demo Song A · Edited sections',
      local: 'Verse 1: "Morning light"',
      remote: 'Verse 1: "Evening shadow"',
    })

    const resetClash = clashesOf(
      mergeSet(
        makeSet('Demo Set', [song('A', { customSections: [verse], customFlow: [0] })]),
        makeSet('Demo Set', [song('A')]),
        makeSet('Demo Set', [song('A', { customSections: [verse, chorus], customFlow: [0, 1] })]),
      ),
    )[0]
    expect(clashDiff(resetClash)).toEqual({
      label: 'Demo Song A · Section clash',
      local: 'Original chart',
      remote: 'Added Chorus',
    })
  })

  it('summarizes removed sections on a simplified song without dumping the full flow', () => {
    const intro = { type: 'Intro' as const, label: 'Intro', lines: [] }
    const bridge = { type: 'Bridge' as const, label: 'Bridge', lines: [] }
    const allSections = [intro, verse, chorus, bridge]
    const clash = clashesOf(
      mergeSet(
        makeSet('Demo Set', [song('A', { simplified: true })]),
        makeSet('Demo Set', [
          song('A', {
            simplified: true,
            customSimplifiedSections: allSections,
            customSimplifiedFlow: [0, 1, 2],
          }),
        ]),
        makeSet('Demo Set', [
          song('A', {
            simplified: true,
            customSimplifiedSections: allSections,
            customSimplifiedFlow: [1, 2, 3],
          }),
        ]),
        new Map([['A', { simplifiedBaseLabels: ['Intro', 'Verse 1', 'Chorus', 'Bridge'] }]]),
      ),
    )[0]
    expect(clashDiff(clash)).toEqual({
      label: 'Demo Song A · Section clash',
      local: 'Removed Bridge',
      remote: 'Removed Intro',
    })
  })

  it('applies each side targetKey transpose when summarizing edited chord diffs', () => {
    const chordLocal = {
      type: 'Verse' as const,
      label: 'Verse 1',
      lines: [
        {
          kind: 'lyric' as const,
          text: 'Morning light',
          chords: [
            { pos: 0, chord: 'C' },
            { pos: 8, chord: 'G' },
          ],
        },
      ],
    }
    const chordRemote = {
      type: 'Verse' as const,
      label: 'Verse 1',
      lines: [
        {
          kind: 'lyric' as const,
          text: 'Morning light',
          chords: [
            { pos: 0, chord: 'C' },
            { pos: 8, chord: 'F' },
          ],
        },
      ],
    }
    const clash = clashesOf(
      mergeSet(
        makeSet('Demo Set', [song('A', { targetKey: 'D' })]),
        makeSet('Demo Set', [
          song('A', { targetKey: 'D', customSections: [chordLocal], customFlow: [0] }),
        ]),
        makeSet('Demo Set', [
          song('A', { targetKey: 'D', customSections: [chordRemote], customFlow: [0] }),
        ]),
        new Map([['A', { originalKey: 'C' }]]),
      ),
    )[0]
    expect(clashDiff(clash)).toEqual({
      label: 'Demo Song A · Edited sections',
      local: 'Verse 1: D, A',
      remote: 'Verse 1: D, G',
    })
  })

  it('shows chord-sheet section reorders even when customFlow keeps the same played order', () => {
    const bridge1 = {
      type: 'Bridge' as const,
      label: 'Bridge 1',
      lines: [{ kind: 'lyric' as const, text: 'I have to have You', chords: [] }],
    }
    const chorus1 = {
      type: 'Chorus' as const,
      label: 'Chorus 1',
      lines: [{ kind: 'lyric' as const, text: 'You can take the clothes', chords: [] }],
    }
    const clash = clashesOf(
      mergeSet(
        makeSet('Demo Set', [song('A')]),
        makeSet('Demo Set', [
          song('A', { customSections: [bridge1, chorus1], customFlow: [1, 0] }),
        ]),
        makeSet('Demo Set', [
          song('A', { customSections: [chorus1, bridge1], customFlow: [0, 1] }),
        ]),
      ),
    )[0]
    expect(clashDiff(clash)).toEqual({
      label: 'Demo Song A · Section clash',
      local: '1. Bridge 1\n2. Chorus 1',
      remote: '1. Chorus 1\n2. Bridge 1',
    })
  })

  it('normalizes default simplified and padKeyMode in sameSyncedSet', () => {
    const a = makeSet('Demo Set', [song('A', { simplified: undefined, padKeyMode: undefined })])
    const b = makeSet('Demo Set', [
      song('A', { simplified: false, padKeyMode: 'match', customPadKey: 'G' }),
    ])
    expect(sameSyncedSet(a, b)).toBe(true)
  })
})
