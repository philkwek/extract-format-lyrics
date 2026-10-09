export interface RawSong {
  title: string
  artist: string
  originalKey: string | null
  capo?: number
  content: string
}

export interface SiteAdapter {
  site: string
  matches(url: string): boolean
  extract(html: string, url: string): RawSong
}
