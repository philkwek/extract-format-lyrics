import { describe, expect, it, vi } from 'vitest'
import { runWorkerPool } from '../src/pool.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('runWorkerPool', () => {
  it('keeps input order while continuously filling free workers', async () => {
    const first = deferred<string>()
    const started: string[] = []
    const completed: string[] = []

    const running = runWorkerPool(
      ['slow', 'fast', 'third'],
      async (item) => {
        started.push(item)
        if (item === 'slow') await first.promise
        else await new Promise((resolve) => setTimeout(resolve, 5))
        completed.push(item)
        return item.toUpperCase()
      },
      2
    )

    await vi.waitFor(() => expect(started).toContain('third'))
    expect(completed).toEqual(['fast', 'third'])

    first.resolve('done')
    await expect(running).resolves.toEqual([
      { ok: true, value: 'SLOW' },
      { ok: true, value: 'FAST' },
      { ok: true, value: 'THIRD' },
    ])
  })

  it('never exceeds the requested concurrency', async () => {
    let active = 0
    let maximum = 0
    await runWorkerPool(
      [1, 2, 3, 4, 5],
      async () => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return active
      },
      2
    )
    expect(maximum).toBe(2)
  })

  it('isolates one failed item and continues the queue', async () => {
    const outcomes = await runWorkerPool(
      ['a', 'fail', 'c'],
      async (item) => {
        if (item === 'fail') throw new Error('broken')
        return item
      },
      2
    )
    expect(outcomes[0]).toEqual({ ok: true, value: 'a' })
    expect(outcomes[1]).toMatchObject({ ok: false })
    expect(outcomes[2]).toEqual({ ok: true, value: 'c' })
  })

  it('handles an empty queue', async () => {
    expect(await runWorkerPool([], async () => 1)).toEqual([])
  })
})
