import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowRight, Monitor } from 'lucide-react'
import { trackEvent } from '../lib/analytics'
import { useMediaQuery } from '../lib/useMediaQuery'
import { usePresenterFeed } from '../lib/usePresenterFeed'
import { useWakeLock } from '../lib/useWakeLock'
import {
  loadPresenterMode,
  savePresenterMode,
  usePresenterDisplay,
  type PresenterMode,
} from '../lib/presenterSettings'
import PresenterCanvas from '../components/presenter/PresenterCanvas'
import PresenterConsole from '../components/presenter/PresenterConsole'
import PresenterCorner from '../components/presenter/PresenterCorner'

const WIDE_QUERY = '(min-width: 1024px)'

function BiggerScreenNotice() {
  return (
    <div className="bg-ui-canvas text-ui-text flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Monitor className="text-ui-accent h-12 w-12" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-bold tracking-[-0.025em]">Open this on a bigger screen</h1>
      <p className="text-ui-text-muted mt-2 max-w-sm text-sm leading-6">
        Presenter view is for sharing lyrics on the big screen!
      </p>
    </div>
  )
}

interface ModeCardProps {
  title: string
  body: string
  icon: ReactNode
  onClick: () => void
}

function ModeCard({ title, body, icon, onClick }: ModeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-ui-border bg-ui-surface-raised hover:border-ui-border-strong flex items-start justify-between gap-4 rounded-3xl border p-6 text-left shadow-sm transition active:scale-[0.99]"
    >
      <span>
        <span className="block text-lg font-bold">{title}</span>
        <span className="text-ui-text-muted mt-2 block text-sm leading-6">{body}</span>
      </span>
      <span className="bg-ui-accent/10 text-ui-accent-strong flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
        {icon}
      </span>
    </button>
  )
}

function ModeChoice({ onChoose }: { onChoose: (mode: PresenterMode) => void }) {
  return (
    <div className="bg-ui-canvas text-ui-text relative flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <p className="text-ui-text-muted absolute top-5 left-6 text-xs font-medium">
        Sets &amp; Sheets · Presenter view
      </p>
      <div className="w-full max-w-3xl text-center">
        <h1 className="text-3xl font-bold tracking-[-0.03em]">How should this screen work?</h1>
        <p className="text-ui-text-muted mt-2 text-sm">You can always change your choice later.</p>
        <div className="mt-8 grid grid-cols-2 gap-4">
          <ModeCard
            title="Follow the host"
            body="Shows the song the host is on. Nothing for you to do."
            icon={<ArrowRight size={22} />}
            onClick={() => onChoose('auto')}
          />
          <ModeCard
            title="Control it myself"
            body="You pick the song and section. Lyrics show in a separate window for the projector."
            icon={<Monitor size={22} />}
            onClick={() => onChoose('manual')}
          />
        </div>
      </div>
    </div>
  )
}

function MissingNotice() {
  return (
    <div className="bg-ui-canvas text-ui-text flex min-h-screen items-center justify-center px-6 text-center">
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-bold tracking-[-0.025em]">
          This presenter link isn&apos;t available
        </h1>
        <p className="text-ui-text-muted text-sm leading-6">
          It may have expired, or the host stopped sharing lyrics. Ask the host for a new link.
        </p>
      </div>
    </div>
  )
}

export default function PresenterPage() {
  const { id = '' } = useParams<{ id: string }>()
  const wide = useMediaQuery(WIDE_QUERY)
  const feed = usePresenterFeed(id)
  const [display, patchDisplay] = usePresenterDisplay()
  const [mode, setMode] = useState<PresenterMode | null>(loadPresenterMode)
  const [blackout, setBlackout] = useState(false)
  const openedTracked = useRef(false)
  const previousDark = useRef<boolean | null>(null)

  useWakeLock(wide)

  useEffect(() => {
    if (!mode || openedTracked.current) return
    openedTracked.current = true
    trackEvent('presenter_opened', { mode })
  }, [mode])

  useEffect(() => {
    if (previousDark.current === null) {
      previousDark.current = document.documentElement.classList.contains('dark')
    }
    document.documentElement.classList.toggle('dark', display.theme === 'dark')
  }, [display.theme])

  useEffect(() => {
    return () => {
      if (previousDark.current !== null) {
        document.documentElement.classList.toggle('dark', previousDark.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!feed.lyrics) return
    const previousTitle = document.title
    document.title = `Presenter · ${feed.lyrics.name}`
    return () => {
      document.title = previousTitle
    }
  }, [feed.lyrics])

  const chooseMode = useCallback((next: PresenterMode) => {
    savePresenterMode(next)
    setMode(next)
  }, [])

  const switchToManual = useCallback(() => {
    savePresenterMode('manual')
    trackEvent('presenter_mode_switched', { mode: 'manual' })
    setMode('manual')
  }, [])

  const switchToAuto = useCallback(() => {
    savePresenterMode('auto')
    trackEvent('presenter_mode_switched', { mode: 'auto' })
    setMode('auto')
  }, [])

  if (!wide) return <BiggerScreenNotice />
  if (!mode) return <ModeChoice onChoose={chooseMode} />
  if (mode === 'manual') {
    return <PresenterConsole id={id} onSwitchToAuto={switchToAuto} />
  }
  if (feed.status === 'missing') return <MissingNotice />

  const stopped = feed.status === 'stopped'
  const songs = feed.lyrics?.songs ?? []
  const currentSong =
    songs.find((song) => song.entryId === feed.currentEntryId) ?? songs[0] ?? null

  return (
    <div className="h-screen w-screen overflow-hidden">
      <PresenterCanvas
        song={stopped ? null : currentSong}
        display={display}
        view="whole"
        blackout={blackout || stopped}
      />
      <PresenterCorner
        status={feed.status}
        display={display}
        onPatchDisplay={patchDisplay}
        blackout={blackout}
        onToggleBlackout={() => setBlackout((value) => !value)}
        onSwitchToManual={switchToManual}
      />
    </div>
  )
}
