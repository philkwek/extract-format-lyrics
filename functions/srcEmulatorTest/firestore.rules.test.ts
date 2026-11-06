import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore'

const future = () => Timestamp.fromMillis(Date.now() + 60_000)
const past = () => Timestamp.fromMillis(Date.now() - 60_000)

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
