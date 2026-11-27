export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'needs-choice'

let status: SyncStatus = 'synced'
const listeners = new Set<(status: SyncStatus) => void>()

export function getSyncStatus(): SyncStatus {
  return status
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setSyncStatus(next: SyncStatus): void {
  status = next
  for (const listener of listeners) listener(next)
}
