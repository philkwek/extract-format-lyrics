import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AccountOfflineError,
  listRecentlyDeleted,
  restoreDeletedSet,
  type DeletedSet,
} from '../lib/accountSync'
import { ACCOUNT_MAX_SETS } from '../lib/accountLimits'
import { songCount } from '../lib/plural'
import OverlayDialog from './ui/OverlayDialog'
import { Button, StatusBanner, type StatusTone } from './ui'

const DAY_MS = 24 * 60 * 60 * 1000

interface Notice {
  tone: StatusTone
  text: string
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function deletedWhen(deletedAt: number, now: number): string {
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(deletedAt)) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

interface Loaded {
  rows: DeletedSet[]
  error: 'offline' | 'failed' | null
  now: number
}

async function fetchDeleted(): Promise<Loaded> {
  try {
    return { rows: await listRecentlyDeleted(), error: null, now: Date.now() }
  } catch (err) {
    return {
      rows: [],
      error: err instanceof AccountOfflineError ? 'offline' : 'failed',
      now: Date.now(),
    }
  }
}

export interface RecentlyDeletedDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function RecentlyDeletedDialog({ isOpen, onClose }: RecentlyDeletedDialogProps) {
  const [rows, setRows] = useState<DeletedSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'offline' | 'failed' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [prevOpen, setPrevOpen] = useState(isOpen)
  const isOpenRef = useRef(isOpen)
  const loadIdRef = useRef(0)

  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen)
    if (isOpen) {
      setRows([])
      setError(null)
      setNotice(null)
      setLoading(true)
    }
  }

  const show = useCallback((result: Loaded) => {
    setNow(result.now)
    setRows(result.rows)
    setError(result.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    isOpenRef.current = isOpen
    if (!isOpen) return
    let cancelled = false
    const id = ++loadIdRef.current
    void fetchDeleted().then((result) => {
      if (!cancelled && id === loadIdRef.current) show(result)
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, show])

  function close() {
    setNotice(null)
    onClose()
  }

  async function restore(row: DeletedSet) {
    setBusyId(row.setId)
    setNotice(null)
    setError(null)
    const openLoadId = loadIdRef.current
    try {
      const outcome = await restoreDeletedSet(row.setId)
      if (!isOpenRef.current || openLoadId !== loadIdRef.current) return
      if (outcome === 'restored') {
        setRows((current) => current.filter((item) => item.setId !== row.setId))
        setNotice({ tone: 'success', text: `Restored “${row.name}”.` })
      } else if (outcome === 'full') {
        setNotice({
          tone: 'warning',
          text: `Your account has ${ACCOUNT_MAX_SETS} sets. Delete one to restore this set.`,
        })
      } else {
        setNotice({ tone: 'info', text: 'This set is no longer in Recently deleted.' })
        const id = ++loadIdRef.current
        const refreshed = await fetchDeleted()
        if (isOpenRef.current && id === loadIdRef.current) show(refreshed)
      }
    } catch (err) {
      if (!isOpenRef.current || openLoadId !== loadIdRef.current) return
      if (err instanceof AccountOfflineError) {
        setError('offline')
      } else {
        setNotice({ tone: 'error', text: "Couldn't restore this set. Try again." })
      }
    } finally {
      setBusyId(null)
    }
  }

  return createPortal(
    <OverlayDialog
      isOpen={isOpen}
      onClose={close}
      title="Recently deleted"
      description="Deleted sets stay here for 30 days."
      size="sm"
      footer={
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
      }
    >
      {error && (
        <StatusBanner tone="error" className="mb-4">
          {error === 'offline'
            ? 'Recently deleted needs a connection.'
            : "Couldn't load deleted sets. Try again."}
        </StatusBanner>
      )}
      {notice && (
        <StatusBanner tone={notice.tone} className="mb-4">
          {notice.text}
        </StatusBanner>
      )}
      {loading && <p className="text-ui-text-muted text-sm">Loading deleted sets…</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="text-ui-text-muted text-sm">No deleted sets.</p>
      )}
      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.setId}
              className="border-ui-border flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-ui-text truncate text-sm font-semibold">{row.name}</p>
                <p className="text-ui-text-muted mt-0.5 text-xs">
                  {songCount(row.songCount)} · {deletedWhen(row.deletedAt, now)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                loading={busyId === row.setId}
                disabled={busyId !== null}
                onClick={() => void restore(row)}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </OverlayDialog>,
    document.body,
  )
}
