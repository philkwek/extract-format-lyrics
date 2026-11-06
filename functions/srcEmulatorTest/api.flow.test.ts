import { beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import { clearEmulatorData } from './emulatorDb.js'
import { api } from '../src/index.js'
import { deriveLiveSetId, hashLiveSongContent } from '../src/liveSetStore.js'
import { derivePublicId } from '../src/setLinkStore.js'
import { derivePublicationId } from '../src/sharedLyricsStore.js'
import type { Song } from '../src/types.js'

type Json = {
  id?: string
  rev?: number
  manifest?: { status?: string }
  snapshot?: { songs: { song: { title: string } }[] }
}

let ip = 0
async function call(method: string, path: string, opts: { body?: unknown; secret?: string } = {}) {
  let status = 200
  let json: Json = {}
  const res = {
    setHeader: vi.fn(),
    status: vi.fn((code: number) => {
      status = code
      return res
    }),
    json: vi.fn((value: unknown) => {
      json = value as Json
    }),
  }
  const req = {
    method,
    path,
    headers: {
      'x-forwarded-for': `198.51.100.${(ip++ % 250) + 1}`,
      ...(opts.secret ? { authorization: `Bearer ${opts.secret}` } : {}),
    },
    body: opts.body,
  }
  await api(req as unknown as Request, res as unknown as Response)
  return { status, json }
}

const song: Song = {
  id: 's1',
  title: 'Demo',
  artist: 'Nobody',
  sourceUrl: 'https://tabs.example.com/demo',
  sourceSite: 'example',
  originalKey: 'G',
  sections: [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [{ kind: 'lyric', text: 'la la', chords: [{ pos: 0, chord: 'G' }] }],
    },
  ],
  flow: [0],
}

beforeEach(clearEmulatorData)

describe('sharing endpoints on the emulator', () => {
  it('shares a set and fetches it by id', async () => {
    const snapshot = { v: 2, name: 'Sunday', songs: [{ entryId: 'e1', song }] }
    const created = await call('POST', '/api/share', { body: { snapshot } })
    expect(created.status).toBe(201)

    const fetched = await call('GET', `/api/share/${created.json.id}`)
    expect(fetched.status).toBe(200)
    expect(fetched.json.snapshot!.songs[0].song.title).toBe('Demo')

    expect((await call('GET', '/api/share/missing')).status).toBe(404)
  })

  it('publishes lyrics with a secret and fetches them', async () => {
    const secret = crypto.randomBytes(32).toString('hex')
    const id = derivePublicationId(secret)
    const payload = {
      v: 1,
      name: 'Sunday',
      songs: [{ entryId: 'e1', title: 'One', sections: [{ label: 'Verse 1', lines: ['la la'] }] }],
    }
    expect((await call('PUT', `/api/lyrics-share/${id}`, { body: { payload } })).status).toBe(401)
    const put = await call('PUT', `/api/lyrics-share/${id}`, { body: { payload }, secret })
    expect(put.status).toBe(200)
    const got = await call('GET', `/api/lyrics-share/${id}`)
    expect(got.status).toBe(200)
    expect(JSON.stringify(got.json)).toContain('la la')
  })

  it('publishes a set link with a secret and fetches it', async () => {
    const secret = crypto.randomBytes(32).toString('hex')
    const id = derivePublicId(secret)
    const payload = { v: 1, name: 'Sunday', songs: [{ entryId: 'e1', url: 'https://tabs.example.com/one' }] }
    expect((await call('PUT', `/api/set-link/${id}`, { body: { payload }, secret: 'wrong' })).status).toBe(403)
    expect((await call('PUT', `/api/set-link/${id}`, { body: { payload }, secret })).status).toBe(200)
    expect((await call('GET', `/api/set-link/${id}`)).status).toBe(200)
  })

  it('runs a live set from upload to stop', async () => {
    const secret = crypto.randomBytes(32).toString('hex')
    const id = deriveLiveSetId(secret)
    const content = { song }
    const hash = hashLiveSongContent(content)
    const manifest = { v: 1, name: 'Sunday', entries: [{ entryId: 'e1', contentHash: hash }] }

    expect((await call('PUT', `/api/live-set/${id}`, { body: { manifest }, secret })).status).toBe(409)
    expect((await call('PUT', `/api/live-set/${id}/song/${hash}`, { body: { content }, secret })).status).toBe(200)
    const published = await call('PUT', `/api/live-set/${id}`, { body: { manifest }, secret })
    expect(published.status).toBe(200)
    expect(published.json.rev).toBe(1)

    const live = await call('GET', `/api/live-set/${id}`)
    expect(live.status).toBe(200)
    expect(live.json.manifest?.status).toBe('live')

    expect((await call('DELETE', `/api/live-set/${id}`, { secret })).status).toBe(200)
    const stopped = await call('GET', `/api/live-set/${id}`)
    expect(stopped.json.manifest?.status).toBe('stopped')
  })
})
