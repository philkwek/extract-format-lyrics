import { describe, expect, it } from 'vitest'
import { getDialogMotion, reducedMotionTransition, uiSpring } from './uiMotion'

describe('getDialogMotion', () => {
  it('removes spatial movement and blur for reduced-motion users', () => {
    const motion = getDialogMotion(true)

    expect(motion.initial).toEqual({ opacity: 0 })
    expect(motion.animate).toEqual({ opacity: 1 })
    expect(motion.exit).toEqual({ opacity: 0 })
    expect(motion.transition).toBe(reducedMotionTransition)
  })

  it('uses the interruptible spring for standard motion', () => {
    const motion = getDialogMotion(false)

    expect(motion.initial).toMatchObject({ scale: 0.96, y: 12, filter: 'blur(7px)' })
    expect(motion.transition).toBe(uiSpring)
  })
})
