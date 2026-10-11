export const uiSpring = {
  type: 'spring' as const,
  bounce: 0,
  duration: 0.38,
}

export const momentumSpring = {
  type: 'spring' as const,
  bounce: 0.18,
  duration: 0.34,
}

export const reducedMotionTransition = {
  duration: 0.16,
  ease: 'easeOut' as const,
}

export function getDialogMotion(reduceMotion: boolean) {
  return reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: reducedMotionTransition,
      }
    : {
        initial: { opacity: 0, scale: 0.96, y: 12, filter: 'blur(7px)' },
        animate: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' },
        exit: { opacity: 0, scale: 0.97, y: 8, filter: 'blur(5px)' },
        transition: uiSpring,
      }
}
