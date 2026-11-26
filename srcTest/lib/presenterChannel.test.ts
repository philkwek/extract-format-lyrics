import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConsoleChannel,
  createOutputChannel,
  type OutputState,
} from '../../src/lib/presenterChannel'
import type { PresenterDisplay } from '../../src/lib/presenterSettings'

const display: PresenterDisplay = {
  textScale: 100,
  align: null,
  caps: false,
  theme: 'dark',
  sectionPosition: 'center',
  lyricsView: 'sections',
}

const state: OutputState = {
  setName: 'Sunday Morning',
  song: null,
  view: 'sections',
  sectionIndex: 1,
  display,
  blackout: false,
}

class FakeChannel {
  static channels = new Map<string, Set<FakeChannel>>()
  onmessage: ((event: MessageEvent) => void) | null = null

  private name: string

  constructor(name: string) {
    this.name = name
    const peers = FakeChannel.channels.get(name) ?? new Set<FakeChannel>()
    peers.add(this)
    FakeChannel.channels.set(name, peers)
  }

  postMessage(data: unknown) {
    for (const peer of FakeChannel.channels.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent)
    }
  }

  close() {
    FakeChannel.channels.get(this.name)?.delete(this)
  }
}

function createFake(name: string) {
  return new FakeChannel(name)
}

afterEach(() => {
  FakeChannel.channels.clear()
  vi.unstubAllGlobals()
})

describe('presenterChannel', () => {
  it('replies to hello with the current state and marks the output open', () => {
    const consoleChannel = createConsoleChannel('pub-1', () => state, createFake)
    const states: OutputState[] = []

    const output = createOutputChannel('pub-1', (next) => states.push(next), createFake)

    expect(states).toEqual([state])
    expect(consoleChannel.isOutputOpen()).toBe(true)
    output.close()
    consoleChannel.close()
  })

  it('finds an output window that was already open when the console reloads', () => {
    const states: OutputState[] = []
    const output = createOutputChannel('pub-1', (next) => states.push(next), createFake)

    const consoleChannel = createConsoleChannel('pub-1', () => state, createFake)

    expect(consoleChannel.isOutputOpen()).toBe(true)
    expect(states).toEqual([state])
    output.close()
    consoleChannel.close()
  })

  it('marks the output closed on bye', () => {
    const consoleChannel = createConsoleChannel('pub-1', () => state, createFake)
    const changes: boolean[] = []
    consoleChannel.onOutputChange((open) => changes.push(open))
    const output = createOutputChannel('pub-1', () => {}, createFake)

    output.close()

    expect(changes).toEqual([true, false])
    expect(consoleChannel.isOutputOpen()).toBe(false)
    consoleChannel.close()
  })

  it('ignores messages that are not for the presenter channel', () => {
    const consoleChannel = createConsoleChannel('pub-1', () => state, createFake)
    const other = createFake('someone-else')
    const changes: boolean[] = []
    consoleChannel.onOutputChange((open) => changes.push(open))

    other.postMessage({ type: 'hello' })

    expect(changes).toEqual([])
    consoleChannel.close()
  })

  it('publishes the newest state after it changes', () => {
    const consoleChannel = createConsoleChannel('pub-1', () => state, createFake)
    const states: OutputState[] = []
    const output = createOutputChannel('pub-1', (next) => states.push(next), createFake)
    const next: OutputState = { ...state, sectionIndex: 2, blackout: true }

    consoleChannel.publish(next)

    expect(states).toEqual([state, next])
    output.close()
    consoleChannel.close()
  })

  it('does nothing when BroadcastChannel is missing', () => {
    vi.stubGlobal('BroadcastChannel', undefined)

    const consoleChannel = createConsoleChannel('pub-1', () => state)
    expect(() => consoleChannel.publish(state)).not.toThrow()
    expect(consoleChannel.isOutputOpen()).toBe(false)
    const off = consoleChannel.onOutputChange(() => {})
    expect(() => off()).not.toThrow()

    const output = createOutputChannel('pub-1', () => {})
    expect(() => output.close()).not.toThrow()
    consoleChannel.close()
  })
})
