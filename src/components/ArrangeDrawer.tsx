import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowDown, ArrowUp, GripHorizontal, Trash2, X } from 'lucide-react'
import { momentumSpring, reducedMotionTransition } from '../lib/uiMotion'
import { Button, IconButton } from './ui'
import { useModalFocus } from './ui/useModalFocus'
import { useSheetDrag } from './ui/useSheetDrag'

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
  const { panelMotion, dragProps, onPointerDown } = useSheetDrag(onClose)
  const desktopMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: reducedMotionTransition,
      }
    : {
        initial: { opacity: 0, y: 18, scale: 0.97 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 16, scale: 0.98 },
        transition: momentumSpring,
      }
  const sheetMotion = panelMotion ?? desktopMotion
  const [moveFeedback, setMoveFeedback] = useState<{
    itemId: string
    direction: 'up' | 'down'
  } | null>(null)
  const handlePanelKeyDown = useModalFocus(isOpen, panelRef, onClose)

  useEffect(() => {
    if (!moveFeedback) return
    const timeout = window.setTimeout(() => setMoveFeedback(null), 420)
    return () => window.clearTimeout(timeout)
  }, [moveFeedback])

  const moveItem = (fromIndex: number, toIndex: number) => {
    const item = items[fromIndex]
    if (!item || fromIndex === toIndex) return
    setMoveFeedback({ itemId: item.id, direction: toIndex < fromIndex ? 'up' : 'down' })
    onMove(fromIndex, toIndex)
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
            {...dragProps}
            initial={sheetMotion.initial}
            animate={sheetMotion.animate}
            exit={sheetMotion.exit}
            transition={sheetMotion.transition}
            onKeyDown={handlePanelKeyDown}
            className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.35rem] border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] text-[var(--ui-text)] shadow-[var(--ui-shadow-lg)] outline-none sm:rounded-[1.35rem]"
          >
            <div
              aria-hidden="true"
              onPointerDown={onPointerDown}
              className="flex h-7 shrink-0 touch-none items-center justify-center sm:hidden"
            >
              <GripHorizontal size={25} className="text-[var(--ui-text-muted)]" />
            </div>
            <header
              onPointerDown={onPointerDown}
              className="flex touch-none items-start justify-between gap-3 border-b border-[var(--ui-border)] px-4 pt-1 pb-3 sm:pt-4"
            >
              <div className="min-w-0">
                <h2 id={titleId} className="text-base font-bold tracking-[-0.02em]">
                  {title}
                </h2>
                {subtitle && (
                  <p className="mt-1 truncate text-xs text-[var(--ui-text-muted)]">{subtitle}</p>
                )}
              </div>
              <IconButton label="Close" variant="ghost" onClick={onClose}>
                <X size={17} />
              </IconButton>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {items.length === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--ui-text-muted)]">
                  No items to arrange.
                </div>
              ) : (
                items.map((item, idx) => (
                  <motion.div
                    key={item.id}
                    layout="position"
                    initial={false}
                    animate={
                      moveFeedback?.itemId === item.id && !reduceMotion
                        ? { scale: [1, 1.018, 1] }
                        : { scale: 1 }
                    }
                    transition={
                      reduceMotion
                        ? reducedMotionTransition
                        : {
                            layout: { type: 'spring', stiffness: 520, damping: 38, mass: 0.65 },
                            scale: { duration: 0.28, ease: 'easeOut' },
                          }
                    }
                    data-move-direction={
                      moveFeedback?.itemId === item.id ? moveFeedback.direction : undefined
                    }
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="bg-ui-accent/10 text-ui-accent-strong flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg px-2 font-mono text-xs font-bold">
                        {item.badge || `#${idx + 1}`}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{item.title}</p>
                        {item.subtitle && (
                          <p className="mt-0.5 truncate text-xs text-[var(--ui-text-muted)]">
                            {item.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <IconButton
                        label={`Move ${item.title} up`}
                        variant="ghost"
                        disabled={idx === 0}
                        onClick={() => moveItem(idx, idx - 1)}
                      >
                        <ArrowUp size={16} />
                      </IconButton>
                      <IconButton
                        label={`Move ${item.title} down`}
                        variant="ghost"
                        disabled={idx === items.length - 1}
                        onClick={() => moveItem(idx, idx + 1)}
                      >
                        <ArrowDown size={16} />
                      </IconButton>
                      {onDelete && items.length > 1 && (
                        <IconButton
                          label={`Remove ${item.title}`}
                          variant="danger"
                          onClick={() => onDelete(idx)}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
            <footer className="border-t border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-4">
              <Button variant="primary" className="w-full" onClick={onClose}>
                Close
              </Button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
