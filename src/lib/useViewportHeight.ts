import { useEffect, useState } from 'react'

/** Window height in CSS pixels, re-read on resize. The fit hook debounces its own refit. */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() =>
    typeof window === 'undefined' ? 1080 : window.innerHeight,
  )

  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return height
}
