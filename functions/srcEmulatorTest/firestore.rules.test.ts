import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'

const future = () => Timestamp.fromMillis(Date.now() + 60_000)
const past = () => Timestamp.fromMillis(Date.now() - 60_000)

const demoSet = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  rev: 1,
  data: JSON.stringify({ name: 'Sunday practice', createdAt: 1, songs: [] }),
  songCount: 0,
  updatedAt: 1,
  serverUpdatedAt: serverTimestamp(),
  ...overrides,
})

const demoMeta = (setCount: number, lastSetId: string) => ({ setCount, lastSetId })

async function seedAccountSet(
  uid: string,
  setId: string,
  setCount: number,
  overrides: Record<string, unknown> = {},
) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', uid), demoMeta(setCount, setId))
    await setDoc(doc(db, 'users', uid, 'sets', setId), {
      v: 1,
      rev: 1,
      data: JSON.stringify({ name: 'Sunday practice', createdAt: 1, songs: [] }),
      songCount: 0,
      updatedAt: 1,
      serverUpdatedAt: Timestamp.now(),
      ...overrides,
    })
  })
}

async function seedMeta(uid: string, setCount: number, lastSetId: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), demoMeta(setCount, lastSetId))
  })
}

function createLiveSetBatch(
  db: Firestore,
  uid: string,
  setId: string,
  setCount: number,
  overrides: Record<string, unknown> = {},
) {
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', uid), demoMeta(setCount, setId))
  batch.set(doc(db, 'users', uid, 'sets', setId), demoSet(overrides))
  return batch
}

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-chords-rules',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  })
})

afterAll(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'liveSets/fresh'), { expiresAt: future() })
    await setDoc(doc(db, 'liveSets/old'), { expiresAt: past() })
    await setDoc(doc(db, 'liveSetSongs/fresh_a'), { expiresAt: future() })
    await setDoc(doc(db, 'liveSetSongs/old_a'), { expiresAt: past() })
    await setDoc(doc(db, 'sharedSets/one'), { expiresAt: future() })
    await setDoc(doc(db, 'setLinks/one'), { expiresAt: future() })
    await setDoc(doc(db, 'sharedLyrics/fresh'), { expiresAt: future() })
    await setDoc(doc(db, 'sharedLyrics/old'), { expiresAt: past() })
  })
})

describe('lyrics share rules', () => {
  it('lets anyone get an unexpired doc, not an expired one', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertSucceeds(getDoc(doc(db, 'sharedLyrics/fresh')))
    await assertFails(getDoc(doc(db, 'sharedLyrics/old')))
  })

  it('denies list, create, update and delete', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDocs(collection(db, 'sharedLyrics')))
    await assertFails(setDoc(doc(db, 'sharedLyrics/new'), { expiresAt: future() }))
    await assertFails(updateDoc(doc(db, 'sharedLyrics/fresh'), { expiresAt: future() }))
    await assertFails(deleteDoc(doc(db, 'sharedLyrics/fresh')))
  })
})

describe('live share rules', () => {
  for (const [name, fresh, old] of [
    ['liveSets', 'fresh', 'old'],
    ['liveSetSongs', 'fresh_a', 'old_a'],
  ]) {
    it(`${name}: lets anyone get an unexpired doc, not an expired one`, async () => {
      const db = env.unauthenticatedContext().firestore()
      await assertSucceeds(getDoc(doc(db, name, fresh)))
      await assertFails(getDoc(doc(db, name, old)))
    })

    it(`${name}: denies list, create, update and delete`, async () => {
      const db = env.unauthenticatedContext().firestore()
      await assertFails(getDocs(collection(db, name)))
      await assertFails(setDoc(doc(db, name, 'new'), { expiresAt: future() }))
      await assertFails(updateDoc(doc(db, name, fresh), { expiresAt: future() }))
    })
  }
})

describe('everything else', () => {
  it('denies browser reads and writes on shares and caches', async () => {
    const db = env.authenticatedContext('someone').firestore()
    for (const path of ['sharedSets/one', 'setLinks/one', 'sourceCharts/x', 'searchCache/x']) {
      await assertFails(getDoc(doc(db, path)))
      await assertFails(setDoc(doc(db, path), { a: 1 }))
    }
  })
})

describe('account storage rules', () => {
  const dbFor = (uid: string) => env.authenticatedContext(uid).firestore()

  it('lets the owner create a set and meta in one batch, then read and list them', async () => {
    const db = dbFor('alice')
    await assertSucceeds(createLiveSetBatch(db, 'alice', 'set1', 1).commit())
    await assertSucceeds(getDoc(doc(db, 'users/alice')))
    await assertSucceeds(getDoc(doc(db, 'users/alice/sets/set1')))
    await assertSucceeds(getDocs(collection(db, 'users/alice/sets')))
  })

  it('denies another signed-in user', async () => {
    const alice = dbFor('alice')
    await assertSucceeds(createLiveSetBatch(alice, 'alice', 'set1', 1).commit())

    const bob = dbFor('bob')
    await assertFails(getDoc(doc(bob, 'users/alice')))
    await assertFails(getDoc(doc(bob, 'users/alice/sets/set1')))
    await assertFails(getDocs(collection(bob, 'users/alice/sets')))
    await assertFails(
      setDoc(doc(bob, 'users/alice/songs/hash1'), { v: 1, data: '{}', createdAt: 1 }),
    )
  })

  it('denies signed-out clients', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'users/alice')))
    await assertFails(setDoc(doc(db, 'users/alice/sets/set1'), demoSet()))
    await assertFails(
      setDoc(doc(db, 'users/alice/songs/hash1'), { v: 1, data: '{}', createdAt: 1 }),
    )
  })

  it('denies a stale rev', async () => {
    await seedAccountSet('alice', 'set1', 1)
    const db = dbFor('alice')
    await assertFails(
      updateDoc(doc(db, 'users/alice/sets/set1'), { rev: 1, serverUpdatedAt: serverTimestamp() }),
    )
  })

  it('denies rev + 2', async () => {
    await seedAccountSet('alice', 'set1', 1)
    const db = dbFor('alice')
    await assertFails(
      updateDoc(doc(db, 'users/alice/sets/set1'), { rev: 3, serverUpdatedAt: serverTimestamp() }),
    )
  })

  it('allows a valid edit with no meta change', async () => {
    await seedAccountSet('alice', 'set1', 1)
    const db = dbFor('alice')
    await assertSucceeds(
      updateDoc(doc(db, 'users/alice/sets/set1'), {
        rev: 2,
        updatedAt: 2,
        serverUpdatedAt: serverTimestamp(),
      }),
    )
  })

  it('denies a tombstone without the meta decrease', async () => {
    await seedAccountSet('alice', 'set1', 1)
    const db = dbFor('alice')
    await assertFails(
      updateDoc(doc(db, 'users/alice/sets/set1'), {
        rev: 2,
        deletedAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
      }),
    )
  })

  it('allows a tombstone with the meta decrease', async () => {
    await seedAccountSet('alice', 'set1', 1)
    const db = dbFor('alice')
    const batch = writeBatch(db)
    batch.update(doc(db, 'users/alice/sets/set1'), {
      rev: 2,
      deletedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    })
    batch.update(doc(db, 'users/alice'), demoMeta(0, 'set1'))
    await assertSucceeds(batch.commit())
  })

  it('allows a restore with the meta increase', async () => {
    await seedAccountSet('alice', 'set1', 0, { deletedAt: Timestamp.now() })
    const db = dbFor('alice')
    const batch = writeBatch(db)
    batch.update(doc(db, 'users/alice/sets/set1'), {
      rev: 2,
      deletedAt: null,
      serverUpdatedAt: serverTimestamp(),
    })
    batch.update(doc(db, 'users/alice'), demoMeta(1, 'set1'))
    await assertSucceeds(batch.commit())
  })

  it('denies the 101st live set', async () => {
    await seedMeta('alice', 100, 'set100')
    const db = dbFor('alice')
    await assertFails(createLiveSetBatch(db, 'alice', 'set101', 101).commit())
  })

  it('denies a set with 31 songs', async () => {
    const db = dbFor('alice')
    await assertFails(createLiveSetBatch(db, 'alice', 'set1', 1, { songCount: 31 }).commit())
  })

  it('denies set data over 500000 characters', async () => {
    const db = dbFor('alice')
    await assertFails(
      createLiveSetBatch(db, 'alice', 'set1', 1, { data: 'x'.repeat(500_001) }).commit(),
    )
  })

  it('denies a set create without the meta change', async () => {
    const db = dbFor('alice')
    await assertFails(setDoc(doc(db, 'users/alice/sets/set1'), demoSet()))
  })

  it('denies lowering setCount without a matching tombstone', async () => {
    await seedAccountSet('alice', 'set1', 1)
    const db = dbFor('alice')
    await assertFails(updateDoc(doc(db, 'users/alice'), demoMeta(0, 'set1')))
  })

  it('allows a song create', async () => {
    const db = dbFor('alice')
    await assertSucceeds(
      setDoc(doc(db, 'users/alice/songs/hash1'), { v: 1, data: '{"title":"Demo"}', createdAt: 1 }),
    )
  })

  it('denies a song update', async () => {
    const db = dbFor('alice')
    const song = doc(db, 'users/alice/songs/hash1')
    await assertSucceeds(setDoc(song, { v: 1, data: '{"title":"Demo"}', createdAt: 1 }))
    await assertFails(updateDoc(song, { data: '{"title":"Changed"}' }))
  })

  it('denies song data over 200000 characters', async () => {
    const db = dbFor('alice')
    await assertFails(
      setDoc(doc(db, 'users/alice/songs/big'), {
        v: 1,
        data: 'x'.repeat(200_001),
        createdAt: 1,
      }),
    )
  })

  it('allows a song delete', async () => {
    const db = dbFor('alice')
    const song = doc(db, 'users/alice/songs/hash1')
    await assertSucceeds(setDoc(song, { v: 1, data: '{"title":"Demo"}', createdAt: 1 }))
    await assertSucceeds(deleteDoc(song))
  })
})
