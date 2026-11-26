import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createStore, del, get, set } from 'idb-keyval'
import type { SharedLyricsPayload, SharedLyricsSection } from '../types/song'

const EDITS_STORE_NAME = 'app_presenter_edits_db'
const EDITS_STORE_TABLE = 'edits'

export interface PresenterSongEdit {
  sections: SharedLyricsSection[]
}

export type PresenterEditsMap = Record<string, PresenterSongEdit>

export interface PresenterEditsStore {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, val: unknown) => Promise<void>
  del: (key: string) => Promise<void>
}

function createDefaultEditsStore(): PresenterEditsStore {
  if (typeof indexedDB !== 'undefined') {
    const customStore = createStore(EDITS_STORE_NAME, EDITS_STORE_TABLE)
    return {
      get: <T>(key: string) => get<T>(key, customStore),
      set: (key: string, val: unknown) => set(key, val, customStore),
      del: (key: string) => del(key, customStore),
    }
  }

  const memory = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => memory.get(key) as T | undefined,
    set: async (key: string, val: unknown) => {
      memory.set(key, val)
    },
    del: async (key: string) => {
      memory.delete(key)
    },
  }
}

let activeEditsStore: PresenterEditsStore = createDefaultEditsStore()

export function setPresenterEditsStoreForTesting(store: PresenterEditsStore): void {
  activeEditsStore = store
}

export function resetPresenterEditsStore(): void {
  activeEditsStore = createDefaultEditsStore()
}

function editsStorageKey(publicationId: string): string {
  return `presenter-edits:${publicationId}`
}

/** Splits textarea text into lyric lines, trimming trailing blank lines only. */
export function parseEditedLyricsText(text: string): string[] {
  const lines = text.split(/\r?\n/)
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop()
  }
  return lines
}

export function isSectionEdited(host: SharedLyricsSection, edited: SharedLyricsSection): boolean {
  if (host.label !== edited.label) return true
  if (host.lines.length !== edited.lines.length) return true
  return host.lines.some((line, index) => line !== edited.lines[index])
}

export function areSectionsEqual(
  hostSections: SharedLyricsSection[],
  editedSections: SharedLyricsSection[],
): boolean {
  if (hostSections.length !== editedSections.length) return false
  return hostSections.every((section, index) => !isSectionEdited(section, editedSections[index]))
}

export function applyPresenterEdits(
  lyrics: SharedLyricsPayload,
  edits: PresenterEditsMap,
): SharedLyricsPayload {
  const songs = lyrics.songs.map((song) => {
    const edit = edits[song.entryId]
    if (!edit) return song
    return {
      ...song,
      sections: edit.sections,
    }
  })
  return {
    ...lyrics,
    songs,
  }
}

function persistEdits(publicationId: string, next: PresenterEditsMap): void {
  const key = editsStorageKey(publicationId)
  if (Object.keys(next).length === 0) {
    void activeEditsStore.del(key)
  } else {
    void activeEditsStore.set(key, next)
  }
}

export function usePresenterEdits(publicationId: string) {
  const [state, setState] = useState<{ forId: string; map: PresenterEditsMap }>({
    forId: publicationId,
    map: {},
  })
  const edits = useMemo(
    () => (state.forId === publicationId ? state.map : {}),
    [state, publicationId],
  )
  const editsRef = useRef<PresenterEditsMap>(edits)

  useEffect(() => {
    editsRef.current = edits
  }, [edits])

  useEffect(() => {
    let cancelled = false
    void activeEditsStore.get<PresenterEditsMap>(editsStorageKey(publicationId)).then((stored) => {
      if (cancelled) return
      const next = stored ?? {}
      editsRef.current = next
      setState({ forId: publicationId, map: next })
    })
    return () => {
      cancelled = true
    }
  }, [publicationId])

  const commit = useCallback(
    (next: PresenterEditsMap) => {
      editsRef.current = next
      setState({ forId: publicationId, map: next })
      persistEdits(publicationId, next)
    },
    [publicationId],
  )

  const resetEdit = useCallback(
    (entryId: string) => {
      const next = { ...editsRef.current }
      delete next[entryId]
      commit(next)
    },
    [commit],
  )

  const saveEdit = useCallback(
    (entryId: string, sections: SharedLyricsSection[], hostSections?: SharedLyricsSection[]) => {
      if (hostSections && areSectionsEqual(hostSections, sections)) {
        resetEdit(entryId)
        return
      }
      commit({ ...editsRef.current, [entryId]: { sections } })
    },
    [commit, resetEdit],
  )

  const isEdited = useCallback((entryId: string) => Boolean(edits[entryId]), [edits])

  return { edits, saveEdit, resetEdit, isEdited }
}
