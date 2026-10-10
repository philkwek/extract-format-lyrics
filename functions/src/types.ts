/** Shared song data model (used by Cloud Functions and re-exported to the frontend). */

export type SectionType =
  | 'Intro'
  | 'Verse'
  | 'Pre-Chorus'
  | 'Chorus'
  | 'Bridge'
  | 'Outro'
  | 'Instrumental'
  | 'Other'

export interface ChordPlacement {
  /** Character offset in the lyric text where the chord sits above. */
  pos: number
  chord: string
}

export type Line =
  | { kind: 'lyric'; text: string; chords: ChordPlacement[] }
  | { kind: 'chords-only'; chords: string[] }
  /** Tab / other preformatted text: rendered monospace, never transposed. */
  | { kind: 'tab'; raw: string }

export interface Section {
  type: SectionType
  /** Label as scraped, e.g. "Verse 2". */
  label: string
  lines: Line[]
}

export interface Song {
  id: string
  title: string
  artist: string
  sourceUrl: string
  sourceSite: string
  /** Key as scraped, e.g. "G" or "Am". Null if it could not be determined. */
  originalKey: string | null
  capo?: number
  sections: Section[]
  /** Optional simplified version if supported by source (e.g. Ultimate Guitar). */
  simplifiedSections?: Section[]
}

/** A song plus all per-set state needed to reproduce a shared set exactly. */
export interface SharedSetSong {
  /** Stable ID for this occurrence; the same source song may appear twice in one set. */
  entryId: string
  song: Song
  customSections?: Section[]
  customSimplifiedSections?: Section[]
  targetKey?: string
  simplified?: boolean
}

/** Immutable, server-stored share format. */
export interface SharedSetSnapshot {
  v: 2
  name: string
  songs: SharedSetSong[]
}
