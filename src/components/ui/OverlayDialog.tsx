import { useId, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { GripHorizontal, X } from 'lucide-react'
import { classes } from '../../lib/classes'
import { getDialogMotion, reducedMotionTransition } from '../../lib/uiMotion'
import { IconButton } from './index'
import { useModalFocus } from './useModalFocus'
import { useSheetDrag } from './useSheetDrag'

interface OverlayDialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  className?: string
  contentClassName?: string
  closeOnBackdrop?: boolean
}

export default function OverlayDialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  contentClassName,
  closeOnBackdrop = true,
}: OverlayDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const { panelMotion, dragProps, onPointerDown } = useSheetDrag(onClose)
  const dialogMotion = panelMotion ?? getDialogMotion(Boolean(reduceMotion))
  const handleKeyDown = useModalFocus(isOpen, panelRef, onClose)

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="ui-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? reducedMotionTransition : { duration: 0.2 }}
          onMouseDown={(event) => {
            if (closeOnBackdrop && event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            className={classes('ui-dialog', `ui-dialog--${size}`, className)}
            {...dragProps}
            initial={dialogMotion.initial}
            animate={dialogMotion.animate}
            exit={dialogMotion.exit}
            transition={dialogMotion.transition}
            onKeyDown={handleKeyDown}
          >
            <div
              aria-hidden="true"
              onPointerDown={onPointerDown}
              className="flex h-7 shrink-0 touch-none items-center justify-center sm:hidden"
            >
              <GripHorizontal size={25} className="text-ui-text-muted" />
            </div>
            <header className="ui-dialog__header touch-none" onPointerDown={onPointerDown}>
              <div className="min-w-0">
                <h2 id={titleId} className="ui-dialog__title">
                  {title}
                </h2>
                {description && (
                  <p id={descriptionId} className="ui-dialog__description">
                    {description}
                  </p>
                )}
              </div>
              <IconButton label="Close" variant="ghost" onClick={onClose}>
                <X size={18} strokeWidth={2} />
              </IconButton>
            </header>
            <div className={classes('ui-dialog__content overscroll-contain', contentClassName)}>
              {children}
            </div>
            {footer && <footer className="ui-dialog__footer">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
