import type { Song } from '../types/song'
import type { SessionSongItem } from './sessionStore'

export function identityFlow(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index)
}

/** Resolves the per-set flow override, falling back to identity for legacy full-flow sections. */
export function resolveSessionFlow(
  item: SessionSongItem,
  song: Song,
  isSimplified: boolean,
  sectionCount: number
): number[] {
  if (isSimplified) {
    return (
      item.customSimplifiedFlow ??
      (item.customSimplifiedSections
        ? identityFlow(sectionCount)
        : song.simplifiedFlow ?? identityFlow(sectionCount))
    )
  }
  return (
    item.customFlow ??
    (item.customSections ? identityFlow(sectionCount) : song.flow ?? identityFlow(sectionCount))
  )
}

/** Removes every reference to a deleted section and shifts later indices down. */
export function removeSectionFromFlow(flow: number[], removedIndex: number): number[] {
  return flow
    .filter((index) => index !== removedIndex)
    .map((index) => (index > removedIndex ? index - 1 : index))
}

/** Remaps flow indices after moving one unique section from `fromIndex` to `toIndex`. */
export function moveSectionInFlow(flow: number[], fromIndex: number, toIndex: number): number[] {
  if (fromIndex === toIndex) return flow
  return flow.map((index) => {
    if (index === fromIndex) return toIndex
    if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return index - 1
    if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return index + 1
    return index
  })
}
