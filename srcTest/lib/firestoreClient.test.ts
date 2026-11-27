import { afterEach, describe, expect, it, vi } from 'vitest'
import { firebaseConfig } from '../../src/lib/firestoreClient'

afterEach(() => vi.unstubAllEnvs())

function stubProject(authDomain: string) {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'demo-key')
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'demo-app')
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-chords')
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', authDomain)
}

describe('firebaseConfig', () => {
  it('adds authDomain when the deploy sets one', () => {
    stubProject('setsandsheets.com')

    expect(firebaseConfig()).toEqual({
      apiKey: 'demo-key',
      appId: 'demo-app',
      projectId: 'demo-chords',
      authDomain: 'setsandsheets.com',
    })
  })

  it('leaves authDomain out when it is empty', () => {
    stubProject('')

    expect(firebaseConfig()).toEqual({
      apiKey: 'demo-key',
      appId: 'demo-app',
      projectId: 'demo-chords',
    })
  })

  it('returns null without the project identifiers', () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '')
    vi.stubEnv('VITE_FIREBASE_APP_ID', '')
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '')

    expect(firebaseConfig()).toBeNull()
  })
})
