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
