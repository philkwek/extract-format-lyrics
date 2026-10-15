import { describe, expect, it, beforeEach } from 'vitest'
import {
  deriveLyricsPublicationId,
  generateUpdateSecret,
  getLyricsPublicationIdentity,
  getOrCreateLyricsPublicationIdentity,
  publishLyricsForSession,
  recordLyricsPublicationSuccess,
  withLyricsPublicationLock,
  deleteLyricsPublicationIdentity,
} from './lyricsPublishIdentity'
import type { SharedLyricsPayload } from '../types/song'

const mockPayload: SharedLyricsPayload = {
  v: 1,
  name: 'Test Set',
  songs: [
    {
      entryId: 'e1',
      title: 'Test Song',
      sections: [{ label: 'Verse 1', lines: ['Hello world'] }],
    },
  ],
}

describe('lyrics publication identity and persistence', () => {
  beforeEach(async () => {
    // Clean up test sessions
    await deleteLyricsPublicationIdentity('test-session-1')
    await deleteLyricsPublicationIdentity('test-session-2')
    await deleteLyricsPublicationIdentity('test-session-concurrent')
    await deleteLyricsPublicationIdentity('test-session-fail')
    await deleteLyricsPublicationIdentity('test-session-renew')
  })

  it('generates random secrets and derives matching publication ID', async () => {
    const secret = generateUpdateSecret()
    expect(secret).toHaveLength(64)
    const pubId = await deriveLyricsPublicationId(secret)
    expect(pubId).toHaveLength(64)
    // Deterministic derivation
    const pubId2 = await deriveLyricsPublicationId(secret)
    expect(pubId2).toBe(pubId)
  })

  it('reuses identity across multiple calls and reloads', async () => {
    const id1 = await getOrCreateLyricsPublicationIdentity('test-session-1')
    expect(id1.sessionId).toBe('test-session-1')
    expect(id1.publicationId).toBeTruthy()
    expect(id1.updateSecret).toBeTruthy()
    expect(id1.expiresAt).toBeUndefined()

    // Second call must return identical record
    const id2 = await getOrCreateLyricsPublicationIdentity('test-session-1')
    expect(id2.publicationId).toBe(id1.publicationId)
    expect(id2.updateSecret).toBe(id1.updateSecret)

    // Direct lookup returns same
    const stored = await getLyricsPublicationIdentity('test-session-1')
    expect(stored).toEqual(id1)
  })

  it('handles concurrent initial generation safely without race conditions', async () => {
    const [result1, result2] = await Promise.all([
      withLyricsPublicationLock('test-session-concurrent', () =>
        getOrCreateLyricsPublicationIdentity('test-session-concurrent')
      ),
      withLyricsPublicationLock('test-session-concurrent', () =>
        getOrCreateLyricsPublicationIdentity('test-session-concurrent')
      ),
    ])

    expect(result1.publicationId).toBe(result2.publicationId)
    expect(result1.updateSecret).toBe(result2.updateSecret)
  })

  it('retains identity and avoids updating expiry when API request fails', async () => {
    let callCount = 0
    const failingPublisher = async () => {
      callCount++
      throw new Error('Network timeout during publication')
    }

    await expect(
      publishLyricsForSession('test-session-fail', mockPayload, failingPublisher)
    ).rejects.toThrow('Network timeout during publication')

    expect(callCount).toBe(1)

    // Identity was created and persisted before the network call
    const stored = await getLyricsPublicationIdentity('test-session-fail')
    expect(stored).not.toBeNull()
    expect(stored?.publicationId).toBeTruthy()
    // Expiry was not persisted
    expect(stored?.expiresAt).toBeUndefined()
  })

  it('updates expiry on success and permits renewing expired links at the exact same URL', async () => {
    const pubIdUsed: string[] = []
    const secretsUsed: string[] = []

    const mockPublisher = async (id: string, secret: string) => {
      pubIdUsed.push(id)
      secretsUsed.push(secret)
      return { id, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }
    }

    // First publish
    const result1 = await publishLyricsForSession('test-session-renew', mockPayload, mockPublisher)
    expect(result1.id).toBe(pubIdUsed[0])
    expect(result1.shareUrl).toContain(`/lyrics/${result1.id}`)
    expect(result1.shareUrl).not.toContain(secretsUsed[0]) // Secret never leaked in URL!

    const stored1 = await getLyricsPublicationIdentity('test-session-renew')
    expect(stored1?.expiresAt).toBe(result1.expiresAt)

    // Simulate link expiration and re-publishing later
    const futureExpiry = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString()
    const renewingPublisher = async (id: string, secret: string) => {
      pubIdUsed.push(id)
      secretsUsed.push(secret)
      return { id, expiresAt: futureExpiry }
    }

    const result2 = await publishLyricsForSession('test-session-renew', mockPayload, renewingPublisher)
    // URL and publication ID are preserved
    expect(result2.id).toBe(result1.id)
    expect(result2.shareUrl).toBe(result1.shareUrl)
    expect(pubIdUsed[1]).toBe(pubIdUsed[0])
    expect(secretsUsed[1]).toBe(secretsUsed[0])

    // Expiry is updated to fresh timestamp
    const stored2 = await getLyricsPublicationIdentity('test-session-renew')
    expect(stored2?.expiresAt).toBe(futureExpiry)
  })

  it('provides distinct identities for different local sessions', async () => {
    const idA = await getOrCreateLyricsPublicationIdentity('test-session-1')
    const idB = await getOrCreateLyricsPublicationIdentity('test-session-2')

    expect(idA.publicationId).not.toBe(idB.publicationId)
    expect(idA.updateSecret).not.toBe(idB.updateSecret)
  })
})
