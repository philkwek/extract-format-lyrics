import type { SessionSongItem } from './sessionStore'

export type SyncedEntry = SessionSongItem & { entryId: string; contentHash?: string }

export interface SyncedSet {
  name: string
  createdAt: number
  songs: SyncedEntry[]
}

export type Clash =
  | { kind: 'name'; local: string; remote: string }
  | {
      kind: 'field'
      entryId: string
      title: string
      field: 'targetKey' | 'pad' | 'simplified' | 'song'
      local?: string
      remote?: string
    }
  | {
      kind: 'sections'
      entryId: string
      title: string
      simplified: boolean
      localSummary?: string
      remoteSummary?: string
    }
  | { kind: 'removed-edited'; entryId: string; title: string; removedOn: 'local' | 'remote' }
  | { kind: 'order' }

export type MergeResult =
  | { ok: true; merged: SyncedSet }
  | { ok: false; clashes: Clash[]; local: SyncedSet; remote: SyncedSet }

type SimpleField = 'targetKey' | 'simplified'
type PadUnit = [SyncedEntry['padKeyMode'], SyncedEntry['customPadKey']]
type SongUnit = [string | undefined, string | undefined, string | undefined, string | undefined]
type SectionsUnit = [SyncedEntry['customSections'], SyncedEntry['customFlow']]

const SIMPLE_FIELDS: SimpleField[] = ['targetKey', 'simplified']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function definedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  if (!isRecord(a) || !isRecord(b) || Array.isArray(a) || Array.isArray(b)) return false
  const aKeys = definedKeys(a)
  const bKeys = definedKeys(b)
  return (
    aKeys.length === bKeys.length && aKeys.every((key) => key in b && deepEqual(a[key], b[key]))
  )
}

export function sameSyncedSet(a: SyncedSet, b: SyncedSet): boolean {
  return deepEqual(a, b)
}

function padUnit(entry: SyncedEntry | undefined): PadUnit {
  return [entry?.padKeyMode, entry?.customPadKey]
}

function songUnit(entry: SyncedEntry | undefined): SongUnit {
  return [entry?.url, entry?.title, entry?.artist, entry?.contentHash]
}

function sectionsUnit(entry: SyncedEntry | undefined, simplified: boolean): SectionsUnit {
  return simplified
    ? [entry?.customSimplifiedSections, entry?.customSimplifiedFlow]
    : [entry?.customSections, entry?.customFlow]
}

function formatPad(entry: SyncedEntry): string {
  return entry.padKeyMode === 'custom' ? (entry.customPadKey ?? 'custom') : 'match key'
}

function formatFieldValue(field: SimpleField, entry: SyncedEntry): string {
  if (field === 'targetKey') return entry.targetKey ?? 'original'
  return entry.simplified ? 'on' : 'off'
}

function changedSectionLabels(
  baseSections: SyncedEntry['customSections'],
  sideSections: SyncedEntry['customSections'],
): string | undefined {
  if (!baseSections || !sideSections) return undefined
  const labels: string[] = []
  const max = Math.max(baseSections.length, sideSections.length)
  for (let i = 0; i < max; i += 1) {
    if (deepEqual(baseSections[i], sideSections[i])) continue
    const label = sideSections[i]?.label ?? baseSections[i]?.label
    if (label && !labels.includes(label)) labels.push(label)
    if (labels.length === 3) break
  }
  return labels.length > 0 ? labels.join(', ') : undefined
}

function mergeValue<T>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  equals: (a: T | undefined, b: T | undefined) => boolean = Object.is,
): { value: T | undefined; clash: boolean } {
  const localChanged = !equals(local, base)
  const remoteChanged = !equals(remote, base)
  if (!localChanged) return { value: remote, clash: false }
  if (!remoteChanged) return { value: local, clash: false }
  return equals(local, remote) ? { value: local, clash: false } : { value: undefined, clash: true }
}

function sameEntry(a: SyncedEntry, b: SyncedEntry): boolean {
  return (
    SIMPLE_FIELDS.every((field) => Object.is(a[field], b[field])) &&
    deepEqual(padUnit(a), padUnit(b)) &&
    deepEqual(songUnit(a), songUnit(b)) &&
    deepEqual(sectionsUnit(a, false), sectionsUnit(b, false)) &&
    deepEqual(sectionsUnit(a, true), sectionsUnit(b, true))
  )
}

function titleOf(...entries: (SyncedEntry | undefined)[]): string {
  for (const entry of entries) {
    if (entry?.title) return entry.title
  }
  return 'a song'
}

function mergeEntry(
  base: SyncedEntry | undefined,
  local: SyncedEntry,
  remote: SyncedEntry,
): { entry: SyncedEntry; clashes: Clash[] } {
  const clashes: Clash[] = []
  const entryId = local.entryId
  const title = titleOf(local, remote, base)
  const result: SyncedEntry = { entryId, url: local.url }

  const fields = result as Record<SimpleField, unknown>
  for (const field of SIMPLE_FIELDS) {
    const merged = mergeValue<unknown>(base?.[field], local[field], remote[field])
    if (merged.clash) {
      clashes.push({
        kind: 'field',
        entryId,
        title,
        field,
        local: formatFieldValue(field, local),
        remote: formatFieldValue(field, remote),
      })
    } else if (merged.value !== undefined) {
      fields[field] = merged.value
    }
  }

  const pad = mergeValue(padUnit(base), padUnit(local), padUnit(remote), deepEqual)
  if (pad.clash) {
    clashes.push({
      kind: 'field',
      entryId,
      title,
      field: 'pad',
      local: formatPad(local),
      remote: formatPad(remote),
    })
  } else if (pad.value) {
    const [padKeyMode, customPadKey] = pad.value
    if (padKeyMode !== undefined) result.padKeyMode = padKeyMode
    if (customPadKey !== undefined) result.customPadKey = customPadKey
  }

  const song = mergeValue(songUnit(base), songUnit(local), songUnit(remote), deepEqual)
  if (song.clash) {
    clashes.push({ kind: 'field', entryId, title, field: 'song' })
  } else if (song.value) {
    const [url, songTitle, artist, contentHash] = song.value
    if (url !== undefined) result.url = url
    if (songTitle !== undefined) result.title = songTitle
    if (artist !== undefined) result.artist = artist
    if (contentHash !== undefined) result.contentHash = contentHash
  }

  for (const simplified of [false, true]) {
    const baseUnit = sectionsUnit(base, simplified)
    const localUnit = sectionsUnit(local, simplified)
    const remoteUnit = sectionsUnit(remote, simplified)
    const merged = mergeValue(baseUnit, localUnit, remoteUnit, deepEqual)
    if (merged.clash) {
      const localSummary = changedSectionLabels(baseUnit[0], localUnit[0])
      const remoteSummary = changedSectionLabels(baseUnit[0], remoteUnit[0])
      clashes.push({
        kind: 'sections',
        entryId,
        title,
        simplified,
        ...(localSummary && remoteSummary && localSummary !== remoteSummary
          ? { localSummary, remoteSummary }
          : {}),
      })
    } else if (merged.value) {
      const [sections, flow] = merged.value
      if (sections !== undefined) {
        result[simplified ? 'customSimplifiedSections' : 'customSections'] = sections
      }
      if (flow !== undefined) result[simplified ? 'customSimplifiedFlow' : 'customFlow'] = flow
    }
  }

  return { entry: result, clashes }
}

function byId(songs: SyncedEntry[]): Map<string, SyncedEntry> {
  const map = new Map<string, SyncedEntry>()
  for (const song of songs) map.set(song.entryId, song)
  return map
}

function idsOf(songs: SyncedEntry[]): string[] {
  return songs.map((song) => song.entryId)
}

function orderedIds(local: SyncedEntry[], remote: SyncedEntry[], base: SyncedEntry[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const song of [...local, ...remote, ...base]) {
    if (seen.has(song.entryId)) continue
    seen.add(song.entryId)
    ids.push(song.entryId)
  }
  return ids
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function mergedCommonOrder(
  base: SyncedSet | null,
  local: SyncedSet,
  remote: SyncedSet,
): string[] | null {
  const localIds = new Set(idsOf(local.songs))
  const remoteIds = new Set(idsOf(remote.songs))

  if (base === null) {
    const both = new Set(idsOf(remote.songs).filter((id) => localIds.has(id)))
    const localOrder = idsOf(local.songs).filter((id) => both.has(id))
    const remoteOrder = idsOf(remote.songs).filter((id) => both.has(id))
    return sameOrder(localOrder, remoteOrder) ? localOrder : null
  }

  const common = new Set(idsOf(base.songs).filter((id) => localIds.has(id) && remoteIds.has(id)))
  const baseOrder = idsOf(base.songs).filter((id) => common.has(id))
  const localOrder = idsOf(local.songs).filter((id) => common.has(id))
  const remoteOrder = idsOf(remote.songs).filter((id) => common.has(id))
  const localMoved = !sameOrder(localOrder, baseOrder)
  const remoteMoved = !sameOrder(remoteOrder, baseOrder)

  if (localMoved && remoteMoved) {
    return sameOrder(localOrder, remoteOrder) ? localOrder : null
  }
  if (localMoved) return localOrder
  if (remoteMoved) return remoteOrder
  return baseOrder
}

function insertAdditions(
  resultIds: string[],
  side: SyncedSet,
  merged: Map<string, SyncedEntry>,
): void {
  const placed = new Set(resultIds)
  for (let index = 0; index < side.songs.length; index += 1) {
    const { entryId } = side.songs[index]
    if (!merged.has(entryId) || placed.has(entryId)) continue

    let anchor: string | undefined
    for (let back = index - 1; back >= 0; back -= 1) {
      const candidate = side.songs[back].entryId
      if (placed.has(candidate)) {
        anchor = candidate
        break
      }
    }

    if (anchor === undefined) {
      resultIds.unshift(entryId)
    } else {
      resultIds.splice(resultIds.indexOf(anchor) + 1, 0, entryId)
    }
    placed.add(entryId)
  }
}

export function mergeSet(base: SyncedSet | null, local: SyncedSet, remote: SyncedSet): MergeResult {
  const clashes: Clash[] = []

  const name = mergeValue(base?.name, local.name, remote.name)
  if (name.clash) clashes.push({ kind: 'name', local: local.name, remote: remote.name })

  const baseById = byId(base?.songs ?? [])
  const localById = byId(local.songs)
  const remoteById = byId(remote.songs)
  const mergedEntries = new Map<string, SyncedEntry>()

  for (const entryId of orderedIds(local.songs, remote.songs, base?.songs ?? [])) {
    const baseEntry = baseById.get(entryId)
    const localEntry = localById.get(entryId)
    const remoteEntry = remoteById.get(entryId)

    if (!localEntry && !remoteEntry) continue

    if (!baseEntry) {
      if (localEntry && remoteEntry) {
        const merged = mergeEntry(undefined, localEntry, remoteEntry)
        clashes.push(...merged.clashes)
        mergedEntries.set(entryId, merged.entry)
      } else {
        const kept = localEntry ?? remoteEntry
        if (kept) mergedEntries.set(entryId, { ...kept })
      }
      continue
    }

    if (!localEntry || !remoteEntry) {
      const remaining = localEntry ?? remoteEntry
      if (remaining && !sameEntry(remaining, baseEntry)) {
        clashes.push({
          kind: 'removed-edited',
          entryId,
          title: titleOf(remaining),
          removedOn: !localEntry ? 'local' : 'remote',
        })
      }
      continue
    }

    const merged = mergeEntry(baseEntry, localEntry, remoteEntry)
    clashes.push(...merged.clashes)
    mergedEntries.set(entryId, merged.entry)
  }

  const commonOrder = mergedCommonOrder(base, local, remote)
  if (commonOrder === null) clashes.push({ kind: 'order' })

  if (clashes.length > 0) {
    return { ok: false, clashes, local, remote }
  }

  const resultIds = [...(commonOrder ?? [])]
  insertAdditions(resultIds, local, mergedEntries)
  insertAdditions(resultIds, remote, mergedEntries)
  for (const entryId of mergedEntries.keys()) {
    if (!resultIds.includes(entryId)) resultIds.push(entryId)
  }

  const songs: SyncedEntry[] = []
  for (const entryId of resultIds) {
    const entry = mergedEntries.get(entryId)
    if (entry) songs.push(entry)
  }

  return {
    ok: true,
    merged: {
      name: name.value ?? local.name,
      createdAt: local.createdAt,
      songs,
    },
  }
}

export function describeClash(clash: Clash): string {
  if (clash.kind === 'name') {
    return `Set name: "${clash.local}" on this device vs "${clash.remote}" in the cloud.`
  }
  if (clash.kind === 'order') return 'Both this device and the cloud changed the song order.'
  if (clash.kind === 'removed-edited') {
    return clash.removedOn === 'local'
      ? `${clash.title} was removed on this device, but changed in the cloud.`
      : `${clash.title} was changed on this device, but removed in the cloud.`
  }
  if (clash.kind === 'sections') {
    const suffix = clash.simplified ? ' (simplified)' : ''
    if (clash.localSummary && clash.remoteSummary && clash.localSummary !== clash.remoteSummary) {
      return `${clash.title} sections${suffix}: ${clash.localSummary} on this device vs ${clash.remoteSummary} in the cloud.`
    }
    return `Both this device and the cloud edited the sections of ${clash.title}${suffix}.`
  }
  if (clash.field === 'targetKey') {
    return `${clash.title} key: ${clash.local ?? 'original'} on this device vs ${
      clash.remote ?? 'original'
    } in the cloud.`
  }
  if (clash.field === 'pad') {
    return `${clash.title} pad: ${clash.local ?? 'match key'} on this device vs ${
      clash.remote ?? 'match key'
    } in the cloud.`
  }
  if (clash.field === 'simplified') {
    return `${clash.title} simplified chords: ${clash.local ?? 'off'} on this device vs ${
      clash.remote ?? 'off'
    } in the cloud.`
  }
  return `Both this device and the cloud updated the chart for ${clash.title}.`
}
