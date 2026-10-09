/**
 * Detects whether the current device is a mobile device or tablet (such as an iPad, iPhone, or Android device).
 * On mobile and tablet devices, programmatically focusing an input summons the device's virtual on-screen keyboard,
 * which takes up substantial screen real estate and is unnecessary when custom interactive controls
 * (such as ChordKeyboard) are provided.
 */
export function isMobileOrTablet(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }

  // Modern iPad detection:
  // iPadOS 13+ Safari identifies its platform as 'MacIntel' by default for desktop parity,
  // but reports maxTouchPoints > 1 (usually 5 touch points).
  const isIPad =
    navigator.platform === 'MacIntel' &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1

  // Mobile / tablet user agent check (iPhone, iPad, iPod, Android, etc.)
  const isMobileUA =
    typeof navigator.userAgent === 'string' &&
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    )

  // Primary pointer is coarse (finger/touch screen) with active touch points
  const hasCoarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches

  const hasTouchPoints =
    typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0

  return isIPad || isMobileUA || (hasCoarsePointer && hasTouchPoints)
}
