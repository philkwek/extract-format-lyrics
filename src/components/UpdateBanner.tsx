import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { RefreshCw, X } from 'lucide-react'
import { Button, IconButton, StatusBanner } from './ui'
import { reducedMotionTransition } from '../lib/uiMotion'

interface UpdateBannerProps {
  open: boolean
  onReload: () => void
  onDismiss: () => void
}

/** Says a newer build is out. It sits above the page and never reloads on its own. */
export default function UpdateBanner({ open, onReload, onDismiss }: UpdateBannerProps) {
  const reduceMotion = useReducedMotion()
  const hidden = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem+var(--song-tray-lift,0px))] z-30 flex justify-center px-4">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={hidden}
            animate={{ opacity: 1, y: 0 }}
            exit={hidden}
            transition={reducedMotionTransition}
            className="pointer-events-auto w-full max-w-lg"
          >
            <StatusBanner
              tone="info"
              className="ui-status--floating"
              icon={<RefreshCw size={15} />}
              title="New version available"
              actions={
                <>
                  <Button size="sm" variant="primary" onClick={onReload}>
                    Reload
                  </Button>
                  <IconButton label="Dismiss" variant="ghost" onClick={onDismiss}>
                    <X size={15} />
                  </IconButton>
                </>
              }
            >
              Reload to get the latest changes.
            </StatusBanner>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
