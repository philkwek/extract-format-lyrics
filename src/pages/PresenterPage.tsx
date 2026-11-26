import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowRight, Monitor } from 'lucide-react'
import { trackEvent } from '../lib/analytics'
import { useMediaQuery } from '../lib/useMediaQuery'
import { usePresenterFeed } from '../lib/usePresenterFeed'
import { useViewportHeight } from '../lib/useViewportHeight'
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
      className="border-ui-border bg-ui-surface-raised hover:border-ui-border-strong flex flex-col items-start gap-4 rounded-3xl border p-10 text-left shadow-sm transition active:scale-[0.99]"
    >
      <span className="text-ui-accent">{icon}</span>
      <span className="block text-[32px] leading-tight font-bold">{title}</span>
      <span className="text-ui-text-muted block text-xl leading-[30px]">{body}</span>
    </button>
  )
}

function ModeChoice({ onChoose }: { onChoose: (mode: PresenterMode) => void }) {
  return (
    <div className="bg-ui-canvas text-ui-text relative flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <p className="absolute top-10 left-12 text-lg font-bold">
        Sets &amp; Sheets · Presenter view
      </p>
      <div className="w-full max-w-[1120px] text-center">
        <h1 className="text-5xl font-bold tracking-[-0.03em]">How should this screen work?</h1>
        <p className="text-ui-text-muted mt-3 text-xl">You can always change your choice later.</p>
        <div className="mt-12 grid grid-cols-2 gap-8">
          <ModeCard
            title="Follow the host"
            body="Shows the song the host is on. Nothing for you to do."
            icon={<ArrowRight size={40} strokeWidth={1.75} />}
            onClick={() => onChoose('auto')}
          />
          <ModeCard
            title="Control it myself"
            body="You pick the song and section. Lyrics show in a separate window for the projector."
            icon={<Monitor size={40} strokeWidth={1.75} />}
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
  const heightPx = useViewportHeight()
  const openedTracked = useRef(false)
  const previousDark = useRef<boolean | null>(null)

  useWakeLock(wide)

  useEffect(() => {
    if (!mode || openedTracked.current) return
    openedTracked.current = true
    trackEvent('presenter_opened', { mode })
  }, [mode])

  useEffect(() => {
    if (mode !== 'auto') return
    if (previousDark.current === null) {
      previousDark.current = document.documentElement.classList.contains('dark')
    }
    document.documentElement.classList.toggle('dark', display.theme === 'dark')
    return () => {
      if (previousDark.current !== null) {
        document.documentElement.classList.toggle('dark', previousDark.current)
      }
    }
  }, [mode, display.theme])

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
    return <PresenterConsole id={id} feed={feed} onSwitchToAuto={switchToAuto} />
  }
  if (feed.status === 'missing') return <MissingNotice />

  const stopped = feed.status === 'stopped'
  const songs = feed.lyrics?.songs ?? []
  const currentSong = songs.find((song) => song.entryId === feed.currentEntryId) ?? songs[0] ?? null

  return (
    <div className="h-screen w-screen overflow-hidden">
      <PresenterCanvas
        song={stopped ? null : currentSong}
        display={display}
        view="whole"
        sectionIndex={null}
        blackout={blackout || stopped}
        heightPx={heightPx}
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
