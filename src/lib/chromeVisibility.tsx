import { createContext, useContext } from 'react'

export interface ChromeVisibilityValue {
  hidden: boolean
  setHidden: (hidden: boolean) => void
}

const noop = () => {}

export const ChromeVisibilityContext = createContext<ChromeVisibilityValue>({
  hidden: false,
  setHidden: noop,
})

export function useChromeVisibility(): ChromeVisibilityValue {
  return useContext(ChromeVisibilityContext)
}
