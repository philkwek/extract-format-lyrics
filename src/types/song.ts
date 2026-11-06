export type {
  ChordPlacement,
  Line,
  Section,
  SectionType,
  Song,
  SharedSetSong,
  SharedSetSnapshot,
  SharedLyricsSection,
  SharedLyricsSong,
  SharedLyricsPayload,
  LiveSetEntry,
  LiveSetManifest,
  LiveSongContent,
} from '../../functions/src/types'


/** Per-song data kept on the server for a set link: source URL and set-level choices only. */
export interface SetLinkSong {
  entryId: string
  url: string
  title?: string
  artist?: string
  targetKey?: string
  simplified?: boolean
  padKeyMode?: 'match' | 'custom'
  customPadKey?: string
}

export interface SetLinkPayload {
  v: 1
  name: string
  songs: SetLinkSong[]
}

/** What a host sends for a live set manifest; the server adds status and rev. */
export type LiveSetManifestInput = Pick<
  import('../../functions/src/types').LiveSetManifest,
  'v' | 'name' | 'entries'
>
