import { useSyncExternalStore } from 'react'
import { getSyncState, subscribeSyncState, type SyncState } from './accountSync'

/** Watches the sets waiting for an update, a delete choice or a conflict. */
export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState)
}
