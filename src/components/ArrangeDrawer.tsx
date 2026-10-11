import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowDown, ArrowUp, GripHorizontal, Trash2, X } from 'lucide-react'
import { momentumSpring, reducedMotionTransition } from '../lib/uiMotion'
import { Button, IconButton } from './ui'

export interface ArrangeItem {
  id: string
  title: string
  subtitle?: string
  badge?: string
}

interface ArrangeDrawerProps {
  isOpen: boolean
  title: string
  subtitle?: string
  items: ArrangeItem[]
  onMove: (fromIndex: number, toIndex: number) => void
  onDelete?: (index: number) => void
  onClose: () => void
}

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function ArrangeDrawer({
  isOpen,
  title,
  subtitle,
  items,
  onMove,
  onDelete,
  onClose,
}: ArrangeDrawerProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 639px)').matches)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)')
    const update = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus()
    })
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [isOpen, onClose])

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) return
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="ui-overlay sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? reducedMotionTransition : { duration: 0.2 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            drag={isMobile && !reduceMotion ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.34 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 700) onClose()
            }}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: isMobile ? '100%' : 18, scale: isMobile ? 1 : 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: isMobile ? '100%' : 16, scale: isMobile ? 1 : 0.98 }}
            transition={reduceMotion ? reducedMotionTransition : momentumSpring}
            onKeyDown={handlePanelKeyDown}
            className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.35rem] border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] text-[var(--ui-text)] shadow-[var(--ui-shadow-lg)] outline-none sm:rounded-[1.35rem]"
          >
            <div className="flex h-7 shrink-0 touch-none items-center justify-center sm:hidden" aria-hidden="true">
              <GripHorizontal size={25} className="text-[var(--ui-text-muted)]" />
            </div>
            <header className="flex items-start justify-between gap-3 border-b border-[var(--ui-border)] px-4 pb-3 pt-1 sm:pt-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-base font-bold tracking-[-0.02em]">{title}</h2>
                {subtitle && <p className="mt-1 truncate text-xs text-[var(--ui-text-muted)]">{subtitle}</p>}
              </div>
              <IconButton label="Close" variant="ghost" onClick={onClose}><X size={17} /></IconButton>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {items.length === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--ui-text-muted)]">No items to arrange.</div>
              ) : items.map((item, idx) => (
                <motion.div layout key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg bg-[#3368A0]/10 px-2 font-mono text-xs font-bold text-[#255283] dark:bg-amber-400/10 dark:text-amber-400">{item.badge || `#${idx + 1}`}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{item.title}</p>
                      {item.subtitle && <p className="mt-0.5 truncate text-xs text-[var(--ui-text-muted)]">{item.subtitle}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton label={`Move ${item.title} up`} variant="ghost" disabled={idx === 0} onClick={() => onMove(idx, idx - 1)}><ArrowUp size={16} /></IconButton>
                    <IconButton label={`Move ${item.title} down`} variant="ghost" disabled={idx === items.length - 1} onClick={() => onMove(idx, idx + 1)}><ArrowDown size={16} /></IconButton>
                    {onDelete && items.length > 1 && <IconButton label={`Remove ${item.title}`} variant="danger" onClick={() => onDelete(idx)}><Trash2 size={16} /></IconButton>}
                  </div>
                </motion.div>
              ))}
            </div>
            <footer className="border-t border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-4">
              <Button variant="primary" className="w-full" onClick={onClose}>Done</Button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
