import type { PresenterDisplay, PresenterView } from './presenterSettings'
import type { SharedLyricsSong } from '../types/song'

export interface OutputState {
  setName: string
  song: SharedLyricsSong | null
  view: PresenterView
  sectionIndex: number | null
  display: PresenterDisplay
  blackout: boolean
}

type ConsoleToOutput = { type: 'state'; state: OutputState } | { type: 'ping' }
type OutputToConsole = { type: 'hello' } | { type: 'bye' }

interface ChannelLike {
  postMessage(message: unknown): void
  close(): void
  onmessage: ((event: MessageEvent) => void) | null
}

type CreateChannel = (name: string) => ChannelLike | null

export interface ConsoleChannel {
  publish(state: OutputState): void
  isOutputOpen(): boolean
  onOutputChange(callback: (open: boolean) => void): () => void
  close(): void
}

export interface OutputChannel {
  close(): void
}

function broadcastChannel(name: string): ChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(name)
  } catch {
    return null
  }
}

function channelName(id: string): string {
  return `presenter:${id}`
}

/** The console side: sends state and tracks whether an output window has said hello. */
export function createConsoleChannel(
  id: string,
  getState: () => OutputState,
  createChannel: CreateChannel = broadcastChannel,
): ConsoleChannel {
  const channel = createChannel(channelName(id))
  let open = false
  const listeners = new Set<(open: boolean) => void>()

  const setOpen = (next: boolean) => {
    if (open === next) return
    open = next
    for (const listener of listeners) listener(open)
  }

  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      const message = event.data as { type?: unknown } | null
      if (message?.type === 'hello') {
        const reply: ConsoleToOutput = { type: 'state', state: getState() }
        channel.postMessage(reply)
        setOpen(true)
      } else if (message?.type === 'bye') {
        setOpen(false)
      }
    }
    // An output window left open across a console reload answers with hello.
    const ping: ConsoleToOutput = { type: 'ping' }
    channel.postMessage(ping)
  }

  return {
    publish(state) {
      const message: ConsoleToOutput = { type: 'state', state }
      channel?.postMessage(message)
    },
    isOutputOpen: () => open,
    onOutputChange(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    close() {
      listeners.clear()
      if (!channel) return
      channel.onmessage = null
      channel.close()
    },
  }
}

/** The output side: asks the console for state and says goodbye when the page goes away. */
export function createOutputChannel(
  id: string,
  onState: (state: OutputState) => void,
  createChannel: CreateChannel = broadcastChannel,
): OutputChannel {
  const channel = createChannel(channelName(id))
  if (!channel) return { close: () => {} }

  const hello: OutputToConsole = { type: 'hello' }
  const bye: OutputToConsole = { type: 'bye' }

  channel.onmessage = (event: MessageEvent) => {
    const message = event.data as { type?: unknown; state?: unknown } | null
    if (message?.type === 'state' && message.state) {
      onState(message.state as OutputState)
    } else if (message?.type === 'ping') {
      channel.postMessage(hello)
    }
  }

  const sayBye = () => channel.postMessage(bye)
  channel.postMessage(hello)
  if (typeof window !== 'undefined') window.addEventListener('pagehide', sayBye)

  let closed = false
  return {
    close() {
      if (closed) return
      closed = true
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', sayBye)
      sayBye()
      channel.onmessage = null
      channel.close()
    },
  }
}
