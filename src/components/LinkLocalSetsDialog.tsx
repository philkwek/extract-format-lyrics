import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AccountOfflineError, linkLocalSets, removeUnlinkedSets } from '../lib/accountSync'
import { ACCOUNT_MAX_SETS } from '../lib/accountLimits'
import { trackEvent } from '../lib/analytics'
import { useSyncState } from '../lib/useSyncState'
import OverlayDialog from './ui/OverlayDialog'
import { Button, StatusBanner, type StatusTone } from './ui'

interface Notice {
  tone: StatusTone
  text: string
}

export default function LinkLocalSetsDialog() {
  const syncState = useSyncState()
  const [dismissed, setDismissed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'add' | 'remove' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [keptLocal, setKeptLocal] = useState<number | null>(null)
  const [prevSignedIn, setPrevSignedIn] = useState(syncState.signedIn)

  if (prevSignedIn !== syncState.signedIn) {
    setPrevSignedIn(syncState.signedIn)
    if (!syncState.signedIn) {
      setDismissed(false)
      setConfirming(false)
      setNotice(null)
      setKeptLocal(null)
    }
  }

  const sets = syncState.unlinkedSets
  const isOpen = syncState.signedIn && !dismissed && (sets.length > 0 || keptLocal !== null)
  const shown = sets.slice(0, 5)
  const more = sets.length - shown.length

  function close() {
    setDismissed(true)
    setConfirming(false)
    setNotice(null)
    setKeptLocal(null)
  }

  async function add() {
    setBusy('add')
    setNotice(null)
    try {
      const result = await linkLocalSets()
      if (result.added > 0) trackEvent('account_sync_enabled', { set_count: result.added })
      if (result.keptLocal > 0) {
        setKeptLocal(result.keptLocal)
        setNotice({
          tone: 'warning',
          text: `Your account can hold ${ACCOUNT_MAX_SETS} sets. ${result.keptLocal} ${
            result.keptLocal === 1 ? 'set stays' : 'sets stay'
          } on this device only.`,
        })
      } else {
        close()
      }
    } catch (error) {
      if (error instanceof AccountOfflineError) {
        setNotice({ tone: 'error', text: 'Saving to your account needs a connection.' })
      } else {
        setNotice({ tone: 'error', text: "Couldn't save your sets. Try again." })
      }
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('remove')
    setNotice(null)
    try {
      await removeUnlinkedSets()
      close()
    } catch {
      setNotice({ tone: 'error', text: "Couldn't remove the sets. Try again." })
    } finally {
      setBusy(null)
    }
  }

  return createPortal(
    <OverlayDialog
      isOpen={isOpen}
      onClose={close}
      title="Save sets to your account?"
      description="You currently have local sets, save them to your account?"
      size="sm"
    >
      {confirming ? (
        <>
          <p className="text-ui-text text-sm">
            Remove {sets.length} {sets.length === 1 ? 'set' : 'sets'} from this device? This can't
            be undone.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              variant="danger"
              loading={busy === 'remove'}
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              Remove sets
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setConfirming(false)}
            >
              Go back
            </Button>
          </div>
        </>
      ) : (
        sets.length > 0 && (
          <>
            <ul className="space-y-1.5">
              {shown.map((set) => (
                <li key={set.id} className="text-ui-text truncate text-sm">
                  {set.name}
                </li>
              ))}
            </ul>
            {more > 0 && <p className="text-ui-text-muted mt-1 text-xs">and {more} more</p>}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="primary"
                loading={busy === 'add'}
                disabled={busy !== null}
                onClick={() => void add()}
              >
                Add to account
              </Button>
              <Button
                variant="danger"
                disabled={busy !== null}
                onClick={() => {
                  setNotice(null)
                  setConfirming(true)
                }}
              >
                Remove
              </Button>
            </div>
          </>
        )
      )}
      {notice && (
        <StatusBanner tone={notice.tone} className="mt-3">
          {notice.text}
        </StatusBanner>
      )}
    </OverlayDialog>,
    document.body,
  )
}
