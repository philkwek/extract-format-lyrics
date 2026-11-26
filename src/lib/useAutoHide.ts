import { useCallback, useEffect, useRef, useState } from 'react'

const HIDE_DELAY_MS = 800

/**
 * Corner controls that appear on mouse or touch activity and fade after a pause.
 * `hold` keeps them open (a menu is showing); `canHide` can veto a hide when it fires.
 */
export function useAutoHide({
  hold = false,
  canHide,
}: { hold?: boolean; canHide?: () => boolean } = {}) {
  const [visible, setVisible] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [activity, setActivity] = useState(0)
  const canHideRef = useRef(canHide)

  useEffect(() => {
    canHideRef.current = canHide
  })

  const bump = useCallback(() => setActivity((count) => count + 1), [])
  const show = useCallback(() => {
    setVisible(true)
    bump()
  }, [bump])

  useEffect(() => {
    window.addEventListener('mousemove', show)
    window.addEventListener('pointerdown', show)
    return () => {
      window.removeEventListener('mousemove', show)
      window.removeEventListener('pointerdown', show)
    }
  }, [show])

  useEffect(() => {
    if (!visible || hold || hovered) return
    const timer = window.setTimeout(() => {
      if (canHideRef.current?.() === false) return
      setVisible(false)
    }, HIDE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [visible, hold, hovered, activity])

  return {
    visible,
    show,
    bump,
    hoverProps: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    },
  }
}
