import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { keyOptions } from '../../src/lib/keys'
import {
  AmbientPadPlayer,
  PAD_KEYS,
  resolvePadKey,
  getPadAudioUrl,
  type AudioContextLike,
  type AudioBufferSourceNodeLike,
  type GainNodeLike,
} from '../../src/lib/ambientPadPlayer'

const ENHARMONIC_PAIRS: Array<[string, string]> = [
  ['C#', 'Db'],
  ['D#', 'Eb'],
  ['F#', 'Gb'],
  ['G#', 'Ab'],
  ['A#', 'Bb'],
]

interface MockVoiceNodes {
  source: AudioBufferSourceNodeLike & {
    startCalls: number[]
    stopCalls: number[]
    disconnected: boolean
  }
  gainNode: GainNodeLike & {
    setValueCalls: Array<{ value: number; time: number }>
    rampCalls: Array<{ value: number; time: number }>
    disconnected: boolean
  }
}

function createMockAudioEnv() {
  let currentTime = 10
  const createdSources: MockVoiceNodes['source'][] = []
  const createdGains: MockVoiceNodes['gainNode'][] = []

  const ctx: AudioContextLike & { advanceTime(sec: number): void } = {
    get currentTime() {
      return currentTime
    },
    advanceTime(sec: number) {
      currentTime += sec
    },
    state: 'running',
    destination: { id: 'dest' },
    resume: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async (buf: ArrayBuffer) => {
      return { duration: 65, byteLength: buf.byteLength } as unknown as AudioBuffer
    }),
    createGain: vi.fn(() => {
      const setValueCalls: Array<{ value: number; time: number }> = []
      const rampCalls: Array<{ value: number; time: number }> = []
      const gainNode: MockVoiceNodes['gainNode'] = {
        gain: {
          value: 1,
          setValueAtTime: vi.fn((value: number, time: number) => {
            setValueCalls.push({ value, time })
          }),
          linearRampToValueAtTime: vi.fn((value: number, time: number) => {
            rampCalls.push({ value, time })
          }),
          cancelScheduledValues: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(() => {
          gainNode.disconnected = true
        }),
        setValueCalls,
        rampCalls,
        disconnected: false,
      }
      createdGains.push(gainNode)
      return gainNode
    }),
    createBufferSource: vi.fn(() => {
      const startCalls: number[] = []
      const stopCalls: number[] = []
      const source: MockVoiceNodes['source'] = {
        buffer: null,
        loop: false,
        connect: vi.fn(),
        disconnect: vi.fn(() => {
          source.disconnected = true
        }),
        start: vi.fn((when = 0) => {
          startCalls.push(when)
        }),
        stop: vi.fn((when = 0) => {
          stopCalls.push(when)
        }),
        startCalls,
        stopCalls,
        disconnected: false,
      }
      createdSources.push(source)
      return source
    }),
  }

  const fetchedUrls: string[] = []
  const fetchAudioData = vi.fn(async (url: string) => {
    fetchedUrls.push(url)
    return new ArrayBuffer(16)
  })

  return {
    ctx,
    createdSources,
    createdGains,
    fetchedUrls,
    fetchAudioData,
  }
}

describe('resolvePadKey', () => {
  it('maps all 12 natural and flat major keys to their canonical PadKey', () => {
    expect(resolvePadKey('C')).toBe('C')
    expect(resolvePadKey('Db')).toBe('Db')
    expect(resolvePadKey('D')).toBe('D')
    expect(resolvePadKey('Eb')).toBe('Eb')
    expect(resolvePadKey('E')).toBe('E')
    expect(resolvePadKey('F')).toBe('F')
    expect(resolvePadKey('Gb')).toBe('Gb')
    expect(resolvePadKey('G')).toBe('G')
    expect(resolvePadKey('Ab')).toBe('Ab')
    expect(resolvePadKey('A')).toBe('A')
    expect(resolvePadKey('Bb')).toBe('Bb')
    expect(resolvePadKey('B')).toBe('B')
  })

  it('maps enharmonic sharp major keys to the canonical PadKey filenames', () => {
    expect(resolvePadKey('C#')).toBe('Db')
    expect(resolvePadKey('D#')).toBe('Eb')
    expect(resolvePadKey('F#')).toBe('Gb')
    expect(resolvePadKey('G#')).toBe('Ab')
    expect(resolvePadKey('A#')).toBe('Bb')
  })

  it('maps every selectable major key to a valid canonical pad key', () => {
    for (const key of keyOptions(false)) {
      expect(PAD_KEYS).toContain(resolvePadKey(key))
    }
  })

  it('maps each enharmonic pair to the same canonical pad key', () => {
    for (const [sharp, flat] of ENHARMONIC_PAIRS) {
      expect(resolvePadKey(sharp)).toBe(resolvePadKey(flat))
    }
  })

  it('returns null for empty, invalid, or minor keys', () => {
    expect(resolvePadKey(null)).toBeNull()
    expect(resolvePadKey(undefined)).toBeNull()
    expect(resolvePadKey('')).toBeNull()
    expect(resolvePadKey('Am')).toBeNull()
    expect(resolvePadKey('invalid')).toBeNull()
  })

  it('builds the expected static asset URL in /pads/', () => {
    expect(getPadAudioUrl('C')).toBe('/pads/C.mp3')
    expect(getPadAudioUrl('Gb')).toBe('/pads/Gb.mp3')
  })
})

describe('AmbientPadPlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('fetches, decodes, loops, and fades in the pad for the requested key', async () => {
    const env = createMockAudioEnv()
    const player = new AmbientPadPlayer({
      fadeInSec: 2.5,
      createAudioContext: () => env.ctx,
      fetchAudioData: env.fetchAudioData,
    })

    await player.play('G')

    expect(env.fetchedUrls).toEqual(['/pads/G.mp3'])
    expect(player.getState()).toEqual({
      isPlaying: true,
      isLoading: false,
      activeKey: 'G',
    })

    expect(env.createdSources).toHaveLength(1)
    expect(env.createdSources[0].loop).toBe(true)
    expect(env.createdSources[0].startCalls).toEqual([0])

    expect(env.createdGains[0].setValueCalls).toEqual([{ value: 0, time: 10 }])
    expect(env.createdGains[0].rampCalls).toEqual([{ value: 1, time: 12.5 }])
  })

  it('continues playing uninterrupted without crossfading when switching to a song in the same key (or enharmonic equivalent)', async () => {
    const env = createMockAudioEnv()
    const player = new AmbientPadPlayer({
      createAudioContext: () => env.ctx,
      fetchAudioData: env.fetchAudioData,
    })

    await player.play('F#')
    expect(player.getState().activeKey).toBe('Gb')
    expect(env.createdSources).toHaveLength(1)

    // Switching to another song in F# or Gb should not create a new source or fade out the existing one
    await player.setKey('F#')
    await player.setKey('Gb')

    expect(env.createdSources).toHaveLength(1)
    expect(env.fetchedUrls).toEqual(['/pads/Gb.mp3'])
    expect(player.getState().isPlaying).toBe(true)
  })

  it.each(ENHARMONIC_PAIRS)(
    'keeps playing without refetching when switching from %s to %s',
    async (sharp, flat) => {
      const env = createMockAudioEnv()
      const player = new AmbientPadPlayer({
        createAudioContext: () => env.ctx,
        fetchAudioData: env.fetchAudioData,
      })

      await player.play(sharp)
      const resolved = resolvePadKey(sharp)
      expect(player.getState().activeKey).toBe(resolved)
      expect(env.createdSources).toHaveLength(1)
      expect(env.fetchedUrls).toHaveLength(1)

      await player.setKey(flat)
      await player.setKey(sharp)

      expect(player.getState().activeKey).toBe(resolved)
      expect(player.getState().isPlaying).toBe(true)
      expect(env.createdSources).toHaveLength(1)
      expect(env.fetchedUrls).toHaveLength(1)
    },
  )

  it('crossfades smoothly when switching to a song in a different key and caches buffers', async () => {
    const env = createMockAudioEnv()
    const player = new AmbientPadPlayer({
      fadeInSec: 2,
      crossfadeSec: 4,
      createAudioContext: () => env.ctx,
      fetchAudioData: env.fetchAudioData,
    })

    await player.play('G')
    env.ctx.advanceTime(5) // G is now at full volume (1.0) at t=15

    await player.setKey('C')

    expect(env.fetchedUrls).toEqual(['/pads/G.mp3', '/pads/C.mp3'])
    expect(player.getState()).toEqual({
      isPlaying: true,
      isLoading: false,
      activeKey: 'C',
    })

    // First voice (G) should be ramped down from 1 to 0 over 4s (from t=15 to t=19)
    const gainG = env.createdGains[0]
    expect(gainG.setValueCalls.at(-1)).toEqual({ value: 1, time: 15 })
    expect(gainG.rampCalls.at(-1)).toEqual({ value: 0, time: 19 })

    // Second voice (C) should be ramped up from 0 to 1 over 4s (from t=15 to t=19)
    const gainC = env.createdGains[1]
    expect(gainC.setValueCalls[0]).toEqual({ value: 0, time: 15 })
    expect(gainC.rampCalls[0]).toEqual({ value: 1, time: 19 })

    // Advance timer past crossfade cleanup to ensure old source is stopped & disconnected
    vi.advanceTimersByTime(4500)
    expect(env.createdSources[0].stopCalls).toHaveLength(1)
    expect(env.createdSources[0].disconnected).toBe(true)

    // Switching back to G uses cached AudioBuffer without re-fetching
    env.ctx.advanceTime(5)
    await player.setKey('G')
    expect(env.fetchedUrls).toEqual(['/pads/G.mp3', '/pads/C.mp3'])
    expect(player.getState().activeKey).toBe('G')
  })

  it('fades out and stops the active voice when stop() is called', async () => {
    const env = createMockAudioEnv()
    const player = new AmbientPadPlayer({
      fadeInSec: 2,
      fadeOutSec: 1.5,
      createAudioContext: () => env.ctx,
      fetchAudioData: env.fetchAudioData,
    })

    await player.play('D')
    env.ctx.advanceTime(3) // t=13, full gain 1.0

    player.stop()

    expect(player.getState()).toEqual({
      isPlaying: false,
      isLoading: false,
      activeKey: null,
    })

    const gainD = env.createdGains[0]
    expect(gainD.setValueCalls.at(-1)).toEqual({ value: 1, time: 13 })
    expect(gainD.rampCalls.at(-1)).toEqual({ value: 0, time: 14.5 })

    vi.advanceTimersByTime(2000)
    expect(env.createdSources[0].stopCalls).toHaveLength(1)
  })
})

describe('iOS audio session', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'audioSession')
  })

  it('sets the session to playback before creating the audio context', async () => {
    const audioSession = { type: 'auto' }
    Object.defineProperty(navigator, 'audioSession', {
      configurable: true,
      value: audioSession,
    })

    const env = createMockAudioEnv()
    let sessionTypeAtCreation: string | undefined
    const player = new AmbientPadPlayer({
      createAudioContext: () => {
        sessionTypeAtCreation = audioSession.type
        return env.ctx
      },
      fetchAudioData: env.fetchAudioData,
    })

    await player.play('C')

    expect(sessionTypeAtCreation).toBe('playback')
    expect(audioSession.type).toBe('playback')
  })

  it('does not reassign a session that is already set to playback', async () => {
    const setType = vi.fn()
    const audioSession = {
      get type() {
        return 'playback'
      },
      set type(value: string) {
        setType(value)
      },
    }
    Object.defineProperty(navigator, 'audioSession', {
      configurable: true,
      value: audioSession,
    })

    const env = createMockAudioEnv()
    const player = new AmbientPadPlayer({
      createAudioContext: () => env.ctx,
      fetchAudioData: env.fetchAudioData,
    })

    await player.play('C')

    expect(setType).not.toHaveBeenCalled()
  })
})
