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

export interface ShareSongItem {
  url: string
  title?: string
  artist?: string
  targetKey?: string
  simplified?: boolean
  customSections?: Section[]
  customSimplifiedSections?: Section[]
}

export interface SharePayload {
  v: 1
  name: string
  songs: ShareSongItem[]
}
