// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useFollowEditGuard } from '../../src/lib/useFollowEditGuard'
import type { FollowController } from '../../src/lib/liveFollow'
import { sessionStore } from '../../src/lib/sessionStore'

vi.mock('../../src/lib/sessionStore', () => ({
  sessionPath: (s: { id: string; publicId?: string }) => `/session/${s.publicId ?? s.id}`,
  sessionStore: { getSession: vi.fn(), createSetCopy: vi.fn() },
}))

const stored = { id: 's1', createdAt: 0, name: 'Set', songs: [], liveSourceId: 'live-1' }
const copy = { id: 's2', createdAt: 0, name: 'Set - Copy', songs: [] }

const controller = {
  stop: vi.fn(),
  flushDeferred: vi.fn(),
  dropDeferred: vi.fn(),
} satisfies FollowController

const calls: string[] = []

function Where() {
  return <p data-testid="loc">{useLocation().pathname}</p>
}

function Inner({ following }: { following: boolean }) {
  const ref = useRef<FollowController | null>(controller)
  const { guard, dialog } = useFollowEditGuard({
    following,
    sessionId: 's1',
    controllerRef: ref,
  })
  return (
    <>
      <button onClick={() => guard(() => calls.push('action'))}>Edit</button>
      {dialog}
      <Where />
    </>
  )
}

function Harness(props: { following: boolean }) {
  return (
    <MemoryRouter>
      <Inner {...props} />
    </MemoryRouter>
  )
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
})

afterEach(() => {
  cleanup()
  calls.length = 0
  vi.clearAllMocks()
})

describe('useFollowEditGuard', () => {
  it('runs the action straight away when not live', () => {
    render(<Harness following={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(calls).toEqual(['action'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks first for a live set, and Cancel runs nothing and flushes', async () => {
    render(<Harness following />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Make your own copy?')).toBeTruthy()
    expect(calls).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls).toEqual([])
    expect(controller.flushDeferred).toHaveBeenCalledTimes(1)
    expect(sessionStore.createSetCopy).not.toHaveBeenCalled()
    expect(screen.getByTestId('loc').textContent).toBe('/')
  })

  it('Make a copy drops the held update, copies the stored set and opens the copy', async () => {
    vi.mocked(sessionStore.getSession).mockResolvedValue(stored as never)
    vi.mocked(sessionStore.createSetCopy).mockResolvedValue(copy as never)
    render(<Harness following />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Make a copy' }))

    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/session/s2'))
    expect(sessionStore.createSetCopy).toHaveBeenCalledWith(stored)
    expect(controller.dropDeferred).toHaveBeenCalledTimes(1)
    expect(controller.flushDeferred).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })
})
