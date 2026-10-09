export interface SearchCandidate {
  site: string
  title: string
  artist: string
  url: string
  versionLabel?: string
  rating?: number
  type?: string
}

export interface SearchAdapter {
  site: string
  search(query: string): Promise<SearchCandidate[]>
}
