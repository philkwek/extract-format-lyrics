export type PoolOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown }

/**
 * Runs a continuously filled worker pool. Results keep input order and one
 * failed item does not stop queued work. Concurrency is scoped to this call;
 * callers that need a global cap must add their own gate.
 */
export async function runWorkerPool<Item, Result>(
  items: Item[],
  worker: (item: Item, index: number) => Promise<Result>,
  concurrency = 2
): Promise<PoolOutcome<Result>[]> {
  const outcomes: PoolOutcome<Result>[] = new Array(items.length)
  if (items.length === 0) return outcomes

  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length))
  let nextIndex = 0

  const run = async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      try {
        outcomes[index] = { ok: true, value: await worker(items[index], index) }
      } catch (error) {
        outcomes[index] = { ok: false, error }
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, run))
  return outcomes
}
