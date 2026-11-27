import type { Line } from '../types/song'
import type { SessionSongItem } from './sessionStore'
import { keyUsesFlats, parseKey, transposeChord } from './transpose'

export type SyncedEntry = SessionSongItem & { entryId: string; contentHash?: string }

export interface SyncedSongMeta {
  originalKey?: string
  baseLabels?: string[]
  simplifiedBaseLabels?: string[]
}

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
      arrangement?: boolean
      localSummary?: string
      remoteSummary?: string
    }
  | { kind: 'removed-edited'; entryId: string; title: string; removedOn: 'local' | 'remote' }
  | { kind: 'order'; localSummary?: string; remoteSummary?: string }

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

function flowLabels([sections, flow]: SectionsUnit): string[] {
  if (!sections) return []
  if (!flow) return sections.map((section) => section.label)
  return flow
    .map((index) => sections[index]?.label)
    .filter((label): label is string => Boolean(label))
}

function formatFlow(labels: string[]): string {
  if (labels.length === 0) return 'No sections'
  if (labels.length > 5) return `${labels.slice(0, 4).join(' → ')} → … (${labels.length} total)`
  return labels.join(' → ')
}

function clip(text: string, max = 32): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

function lineChords(line: Line): string[] {
  if (line.kind === 'lyric') return line.chords.map((item) => item.chord)
  if (line.kind === 'chords-only') return line.chords
  return []
}

function chordTransposer(
  originalKey: string | undefined,
  targetKey: string | undefined,
): (chord: string) => string {
  if (!originalKey || !targetKey || originalKey === targetKey) return (chord) => chord
  const orig = parseKey(originalKey)
  const target = parseKey(targetKey)
  if (!orig || !target) return (chord) => chord
  const shift = (((target.root - orig.root) % 12) + 12) % 12
  const useFlats = keyUsesFlats(targetKey)
  return (chord) => transposeChord(chord, shift, useFlats)
}

function describeLineSide(
  line: Line | undefined,
  other: Line | undefined,
  formatChord: (chord: string) => string,
): string {
  if (!line) return 'Line removed'
  if (!other || line.kind !== other.kind) {
    if (line.kind === 'lyric') {
      return line.text.trim()
        ? `"${clip(line.text)}"`
        : lineChords(line).slice(0, 5).map(formatChord).join(', ') || 'Edited line'
    }
    if (line.kind === 'chords-only') {
      return line.chords.slice(0, 5).map(formatChord).join(', ') || 'Chords line'
    }
    return clip(line.raw) || 'Tab line'
  }
  if (line.kind === 'lyric' && other.kind === 'lyric') {
    if (line.text !== other.text) return `"${clip(line.text)}"`
    return lineChords(line).slice(0, 5).map(formatChord).join(', ') || 'No chords'
  }
  if (line.kind === 'chords-only') {
    return line.chords.slice(0, 5).map(formatChord).join(', ') || 'No chords'
  }
  if (line.kind === 'tab') return clip(line.raw) || 'Tab edited'
  return 'Edited'
}

function labelCounts(labels: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return counts
}

function diffSectionLabels(reference: string[], side: string[]): string | undefined {
  const refCounts = labelCounts(reference)
  const sideCounts = labelCounts(side)
  const added: string[] = []
  const removed: string[] = []
  for (const [label, count] of sideCounts) {
    const diff = count - (refCounts.get(label) ?? 0)
    if (diff > 0) added.push(diff > 1 ? `${label} (×${diff})` : label)
  }
  for (const [label, count] of refCounts) {
    const diff = count - (sideCounts.get(label) ?? 0)
    if (diff > 0) removed.push(diff > 1 ? `${label} (×${diff})` : label)
  }
  const formatList = (items: string[]) =>
    items.length > 3 ? `${items.slice(0, 3).join(', ')}, …` : items.join(', ')
  const parts: string[] = []
  if (added.length > 0) parts.push(`Added ${formatList(added)}`)
  if (removed.length > 0) parts.push(`Removed ${formatList(removed)}`)
  if (parts.length > 0) return parts.join('; ')
  return deepEqual(reference, side) ? undefined : 'Reordered sections'
}

function formatOrderSlice(
  localList: string[],
  remoteList: string[],
): { localSummary: string; remoteSummary: string } {
  let start = 0
  while (
    start < localList.length &&
    start < remoteList.length &&
    localList[start] === remoteList[start]
  ) {
    start += 1
  }
  let localEnd = localList.length - 1
  let remoteEnd = remoteList.length - 1
  while (localEnd >= start && remoteEnd >= start && localList[localEnd] === remoteList[remoteEnd]) {
    localEnd -= 1
    remoteEnd -= 1
  }
  const formatRange = (list: string[], end: number) => {
    const slice = list.slice(start, end + 1)
    const lines = slice.slice(0, 6).map((item, idx) => `${start + idx + 1}. ${item}`)
    if (slice.length > 6) lines.push('…')
    return lines.join('\n')
  }
  return {
    localSummary: formatRange(localList, localEnd),
    remoteSummary: formatRange(remoteList, remoteEnd),
  }
}

function sameMultiset(a: string[], b: string[]): boolean {
  const aCounts = labelCounts(a)
  const bCounts = labelCounts(b)
  if (aCounts.size !== bCounts.size) return false
  for (const [label, count] of aCounts) {
    if (bCounts.get(label) !== count) return false
  }
  return true
}

function sectionLabels(sections: SyncedEntry['customSections']): string[] {
  return (sections ?? []).map((section) => section.label)
}

function summarizeFlowDiff(
  baseLabels: string[] | undefined,
  localLabels: string[],
  remoteLabels: string[],
): { localSummary: string; remoteSummary: string } {
  if (sameMultiset(localLabels, remoteLabels)) {
    return formatOrderSlice(localLabels, remoteLabels)
  }
  if (baseLabels && baseLabels.length > 0) {
    return {
      localSummary: diffSectionLabels(baseLabels, localLabels) ?? 'Unchanged arrangement',
      remoteSummary: diffSectionLabels(baseLabels, remoteLabels) ?? 'Unchanged arrangement',
    }
  }
  return {
    localSummary: diffSectionLabels(remoteLabels, localLabels) ?? formatFlow(localLabels),
    remoteSummary: diffSectionLabels(localLabels, remoteLabels) ?? formatFlow(remoteLabels),
  }
}

function summarizeSectionsClash(
  baseUnit: SectionsUnit,
  localUnit: SectionsUnit,
  remoteUnit: SectionsUnit,
  meta?: SyncedSongMeta,
  simplified = false,
  localTargetKey?: string,
  remoteTargetKey?: string,
): { arrangement?: boolean; localSummary?: string; remoteSummary?: string } {
  const [localSections] = localUnit
  const [remoteSections] = remoteUnit
  const refLabels = baseUnit[0]
    ? sectionLabels(baseUnit[0])
    : simplified
      ? meta?.simplifiedBaseLabels
      : meta?.baseLabels

  if (!localSections && remoteSections) {
    const remoteLabels = sectionLabels(remoteSections)
    return {
      arrangement: true,
      localSummary: 'Original chart',
      remoteSummary:
        (refLabels && diffSectionLabels(refLabels, remoteLabels)) ?? formatFlow(remoteLabels),
    }
  }
  if (localSections && !remoteSections) {
    const localLabels = sectionLabels(localSections)
    return {
      arrangement: true,
      localSummary:
        (refLabels && diffSectionLabels(refLabels, localLabels)) ?? formatFlow(localLabels),
      remoteSummary: 'Original chart',
    }
  }
  if (!localSections || !remoteSections) return {}

  const localSecLabels = sectionLabels(localSections)
  const remoteSecLabels = sectionLabels(remoteSections)
  if (!deepEqual(localSecLabels, remoteSecLabels)) {
    return { arrangement: true, ...summarizeFlowDiff(refLabels, localSecLabels, remoteSecLabels) }
  }

  const formatLocal = chordTransposer(meta?.originalKey, localTargetKey)
  const formatRemote = chordTransposer(meta?.originalKey, remoteTargetKey)
  const localParts: string[] = []
  const remoteParts: string[] = []
  let extra = 0
  const max = Math.max(localSections.length, remoteSections.length)
  for (let i = 0; i < max; i += 1) {
    const ls = localSections[i]
    const rs = remoteSections[i]
    if (deepEqual(ls, rs)) continue
    if (localParts.length >= 2) {
      extra += 1
      continue
    }
    const localLabel = ls?.label ?? `Section ${i + 1}`
    const remoteLabel = rs?.label ?? `Section ${i + 1}`
    if (!ls || !rs) {
      localParts.push(`${localLabel}: ${ls ? `${ls.lines.length} lines` : 'Removed'}`)
      remoteParts.push(`${remoteLabel}: ${rs ? `${rs.lines.length} lines` : 'Removed'}`)
      continue
    }
    const lineMax = Math.max(ls.lines.length, rs.lines.length)
    let found = false
    for (let j = 0; j < lineMax; j += 1) {
      if (deepEqual(ls.lines[j], rs.lines[j])) continue
      localParts.push(`${localLabel}: ${describeLineSide(ls.lines[j], rs.lines[j], formatLocal)}`)
      remoteParts.push(
        `${remoteLabel}: ${describeLineSide(rs.lines[j], ls.lines[j], formatRemote)}`,
      )
      found = true
      break
    }
    if (!found) {
      localParts.push(`${localLabel}: ${ls.lines.length} lines`)
      remoteParts.push(`${remoteLabel}: ${rs.lines.length} lines`)
    }
  }
  if (localParts.length > 0 && remoteParts.length > 0) {
    if (extra > 0) {
      localParts.push(`+${extra} more`)
      remoteParts.push(`+${extra} more`)
    }
    return { localSummary: localParts.join('\n'), remoteSummary: remoteParts.join('\n') }
  }

  const localFlowLabels = flowLabels(localUnit)
  const remoteFlowLabels = flowLabels(remoteUnit)
  if (!deepEqual(localFlowLabels, remoteFlowLabels)) {
    return {
      arrangement: true,
      ...summarizeFlowDiff(
        baseUnit[0] ? flowLabels(baseUnit) : refLabels,
        localFlowLabels,
        remoteFlowLabels,
      ),
    }
  }
  return {}
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
  meta?: SyncedSongMeta,
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
      const { arrangement, localSummary, remoteSummary } = summarizeSectionsClash(
        baseUnit,
        localUnit,
        remoteUnit,
        meta,
        simplified,
        local.targetKey,
        remote.targetKey,
      )
      clashes.push({
        kind: 'sections',
        entryId,
        title,
        simplified,
        ...(arrangement ? { arrangement: true } : {}),
        ...(localSummary && remoteSummary ? { localSummary, remoteSummary } : {}),
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

export function mergeSet(
  base: SyncedSet | null,
  local: SyncedSet,
  remote: SyncedSet,
  songMeta?: ReadonlyMap<string, SyncedSongMeta>,
): MergeResult {
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
        const merged = mergeEntry(undefined, localEntry, remoteEntry, songMeta?.get(entryId))
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

    const merged = mergeEntry(baseEntry, localEntry, remoteEntry, songMeta?.get(entryId))
    clashes.push(...merged.clashes)
    mergedEntries.set(entryId, merged.entry)
  }

  const commonOrder = mergedCommonOrder(base, local, remote)
  if (commonOrder === null) {
    clashes.push({
      kind: 'order',
      ...formatOrderSlice(
        local.songs.map((entry) => entry.title || 'a song'),
        remote.songs.map((entry) => entry.title || 'a song'),
      ),
    })
  }

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

export interface ClashDiff {
  label: string
  local: string
  remote: string
}

export function clashDiff(clash: Clash): ClashDiff {
  if (clash.kind === 'name') {
    return { label: 'Set name', local: clash.local, remote: clash.remote }
  }
  if (clash.kind === 'order') {
    return {
      label: 'Arrangement clash',
      local: clash.localSummary ?? 'Reordered',
      remote: clash.remoteSummary ?? 'Reordered',
    }
  }
  if (clash.kind === 'removed-edited') {
    return {
      label: `${clash.title} · Song in set`,
      local: clash.removedOn === 'local' ? 'Removed' : 'Changed',
      remote: clash.removedOn === 'remote' ? 'Removed' : 'Changed',
    }
  }
  if (clash.kind === 'sections') {
    return {
      label: `${clash.title} · ${clash.arrangement ? 'Section clash' : 'Edited sections'}`,
      local: clash.localSummary ?? 'Edited',
      remote: clash.remoteSummary ?? 'Edited',
    }
  }
  if (clash.field === 'targetKey') {
    return {
      label: `${clash.title} · Chosen key`,
      local: clash.local ?? 'original',
      remote: clash.remote ?? 'original',
    }
  }
  if (clash.field === 'pad') {
    return {
      label: `${clash.title} · Pad key`,
      local: clash.local ?? 'match key',
      remote: clash.remote ?? 'match key',
    }
  }
  if (clash.field === 'simplified') {
    return {
      label: `${clash.title} · Simplified chords`,
      local: clash.local ?? 'off',
      remote: clash.remote ?? 'off',
    }
  }
  return {
    label: `${clash.title} · Chord chart`,
    local: 'Updated chart',
    remote: 'Updated chart',
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
      return `${clash.title} sections${suffix}: ${clash.localSummary.replaceAll('\n', '; ')} on this device vs ${clash.remoteSummary.replaceAll('\n', '; ')} in the cloud.`
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
