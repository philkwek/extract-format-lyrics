import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type {
  ChordPlacement,
  Line,
  Section,
  SectionType,
  SharedSetSnapshot,
  SharedSetSong,
  Song,
} from './types.js'

export const MAX_SHARED_SET_SONGS = 15
export const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const COLLECTION = 'sharedSets'

export type SharedSetLookup =
  | { kind: 'found'; snapshot: SharedSetSnapshot; expiresAt: Date }
  | { kind: 'expired' }
  | { kind: 'missing' }

function database(): Firestore {
  if (getApps().length === 0) initializeApp()
  return getFirestore()
}

const SECTION_TYPES: ReadonlySet<string> = new Set<SectionType>([
  'Intro',
  'Verse',
  'Pre-Chorus',
  'Chorus',
  'Bridge',
  'Outro',
  'Instrumental',
  'Other',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isSectionArray(value: unknown): value is Section[] {
  return Array.isArray(value) && value.every(isSection)
}

function isFlow(value: unknown, sectionCount: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (index) => Number.isSafeInteger(index) && index >= 0 && index < sectionCount
    )
  )
}

export function isChordPlacement(value: unknown): value is ChordPlacement {
  if (!isObject(value)) return false
  return (
    typeof value.pos === 'number' &&
    Number.isFinite(value.pos) &&
    typeof value.chord === 'string'
  )
}

export function isLine(value: unknown): value is Line {
  if (!isObject(value)) return false
  if (value.kind === 'lyric') {
    return (
      typeof value.text === 'string' &&
      Array.isArray(value.chords) &&
      value.chords.every(isChordPlacement) &&
      (value.splitFromPrevious === undefined || typeof value.splitFromPrevious === 'boolean')
    )
  }
  if (value.kind === 'chords-only') {
    return (
      Array.isArray(value.chords) &&
      value.chords.every((chord) => typeof chord === 'string')
    )
  }
  if (value.kind === 'tab') {
    return typeof value.raw === 'string'
  }
  return false
}

export function isSection(value: unknown): value is Section {
  if (!isObject(value)) return false
  return (
    typeof value.type === 'string' &&
    SECTION_TYPES.has(value.type) &&
    typeof value.label === 'string' &&
    Array.isArray(value.lines) &&
    value.lines.every(isLine)
  )
}

export function isSong(value: unknown): value is Song {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.artist === 'string' &&
    typeof value.sourceUrl === 'string' &&
    typeof value.sourceSite === 'string' &&
    (value.originalKey === null || typeof value.originalKey === 'string') &&
    (value.capo === undefined ||
      (typeof value.capo === 'number' && Number.isFinite(value.capo))) &&
    Array.isArray(value.sections) &&
    value.sections.every(isSection) &&
    (value.flow === undefined || isFlow(value.flow, value.sections.length)) &&
    (value.simplifiedSections === undefined || isSectionArray(value.simplifiedSections)) &&
    (value.simplifiedFlow === undefined ||
      (Array.isArray(value.simplifiedSections) &&
        isFlow(value.simplifiedFlow, value.simplifiedSections.length))) &&
    (value.simplifiedSource === undefined ||
      value.simplifiedSource === 'official' ||
      value.simplifiedSource === 'algorithmic') &&
    (value.simplificationPending === undefined ||
      typeof value.simplificationPending === 'boolean')
  )
}

export function isSharedSetSong(value: unknown): value is SharedSetSong {
  if (!isObject(value)) return false
  return (
    typeof value.entryId === 'string' &&
    value.entryId.length > 0 &&
    isSong(value.song) &&
    (value.customSections === undefined || isSectionArray(value.customSections)) &&
    (value.customFlow === undefined ||
      (Array.isArray(value.customSections) &&
        isFlow(value.customFlow, value.customSections.length))) &&
    (value.customSimplifiedSections === undefined ||
      isSectionArray(value.customSimplifiedSections)) &&
    (value.customSimplifiedFlow === undefined ||
      (Array.isArray(value.customSimplifiedSections) &&
        isFlow(value.customSimplifiedFlow, value.customSimplifiedSections.length))) &&
    (value.targetKey === undefined || typeof value.targetKey === 'string') &&
    (value.padKeyMode === undefined ||
      value.padKeyMode === 'match' ||
      value.padKeyMode === 'custom') &&
    (value.customPadKey === undefined || typeof value.customPadKey === 'string') &&
    (value.simplified === undefined || typeof value.simplified === 'boolean')
  )
}

export function isSharedSetSnapshot(value: unknown): value is SharedSetSnapshot {
  if (!isObject(value)) return false
  return (
    value.v === 2 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    Array.isArray(value.songs) &&
    value.songs.length > 0 &&
    value.songs.length <= MAX_SHARED_SET_SONGS &&
    value.songs.every(isSharedSetSong)
  )
}

export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return !expiresAt || expiresAt.getTime() <= now.getTime()
}

export class ShareStore {
  constructor(private readonly db: Firestore = database(), private readonly now: () => Date = () => new Date()) {}

  async create(snapshot: SharedSetSnapshot): Promise<{ id: string; expiresAt: Date }> {
    const createdAt = this.now()
    const expiresAt = new Date(createdAt.getTime() + SHARE_TTL_MS)
    const ref = this.db.collection(COLLECTION).doc()
    const batch = this.db.batch()
    batch.set(ref, {
      v: snapshot.v,
      name: snapshot.name,
      songCount: snapshot.songs.length,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
    })
    snapshot.songs.forEach((entry, index) => {
      batch.set(ref.collection('songs').doc(String(index).padStart(2, '0')), { index, entry })
    })
    await batch.commit()
    return { id: ref.id, expiresAt }
  }

  async get(id: string): Promise<SharedSetLookup> {
    const ref = this.db.collection(COLLECTION).doc(id)
    const root = await ref.get()
    if (!root.exists) return { kind: 'missing' }
    const data = root.data()
    const expiresAt = data?.expiresAt instanceof Timestamp ? data.expiresAt.toDate() : null
    if (isExpired(expiresAt, this.now())) return { kind: 'expired' }
    if (data?.v !== 2 || typeof data.name !== 'string' || !Number.isInteger(data.songCount)) return { kind: 'missing' }
    const songDocs = await ref.collection('songs').orderBy('index').get()
    const songs = songDocs.docs.map((doc) => doc.data().entry as SharedSetSong)
    const snapshot: SharedSetSnapshot = { v: 2, name: data.name, songs }
    return isSharedSetSnapshot(snapshot) && songs.length === data.songCount
      ? { kind: 'found', snapshot, expiresAt: expiresAt! }
      : { kind: 'missing' }
  }
}

export const shareStore = new ShareStore()
