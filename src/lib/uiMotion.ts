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
