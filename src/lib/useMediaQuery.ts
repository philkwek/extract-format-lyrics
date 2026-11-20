import { useCallback, useSyncExternalStore } from 'react'

export const PHONE_PORTRAIT_QUERY = '(max-width: 639px)'
export const PHONE_LANDSCAPE_QUERY =
  '(min-width: 640px) and (max-height: 499px) and (pointer: coarse)'

export type FullScreenLayout = 'phone-portrait' | 'phone-landscape' | 'regular'

const canMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

/** Live `matchMedia` result; false where `matchMedia` is missing. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canMatchMedia()) return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = () => (canMatchMedia() ? window.matchMedia(query).matches : false)
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** Which full screen header applies; follows rotation without leaving full screen. */
export function useFullScreenLayout(): FullScreenLayout {
  const portrait = useMediaQuery(PHONE_PORTRAIT_QUERY)
  const landscape = useMediaQuery(PHONE_LANDSCAPE_QUERY)
  if (portrait) return 'phone-portrait'
  return landscape ? 'phone-landscape' : 'regular'
}
