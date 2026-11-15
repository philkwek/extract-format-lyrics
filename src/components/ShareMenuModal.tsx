import { useEffect, useRef, useState, type Ref } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Session } from '../lib/sessionStore'
import type { Song } from '../types/song'
import { reducedMotionTransition, uiSpring } from '../lib/uiMotion'
import { Button } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import SendCopyRow from './share/SendCopyRow'
import ShareSetPanel from './share/ShareSetPanel'
import ShareLyricsLinkPanel from './share/ShareLyricsLinkPanel'

interface ShareMenuModalProps {
  session: Session
  songsData: Map<string, Song>
  isOpen: boolean
  onClose: () => void
}

type ShareView = 'list' | 'live' | 'lyrics'

interface ShareRowProps {
  title: string
  description: string
  active: boolean
  onClick: () => void
  buttonRef?: Ref<HTMLButtonElement>
}

function ShareRow({ title, description, active, onClick, buttonRef }: ShareRowProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-3 py-3 text-left outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-ui-surface-muted focus-visible:ring-3 focus-visible:ring-ui-focus"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ui-text">{title}</span>
        <span className="block text-xs leading-5 text-ui-text-muted">{description}</span>
      </span>
      <span
        className={`shrink-0 text-xs ${
          active ? 'font-semibold text-ui-accent' : 'text-ui-text-muted'
        }`}
      >
        {active ? 'On' : 'Off'}
      </span>
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ui-text-muted" />
    </button>
  )
}

interface DetailHeaderProps {
  heading: string
  headingRef: Ref<HTMLHeadingElement>
  onBack: () => void
}

function DetailHeader({ heading, headingRef, onBack }: DetailHeaderProps) {
  return (
    <div>
      <Button
        variant="ghost"
        className="min-h-[44px]"
        icon={<ChevronLeft size={16} aria-hidden="true" />}
        onClick={onBack}
      >
        Share
      </Button>
      <h3 ref={headingRef} tabIndex={-1} className="text-base font-bold text-ui-text outline-none">
        {heading}
      </h3>
    </div>
  )
}

export default function ShareMenuModal(props: ShareMenuModalProps) {
  if (!props.isOpen) return null
  return <ShareMenuContent {...props} />
}

function ShareMenuContent({ session, songsData, isOpen, onClose }: ShareMenuModalProps) {
  const [view, setView] = useState<ShareView>('list')
  const [liveActive, setLiveActive] = useState(false)
  const [lyricsActive, setLyricsActive] = useState(false)
  const liveHeadingRef = useRef<HTMLHeadingElement>(null)
  const lyricsHeadingRef = useRef<HTMLHeadingElement>(null)
  const liveRowRef = useRef<HTMLButtonElement>(null)
  const lyricsRowRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<ShareView | null>(null)
  const reduceMotion = useReducedMotion()
  const isFollowed = Boolean(session.liveSourceId)

  useEffect(() => {
    if (view === 'list') {
      const target = returnFocusRef.current
      returnFocusRef.current = null
      if (target === 'live') liveRowRef.current?.focus()
      if (target === 'lyrics') lyricsRowRef.current?.focus()
      return
    }
    const heading = view === 'live' ? liveHeadingRef : lyricsHeadingRef
    heading.current?.focus()
  }, [view])

  function viewMotion(active: boolean, offset: number) {
    if (reduceMotion) {
      return {
        initial: false,
        animate: { opacity: active ? 1 : 0 },
        transition: reducedMotionTransition,
      }
    }
    return {
      initial: false,
      animate: active ? { opacity: 1, x: 0 } : { opacity: 0, x: offset },
      transition: uiSpring,
    }
  }

  function handleBack() {
    returnFocusRef.current = view
    setView('list')
  }

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Share “${session.name}”`}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div>
        <motion.div hidden={view !== 'list'} {...viewMotion(view === 'list', -24)}>
          <div className="space-y-5">
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-ui-text-muted">
                Full set
              </h3>
              <p className="mt-1 text-xs text-ui-text-muted">Share with other musicians</p>
              <div className="mt-2 rounded-xl border border-ui-border bg-ui-surface">
                {isFollowed ? (
                  <div className="space-y-3 p-3">
                    <p className="text-xs leading-5 text-ui-text-muted">
                      This set follows someone else&rsquo;s live share.
                    </p>
                    <ShareSetPanel session={session} canShareLive={false} />
                  </div>
                ) : (
                  <>
                    <div className="px-3 py-3">
                      <SendCopyRow session={session} canShareLive />
                    </div>
                    <div className="border-t border-ui-border">
                      <ShareRow
                        title="Share live"
                        description="They see your changes as you make them."
                        active={liveActive}
                        onClick={() => setView('live')}
                        buttonRef={liveRowRef}
                      />
                    </div>
                  </>
                )}
              </div>
            </section>

            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-ui-text-muted">
                Lyrics
              </h3>
              <p className="mt-1 text-xs text-ui-text-muted">For people to follow along</p>
              <div className="mt-2 rounded-xl border border-ui-border bg-ui-surface">
                <ShareRow
                  title="Lyrics link"
                  description="Words only. Updates when you change the set."
                  active={lyricsActive}
                  onClick={() => setView('lyrics')}
                  buttonRef={lyricsRowRef}
                />
              </div>
            </section>
          </div>
        </motion.div>

        {!isFollowed && (
          <motion.div hidden={view !== 'live'} {...viewMotion(view === 'live', 24)}>
            <DetailHeader heading="Share live" headingRef={liveHeadingRef} onBack={handleBack} />
            <div className="mt-3">
              <ShareSetPanel session={session} canShareLive onActiveChange={setLiveActive} />
            </div>
          </motion.div>
        )}

        <motion.div hidden={view !== 'lyrics'} {...viewMotion(view === 'lyrics', 24)}>
          <DetailHeader heading="Lyrics link" headingRef={lyricsHeadingRef} onBack={handleBack} />
          <div className="mt-3">
            <ShareLyricsLinkPanel
              session={session}
              songsData={songsData}
              onActiveChange={setLyricsActive}
            />
          </div>
        </motion.div>
      </div>
    </OverlayDialog>
  )
}
