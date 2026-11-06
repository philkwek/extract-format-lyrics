// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { useFollowEditGuard } from '../../src/lib/useFollowEditGuard'
import { stopFollowing, type FollowController } from '../../src/lib/liveFollow'

vi.mock('../../src/lib/liveFollow', () => ({
  stopFollowing: vi.fn(),
}))

const stored = { id: 's1', createdAt: 0, name: 'Set', songs: [], followHost: false }

const controller = {
  stop: vi.fn(),
  flushDeferred: vi.fn(),
  dropDeferred: vi.fn(),
} satisfies FollowController

const calls: string[] = []

function Harness({ following, onStopped }: { following: boolean; onStopped: () => void }) {
  const ref = useRef<FollowController | null>(controller)
  const { guard, dialog } = useFollowEditGuard({
    following,
    sessionId: 's1',
    controllerRef: ref,
    onStopped: () => {
      calls.push('adopt')
      onStopped()
    },
  })
  return (
    <>
      <button onClick={() => guard(() => calls.push('action'))}>Edit</button>
      {dialog}
    </>
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
  it('runs the action straight away when not following', () => {
    render(<Harness following={false} onStopped={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(calls).toEqual(['action'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks first when following, and Keep following runs nothing and flushes', async () => {
    render(<Harness following onStopped={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Make this your own copy?')).toBeTruthy()
    expect(calls).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Keep following' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls).toEqual([])
    expect(controller.flushDeferred).toHaveBeenCalledTimes(1)
    expect(stopFollowing).not.toHaveBeenCalled()
  })

  it('Edit my copy drops the held update, stops following, then runs the action once', async () => {
    vi.mocked(stopFollowing).mockResolvedValue(stored)
    controller.dropDeferred.mockImplementation(() => calls.push('drop'))
    vi.mocked(stopFollowing).mockImplementation(async () => {
      calls.push('stop')
      return stored
    })
    render(<Harness following onStopped={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit my copy' }))

    await waitFor(() => expect(calls).toEqual(['drop', 'stop', 'adopt', 'action']))
    expect(controller.flushDeferred).not.toHaveBeenCalled()
  })
})
