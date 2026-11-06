import type { Session, SessionSongItem } from './sessionStore'

/** One thing the host changed, with the song it was about (by entryId or url). */
export interface HostChange {
  text: string
  songKey?: string
}

const keyOf = (item: SessionSongItem) => item.entryId || item.url
const named = (item: SessionSongItem) => `“${item.title || 'Untitled song'}”`
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Lists what changed between two versions of a live set, in plain words. */
export function describeHostChanges(before: Session, after: Session): HostChange[] {
  const changes: HostChange[] = []
  if (before.name !== after.name) changes.push({ text: `Renamed the set to “${after.name}”` })

  const old = new Map(before.songs.map((item) => [keyOf(item), item]))
  const kept = new Set(after.songs.map(keyOf))
  for (const item of after.songs) {
    const songKey = keyOf(item)
    const prev = old.get(songKey)
    const add = (text: string) => changes.push({ text, songKey })
    if (!prev) {
      add(`Added ${named(item)}`)
      continue
    }
    if (prev.targetKey !== item.targetKey) {
      add(
        item.targetKey
          ? `${named(item)} is now in ${item.targetKey}`
          : `${named(item)} is back in its original key`,
      )
    }
    if (
      !same(prev.customSections, item.customSections) ||
      !same(prev.customFlow, item.customFlow) ||
      !same(prev.customSimplifiedSections, item.customSimplifiedSections) ||
      !same(prev.customSimplifiedFlow, item.customSimplifiedFlow)
    ) {
      add(`Edited chords in ${named(item)}`)
    }
    if (Boolean(prev.simplified) !== Boolean(item.simplified)) {
      add(item.simplified ? `Simplified ${named(item)}` : `Showing full chords in ${named(item)}`)
    }
    if (prev.padKeyMode !== item.padKeyMode || prev.customPadKey !== item.customPadKey) {
      add(`Changed the pad in ${named(item)}`)
    }
  }
  for (const item of before.songs) {
    if (!kept.has(keyOf(item))) changes.push({ text: `Removed ${named(item)}` })
  }

  const orderBefore = before.songs.map(keyOf).filter((k) => kept.has(k))
  const orderAfter = after.songs.map(keyOf).filter((k) => old.has(k))
  if (!same(orderBefore, orderAfter)) changes.push({ text: 'Changed the song order' })
  return changes
}

/** Adds new changes to ones already on screen, without repeating a line. */
export function mergeHostChanges(shown: HostChange[], next: HostChange[]): HostChange[] {
  const texts = new Set(shown.map((c) => c.text))
  return [...shown, ...next.filter((c) => !texts.has(c.text))]
}

/** One short line for the notice: up to two changes in full, otherwise a count. */
export function summarizeHostChanges(changes: HostChange[]): HostChange | null {
  if (changes.length === 0) return null
  const songs = new Set(changes.flatMap((c) => (c.songKey ? [c.songKey] : [])))
  const songKey = songs.size === 1 && changes.every((c) => c.songKey) ? [...songs][0] : undefined
  if (changes.length <= 2) return { text: changes.map((c) => c.text).join('. '), songKey }
  return {
    text: songs.size > 1 ? `Updated ${songs.size} songs` : `Made ${changes.length} changes`,
    songKey,
  }
}
