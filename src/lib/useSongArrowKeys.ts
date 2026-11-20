import { useEffect, useRef } from 'react'

/** Next song for an arrow key, or null at the ends. No wrap. */
export function getArrowSongIndex(key: string, activeIndex: number, count: number): number | null {
  if (count <= 0 || activeIndex < 0 || activeIndex >= count) return null
  if (key === 'ArrowRight') return activeIndex + 1 < count ? activeIndex + 1 : null
  if (key === 'ArrowLeft') return activeIndex - 1 >= 0 ? activeIndex - 1 : null
  return null
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('input, textarea, select')) return true
  const editable = target.closest<HTMLElement>('[contenteditable]')
  return editable !== null && editable.getAttribute('contenteditable') !== 'false'
}

interface Options {
  enabled: boolean
  count: number
  activeIndex: number
  onSelect: (index: number) => void
}

/** Left/right arrows move through the set, wherever focus is on the page. */
export function useSongArrowKeys({ enabled, count, activeIndex, onSelect }: Options) {
  const latest = useRef({ count, activeIndex, onSelect })
  useEffect(() => {
    latest.current = { count, activeIndex, onSelect }
  })

  useEffect(() => {
    if (!enabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      // A focused song tab already handles the arrow itself.
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (isTypingTarget(event.target)) return
      if (document.querySelector('[aria-modal="true"]')) return

      const { count, activeIndex, onSelect } = latest.current
      const nextIndex = getArrowSongIndex(event.key, activeIndex, count)
      if (nextIndex === null) return
      event.preventDefault()
      onSelect(nextIndex)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
}
