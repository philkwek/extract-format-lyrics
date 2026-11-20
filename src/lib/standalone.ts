/** True when the page is running as the installed app rather than a browser tab. */
export function isStandalone(win: Window = window): boolean {
  if (win.matchMedia?.('(display-mode: standalone)').matches) return true
  return (win.navigator as Navigator & { standalone?: boolean }).standalone === true
}
