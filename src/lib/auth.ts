import { accountsEnabled } from './accountFlag'
import { firebaseConfig, parseEmulatorHost } from './firestoreClient'
import { isStandalone } from './standalone'

export const SIGNED_IN_MARKER = 'account_signed_in'
export const EMAIL_STORAGE_KEY = 'account_email_for_sign_in'
const REDIRECT_PENDING_MARKER = 'account_redirect_pending'

export interface AccountUser {
  uid: string
  email: string | null
  displayName: string | null
}

export type SignInResult =
  | { status: 'done' }
  | { status: 'redirect' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export type AuthResult = { ok: true } | { ok: false; message: string }

export type ReauthResult =
  | { status: 'done' }
  | { status: 'redirect' }
  | { status: 'link-sent' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export type EmailLinkResult =
  | { status: 'signed-in' }
  | { status: 'email-needed' }
  | { status: 'invalid' }
  | { status: 'error'; message: string }

function markSignedIn() {
  localStorage.setItem(SIGNED_IN_MARKER, '1')
}

function hasSignInIntent() {
  return (
    localStorage.getItem(SIGNED_IN_MARKER) !== null ||
    localStorage.getItem(REDIRECT_PENDING_MARKER) !== null
  )
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return String((error as { code: unknown }).code)
}

function plainAuthError(code: string | undefined): string {
  switch (code) {
    case 'auth/invalid-email':
      return "That email address doesn't look right."
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':
      return 'This sign-in link has expired or was already used. Send a new one.'
    case 'auth/network-request-failed':
      return 'The connection dropped. Try again.'
    case 'auth/too-many-requests':
      return 'Too many tries. Wait a moment and try again.'
    case 'auth/operation-not-allowed':
      return "That sign-in method isn't available right now."
    default:
      return 'Something went wrong. Try again.'
  }
}

async function createAuth() {
  const [{ getApps, initializeApp }, api] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
  ])
  const app = getApps()[0] ?? initializeApp(firebaseConfig()!)
  const auth = api.getAuth(app)
  const emulator = import.meta.env.DEV
    ? parseEmulatorHost(import.meta.env.VITE_AUTH_EMULATOR_HOST)
    : null
  if (emulator) api.connectAuthEmulator(auth, `http://${emulator.host}:${emulator.port}`)

  await api
    .getRedirectResult(auth)
    .then((result) => {
      if (result?.user) markSignedIn()
    })
    .catch(() => {})
    .finally(() => localStorage.removeItem(REDIRECT_PENDING_MARKER))

  return { auth, api }
}

let authReady: ReturnType<typeof createAuth> | undefined
// onUser watchers that started before auth was loaded; they attach once anything loads it.
const waitingForAuth = new Set<() => void>()

export function loadAuth() {
  authReady ??= createAuth().catch((error) => {
    authReady = undefined
    throw error
  })
  const waiting = [...waitingForAuth]
  waitingForAuth.clear()
  for (const start of waiting) start()
  return authReady
}

export async function signInWithGoogle(): Promise<SignInResult> {
  let loaded: Awaited<ReturnType<typeof createAuth>>
  try {
    loaded = await loadAuth()
  } catch {
    return { status: 'error', message: plainAuthError(undefined) }
  }
  const { auth, api } = loaded
  const provider = new api.GoogleAuthProvider()

  const startRedirect = async (): Promise<SignInResult> => {
    localStorage.setItem(REDIRECT_PENDING_MARKER, '1')
    try {
      await api.signInWithRedirect(auth, provider)
      return { status: 'redirect' }
    } catch (error) {
      localStorage.removeItem(REDIRECT_PENDING_MARKER)
      return { status: 'error', message: plainAuthError(errorCode(error)) }
    }
  }

  if (isStandalone()) return startRedirect()

  try {
    await api.signInWithPopup(auth, provider)
    markSignedIn()
    return { status: 'done' }
  } catch (error) {
    const code = errorCode(error)
    if (code === 'auth/popup-blocked') return startRedirect()
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return { status: 'cancelled' }
    }
    return { status: 'error', message: plainAuthError(code) }
  }
}

export async function sendEmailLink(email: string): Promise<AuthResult> {
  const address = email.trim()
  if (!address) return { ok: false, message: 'Enter your email address.' }

  try {
    const { auth, api } = await loadAuth()
    await api.sendSignInLinkToEmail(auth, address, {
      url: `${location.origin}/sign-in`,
      handleCodeInApp: true,
    })
    localStorage.setItem(EMAIL_STORAGE_KEY, address)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: plainAuthError(errorCode(error)) }
  }
}

export async function completeEmailLink(href: string, email?: string): Promise<EmailLinkResult> {
  let loaded: Awaited<ReturnType<typeof createAuth>>
  try {
    loaded = await loadAuth()
  } catch {
    return { status: 'error', message: plainAuthError(undefined) }
  }
  const { auth, api } = loaded

  if (!api.isSignInWithEmailLink(auth, href)) return { status: 'invalid' }

  const address = (email ?? localStorage.getItem(EMAIL_STORAGE_KEY) ?? '').trim()
  if (!address) return { status: 'email-needed' }

  try {
    await api.signInWithEmailLink(auth, address, href)
    localStorage.removeItem(EMAIL_STORAGE_KEY)
    markSignedIn()
    return { status: 'signed-in' }
  } catch (error) {
    return { status: 'error', message: plainAuthError(errorCode(error)) }
  }
}

export async function signOut(): Promise<AuthResult> {
  try {
    const { auth, api } = await loadAuth()
    await api.signOut(auth)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: plainAuthError(errorCode(error)) }
  } finally {
    localStorage.removeItem(SIGNED_IN_MARKER)
    localStorage.removeItem(REDIRECT_PENDING_MARKER)
  }
}

/** The signed-in user's token. Throws when nobody is signed in. */
export async function getIdToken(): Promise<string> {
  const { auth } = await loadAuth()
  if (!auth.currentUser) throw new Error('Sign in to use your account.')
  return auth.currentUser.getIdToken(true)
}

/** Signs the person in again, with a Google popup or a fresh email link. */
export async function reauthenticate(): Promise<ReauthResult> {
  let loaded: Awaited<ReturnType<typeof createAuth>>
  try {
    loaded = await loadAuth()
  } catch {
    return { status: 'error', message: plainAuthError(undefined) }
  }
  const { auth, api } = loaded
  const current = auth.currentUser
  if (!current) return { status: 'error', message: plainAuthError(undefined) }

  const usesGoogle = current.providerData.some((provider) => provider.providerId === 'google.com')
  if (usesGoogle) {
    const provider = new api.GoogleAuthProvider()
    const startRedirect = async (): Promise<ReauthResult> => {
      localStorage.setItem(REDIRECT_PENDING_MARKER, '1')
      try {
        await api.reauthenticateWithRedirect(current, provider)
        return { status: 'redirect' }
      } catch (error) {
        localStorage.removeItem(REDIRECT_PENDING_MARKER)
        return { status: 'error', message: plainAuthError(errorCode(error)) }
      }
    }

    if (isStandalone()) return startRedirect()

    try {
      await api.reauthenticateWithPopup(current, provider)
      return { status: 'done' }
    } catch (error) {
      const code = errorCode(error)
      if (code === 'auth/popup-blocked') return startRedirect()
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return { status: 'cancelled' }
      }
      return { status: 'error', message: plainAuthError(code) }
    }
  }

  if (!current.email) return { status: 'error', message: plainAuthError(undefined) }
  const sent = await sendEmailLink(current.email)
  if (!sent.ok) return { status: 'error', message: sent.message }
  return { status: 'link-sent' }
}

export function onUser(callback: (user: AccountUser | null) => void): () => void {
  if (!accountsEnabled()) {
    callback(null)
    return () => {}
  }

  let cancelled = false
  let unsubscribe: (() => void) | undefined

  const start = () => {
    loadAuth()
      .then(({ auth, api }) => {
        if (cancelled) return
        unsubscribe = api.onAuthStateChanged(auth, (user) => {
          if (user) markSignedIn()
          callback(
            user
              ? { uid: user.uid, email: user.email, displayName: user.displayName ?? null }
              : null,
          )
        })
      })
      .catch(() => {
        if (!cancelled) callback(null)
      })
  }

  if (hasSignInIntent() || authReady) {
    start()
  } else {
    callback(null)
    waitingForAuth.add(start)
  }

  return () => {
    cancelled = true
    waitingForAuth.delete(start)
    unsubscribe?.()
  }
}
