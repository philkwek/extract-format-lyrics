import { parseKey } from './transpose'

export const PAD_KEYS = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const

export type PadKey = (typeof PAD_KEYS)[number]

/**
 * Resolves any major key string (including enharmonic spellings like C#, F#, G#, D#, A#)
 * to its corresponding canonical PadKey used for `/pads/${padKey}.mp3`.
 */
export function resolvePadKey(key: string | null | undefined): PadKey | null {
  if (!key) return null
  const parsed = parseKey(key)
  if (!parsed || parsed.minor) return null
  return PAD_KEYS[((parsed.root % 12) + 12) % 12] ?? null
}

export function getPadAudioUrl(padKey: PadKey): string {
  return `/pads/${padKey}.mp3`
}

export interface AmbientPadState {
  isPlaying: boolean
  isLoading: boolean
  activeKey: PadKey | null
}

type StateListener = (state: AmbientPadState) => void

export interface AudioGainParamLike {
  value: number
  setValueAtTime(value: number, startTime: number): void
  linearRampToValueAtTime(value: number, endTime: number): void
  cancelScheduledValues?(startTime: number): void
}

export interface GainNodeLike {
  gain: AudioGainParamLike
  connect(destination: unknown): void
  disconnect(): void
}

export interface AudioBufferSourceNodeLike {
  buffer: AudioBuffer | null
  loop: boolean
  connect(destination: unknown): void
  disconnect(): void
  start(when?: number): void
  stop(when?: number): void
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly state: AudioContextState
  readonly destination: unknown
  resume(): Promise<void>
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBuffer>
  createGain(): GainNodeLike
  createBufferSource(): AudioBufferSourceNodeLike
}

export interface AmbientPadPlayerOptions {
  fadeInSec?: number
  fadeOutSec?: number
  crossfadeSec?: number
  createAudioContext?: () => AudioContextLike
  fetchAudioData?: (url: string) => Promise<ArrayBuffer>
}

interface ActiveVoice {
  padKey: PadKey
  source: AudioBufferSourceNodeLike
  gainNode: GainNodeLike
  fadeStartTime: number
  fadeStartValue: number
  fadeTargetValue: number
  fadeDurationSec: number
  cleanupTimer?: ReturnType<typeof setTimeout>
}

function estimateVoiceGain(voice: ActiveVoice, now: number): number {
  if (voice.fadeDurationSec <= 0) return voice.fadeTargetValue
  const elapsed = now - voice.fadeStartTime
  if (elapsed <= 0) return voice.fadeStartValue
  if (elapsed >= voice.fadeDurationSec) return voice.fadeTargetValue
  const progress = elapsed / voice.fadeDurationSec
  return voice.fadeStartValue + (voice.fadeTargetValue - voice.fadeStartValue) * progress
}

interface AudioSessionLike {
  type: string
}

type NavigatorWithAudioSession = Navigator & {
  audioSession?: AudioSessionLike
}

/**
 * iOS routes Web Audio through the ambient audio session by default, which is
 * silenced by the hardware Ring/Silent switch. Declaring playback keeps the
 * pad audible regardless of the switch position. Safari 16.4+ implements the
 * AudioSession API; other browsers expose no such object.
 */
function configureAudioSession(): void {
  if (typeof navigator === 'undefined') return
  const audioSession = (navigator as NavigatorWithAudioSession).audioSession
  if (!audioSession || audioSession.type === 'playback') return

  try {
    audioSession.type = 'playback'
  } catch {
    // Some Safari versions expose only a partial AudioSession implementation.
  }
}

function defaultCreateAudioContext(): AudioContextLike {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  return new Ctor()
}

async function defaultFetchAudioData(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ambient pad audio: ${res.status}`)
  }
  return res.arrayBuffer()
}

export class AmbientPadPlayer {
  private readonly fadeInSec: number
  private readonly fadeOutSec: number
  private readonly crossfadeSec: number
  private readonly createAudioContext: () => AudioContextLike
  private readonly fetchAudioData: (url: string) => Promise<ArrayBuffer>

  private ctx: AudioContextLike | null = null
  private bufferCache = new Map<PadKey, AudioBuffer>()
  private inflightLoads = new Map<PadKey, Promise<AudioBuffer>>()

  private activeVoice: ActiveVoice | null = null
  private fadingVoices = new Set<ActiveVoice>()
  private operationId = 0

  private state: AmbientPadState = {
    isPlaying: false,
    isLoading: false,
    activeKey: null,
  }
  private listeners = new Set<StateListener>()

  constructor(options: AmbientPadPlayerOptions = {}) {
    this.fadeInSec = options.fadeInSec ?? 2.5
    this.fadeOutSec = options.fadeOutSec ?? 1.5
    this.crossfadeSec = options.crossfadeSec ?? 3.5
    this.createAudioContext = options.createAudioContext ?? defaultCreateAudioContext
    this.fetchAudioData = options.fetchAudioData ?? defaultFetchAudioData
  }

  getState(): AmbientPadState {
    return this.state
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private updateState(patch: Partial<AmbientPadState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }

  private ensureContext(): AudioContextLike {
    if (!this.ctx) {
      configureAudioSession()
      this.ctx = this.createAudioContext()
    }
    return this.ctx
  }

  private async loadBuffer(padKey: PadKey, ctx: AudioContextLike): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(padKey)
    if (cached) return cached

    const existing = this.inflightLoads.get(padKey)
    if (existing) return existing

    const promise = (async () => {
      const arrayBuffer = await this.fetchAudioData(getPadAudioUrl(padKey))
      const decoded = await ctx.decodeAudioData(arrayBuffer)
      this.bufferCache.set(padKey, decoded)
      this.inflightLoads.delete(padKey)
      return decoded
    })().catch((err) => {
      this.inflightLoads.delete(padKey)
      throw err
    })

    this.inflightLoads.set(padKey, promise)
    return promise
  }

  private fadeOutVoice(voice: ActiveVoice, durationSec: number): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const currentGain = estimateVoiceGain(voice, now)

    if (voice.cleanupTimer) {
      clearTimeout(voice.cleanupTimer)
    }

    voice.gainNode.gain.cancelScheduledValues?.(now)
    voice.gainNode.gain.setValueAtTime(currentGain, now)
    voice.gainNode.gain.linearRampToValueAtTime(0, now + durationSec)

    voice.fadeStartTime = now
    voice.fadeStartValue = currentGain
    voice.fadeTargetValue = 0
    voice.fadeDurationSec = durationSec

    this.fadingVoices.add(voice)

    voice.cleanupTimer = setTimeout(() => {
      this.fadingVoices.delete(voice)
      try {
        voice.source.stop()
      } catch {
        // Ignore if already stopped
      }
      try {
        voice.source.disconnect()
        voice.gainNode.disconnect()
      } catch {
        // Ignore disconnect errors
      }
    }, Math.max(50, Math.ceil(durationSec * 1000) + 50))
  }

  private startNewVoice(padKey: PadKey, buffer: AudioBuffer, durationSec: number): ActiveVoice {
    const ctx = this.ensureContext()
    const now = ctx.currentTime

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true

    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(0, now)
    gainNode.gain.linearRampToValueAtTime(1, now + durationSec)

    source.connect(gainNode)
    gainNode.connect(ctx.destination)
    source.start(0)

    return {
      padKey,
      source,
      gainNode,
      fadeStartTime: now,
      fadeStartValue: 0,
      fadeTargetValue: 1,
      fadeDurationSec: durationSec,
    }
  }

  /**
   * Starts playing the ambient pad for the given key.
   * If already playing the same pitch class, continues uninterrupted.
   * If playing a different pitch class, crossfades into the new key.
   */
  async play(key: string | null | undefined): Promise<void> {
    const padKey = resolvePadKey(key)
    if (!padKey) return

    // If already playing this exact pad key, do nothing
    if (this.state.isPlaying && this.activeVoice?.padKey === padKey && !this.state.isLoading) {
      return
    }

    const opId = ++this.operationId
    const wasPlaying = this.state.isPlaying && this.activeVoice !== null

    this.updateState({
      isPlaying: true,
      isLoading: true,
      activeKey: padKey,
    })

    try {
      const ctx = this.ensureContext()
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      const buffer = await this.loadBuffer(padKey, ctx)

      // If another play/stop/setKey happened while loading, abort this stale transition
      if (opId !== this.operationId) {
        return
      }

      const rampSec = wasPlaying ? this.crossfadeSec : this.fadeInSec

      if (this.activeVoice) {
        this.fadeOutVoice(this.activeVoice, rampSec)
        this.activeVoice = null
      }

      this.activeVoice = this.startNewVoice(padKey, buffer, rampSec)
      this.updateState({
        isPlaying: true,
        isLoading: false,
        activeKey: padKey,
      })
    } catch (err) {
      if (opId === this.operationId) {
        this.updateState({
          isPlaying: false,
          isLoading: false,
          activeKey: null,
        })
      }
      throw err
    }
  }

  /**
   * Updates the target key while the pad is playing.
   * - If the pad is stopped, does nothing.
   * - If the new key resolves to the same PadKey, continues playing uninterrupted.
   * - If the new key resolves to a different PadKey, crossfades smoothly into the new key.
   */
  async setKey(newKey: string | null | undefined): Promise<void> {
    if (!this.state.isPlaying) return
    const nextPadKey = resolvePadKey(newKey)
    if (!nextPadKey) return

    if (this.state.activeKey === nextPadKey) {
      return
    }

    await this.play(nextPadKey)
  }

  /**
   * Smoothly fades out and stops any playing ambient pad.
   */
  stop(): void {
    this.operationId++

    if (this.activeVoice) {
      this.fadeOutVoice(this.activeVoice, this.fadeOutSec)
      this.activeVoice = null
    }

    if (this.state.isPlaying || this.state.isLoading || this.state.activeKey !== null) {
      this.updateState({
        isPlaying: false,
        isLoading: false,
        activeKey: null,
      })
    }
  }
}

export const ambientPadPlayer = new AmbientPadPlayer()
