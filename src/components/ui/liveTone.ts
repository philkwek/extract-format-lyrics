export type LiveTone = 'live' | 'reconnecting' | 'ended'

/** Border, surface and text for each live state: green live, amber reconnecting, neutral ended. */
export const liveToneClasses: Record<LiveTone, string> = {
  live: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-400',
  reconnecting:
    'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400',
  // Theme variables already switch with dark mode.
  ended:
    'border-[var(--ui-border)] bg-[var(--ui-surface-raised)] text-[var(--ui-text)] shadow-[var(--ui-shadow-sm)]',
}

/** The banner's button: tinted to match while live or reconnecting, the normal button once ended. */
export const liveToneButtonClasses: Record<LiveTone, string> = {
  live: 'ui-button--live',
  reconnecting: 'ui-button--reconnecting',
  ended: '',
}
