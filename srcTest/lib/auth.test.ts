// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { del as idbDel, set as idbSet } from 'idb-keyval'

const standin = vi.hoisted(() => ({
  authLoaded: false,
  user: null as null | {
    uid: string
    email: string | null
    displayName: string | null
    providerData?: Array<{ providerId: string }>
    getIdToken?: (forceRefresh?: boolean) => Promise<string>
  },
  popupError: null as null | { code: string },
  redirectResult: null as null | { user: unknown },
  emailLinkValid: true,
  lastSendLink: null as null | { email: string; options: unknown },
  calls: {
    signInWithPopup: 0,
    signInWithRedirect: 0,
    reauthenticateWithPopup: 0,
    reauthenticateWithRedirect: 0,
    sendSignInLinkToEmail: 0,
    signInWithEmailLink: 0,
    signOut: 0,
    onAuthStateChanged: 0,
    unsubscribe: 0,
  },
}))

const standalone = vi.hoisted(() => ({ value: false }))

vi.mock('../../src/lib/standalone', () => ({
  isStandalone: () => standalone.value,
}))

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }))

vi.mock('firebase/app', () => ({
  getApps: () => [{}],
  initializeApp: () => ({}),
}))

vi.mock('firebase/auth', () => {
  standin.authLoaded = true
  class GoogleAuthProvider {}
  const watchers = new Set<(user: unknown) => void>()
  return {
    GoogleAuthProvider,
    getAuth: () => ({
      get currentUser() {
        return standin.user
      },
    }),
    connectAuthEmulator: vi.fn(),
    getRedirectResult: async () => standin.redirectResult,
    onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
      standin.calls.onAuthStateChanged += 1
      watchers.add(callback)
      callback(standin.user)
      return () => {
        watchers.delete(callback)
        standin.calls.unsubscribe += 1
      }
    },
    signInWithPopup: async () => {
      standin.calls.signInWithPopup += 1
      if (standin.popupError) throw standin.popupError
      standin.user = { uid: 'u1', email: 'phil@example.com', displayName: null }
      for (const watcher of watchers) watcher(standin.user)
      return { user: standin.user }
    },
    signInWithRedirect: async () => {
      standin.calls.signInWithRedirect += 1
    },
    reauthenticateWithPopup: async () => {
      standin.calls.reauthenticateWithPopup += 1
      if (standin.popupError) throw standin.popupError
      return { user: standin.user }
    },
    reauthenticateWithRedirect: async () => {
      standin.calls.reauthenticateWithRedirect += 1
    },
    sendSignInLinkToEmail: async (_auth: unknown, email: string, options: unknown) => {
      standin.calls.sendSignInLinkToEmail += 1
      standin.lastSendLink = { email, options }
    },
    isSignInWithEmailLink: () => standin.emailLinkValid,
    signInWithEmailLink: async () => {
      standin.calls.signInWithEmailLink += 1
      standin.user = { uid: 'u1', email: 'phil@example.com', displayName: null }
      return { user: standin.user }
    },
    signOut: async () => {
      standin.calls.signOut += 1
    },
  }
})

const link = `${location.origin}/sign-in?apiKey=demo&oobCode=code&mode=signIn`

function resetStandin() {
  standin.authLoaded = false
  standin.user = null
  standin.popupError = null
  standin.redirectResult = null
  standin.emailLinkValid = true
  standin.lastSendLink = null
  for (const key of Object.keys(standin.calls) as Array<keyof typeof standin.calls>) {
    standin.calls[key] = 0
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  resetStandin()
  standalone.value = false
})

afterEach(() => vi.unstubAllEnvs())

async function authModule() {
  return import('../../src/lib/auth')
}

describe('loading firebase auth', () => {
  it('does not load when there is no sign-in marker', async () => {
    const auth = await authModule()
    const callback = vi.fn()

    auth.onUser(callback)

    expect(callback).toHaveBeenCalledWith(null)
    expect(standin.authLoaded).toBe(false)
  })

  it('loads and watches the user when the marker says this device signed in', async () => {
    standin.user = { uid: 'u1', email: 'phil@example.com', displayName: null }
    localStorage.setItem('account_signed_in', '1')
    const auth = await authModule()
    const callback = vi.fn()

    const unsubscribe = auth.onUser(callback)

    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith({
        uid: 'u1',
        email: 'phil@example.com',
        displayName: null,
      }),
    )
    expect(standin.calls.onAuthStateChanged).toBe(1)
    unsubscribe()
    expect(standin.calls.unsubscribe).toBe(1)
  })

  it('tells a watcher about a first sign-in on this device', async () => {
    const auth = await authModule()
    const callback = vi.fn()
    auth.onUser(callback)
    expect(callback).toHaveBeenLastCalledWith(null)

    await auth.signInWithGoogle()

    await vi.waitFor(() =>
      expect(callback).toHaveBeenLastCalledWith({
        uid: 'u1',
        email: 'phil@example.com',
        displayName: null,
      }),
    )
  })
})

describe('signInWithGoogle', () => {
  it('uses a popup and marks the device as signed in', async () => {
    const auth = await authModule()

    const result = await auth.signInWithGoogle()

    expect(result).toEqual({ status: 'done' })
    expect(standin.calls.signInWithPopup).toBe(1)
    expect(standin.calls.signInWithRedirect).toBe(0)
    expect(localStorage.getItem('account_signed_in')).toBe('1')
  })

  it('falls back to redirect when the popup is blocked', async () => {
    standin.popupError = { code: 'auth/popup-blocked' }
    const auth = await authModule()

    const result = await auth.signInWithGoogle()

    expect(result).toEqual({ status: 'redirect' })
    expect(standin.calls.signInWithPopup).toBe(1)
    expect(standin.calls.signInWithRedirect).toBe(1)
  })

  it('goes straight to redirect in the installed app', async () => {
    standalone.value = true
    const auth = await authModule()

    const result = await auth.signInWithGoogle()

    expect(result).toEqual({ status: 'redirect' })
    expect(standin.calls.signInWithPopup).toBe(0)
    expect(standin.calls.signInWithRedirect).toBe(1)
  })

  it('reports a closed popup as cancelled, not an error', async () => {
    standin.popupError = { code: 'auth/popup-closed-by-user' }
    const auth = await authModule()

    expect(await auth.signInWithGoogle()).toEqual({ status: 'cancelled' })
  })

  it('opens the popup synchronously in the click turn once auth is loaded', async () => {
    const auth = await authModule()
    await auth.loadAuth()

    const pending = auth.signInWithGoogle()

    expect(standin.calls.signInWithPopup).toBe(1)
    expect(await pending).toEqual({ status: 'done' })
  })
})

describe('email links', () => {
  it('sends the link to the sign-in route and remembers the email', async () => {
    const auth = await authModule()

    const result = await auth.sendEmailLink(' phil@example.com ')

    expect(result).toEqual({ ok: true })
    expect(localStorage.getItem('account_email_for_sign_in')).toBe('phil@example.com')
    expect(standin.calls.sendSignInLinkToEmail).toBe(1)
    expect(standin.lastSendLink).toEqual({
      email: 'phil@example.com',
      options: { url: `${location.origin}/sign-in`, handleCodeInApp: true },
    })
  })

  it('completes the link with the email saved on this device', async () => {
    localStorage.setItem('account_email_for_sign_in', 'phil@example.com')
    const auth = await authModule()

    const result = await auth.completeEmailLink(link)

    expect(result).toEqual({ status: 'signed-in' })
    expect(standin.calls.signInWithEmailLink).toBe(1)
    expect(localStorage.getItem('account_email_for_sign_in')).toBeNull()
    expect(localStorage.getItem('account_signed_in')).toBe('1')
  })

  it('asks for the email when another device opened the link', async () => {
    const auth = await authModule()

    const result = await auth.completeEmailLink(link)

    expect(result).toEqual({ status: 'email-needed' })
    expect(standin.calls.signInWithEmailLink).toBe(0)
  })

  it('completes the link with an email typed on the other device', async () => {
    const auth = await authModule()

    const result = await auth.completeEmailLink(link, 'other@example.com')

    expect(result).toEqual({ status: 'signed-in' })
    expect(standin.calls.signInWithEmailLink).toBe(1)
  })

  it('says when the address is not a sign-in link', async () => {
    standin.emailLinkValid = false
    const auth = await authModule()

    expect(await auth.completeEmailLink('http://localhost:3000/')).toEqual({
      status: 'invalid',
    })
  })
})

describe('signOut', () => {
  it('clears the marker and leaves local sets alone', async () => {
    localStorage.setItem('account_signed_in', '1')
    const auth = await authModule()

    const result = await auth.signOut()

    expect(result).toEqual({ ok: true })
    expect(standin.calls.signOut).toBe(1)
    expect(localStorage.getItem('account_signed_in')).toBeNull()
    expect(idbSet).not.toHaveBeenCalled()
    expect(idbDel).not.toHaveBeenCalled()
  })
})

describe('getIdToken', () => {
  it('returns the token when signed in', async () => {
    const getToken = vi.fn().mockResolvedValue('token-123')
    standin.user = {
      uid: 'u1',
      email: 'phil@example.com',
      displayName: null,
      getIdToken: getToken,
    }
    const auth = await authModule()

    expect(await auth.getIdToken()).toBe('token-123')
    expect(getToken).toHaveBeenCalledWith(true)
  })

  it('throws when signed out', async () => {
    const auth = await authModule()

    await expect(auth.getIdToken()).rejects.toThrow('Sign in to use your account.')
  })
})

describe('reauthenticate', () => {
  it('uses a Google popup when signed in with Google', async () => {
    standin.user = {
      uid: 'u1',
      email: 'phil@example.com',
      displayName: null,
      providerData: [{ providerId: 'google.com' }],
    }
    const auth = await authModule()

    expect(await auth.reauthenticate()).toEqual({ status: 'done' })
    expect(standin.calls.reauthenticateWithPopup).toBe(1)
    expect(standin.calls.reauthenticateWithRedirect).toBe(0)
  })

  it('falls back to redirect and sets account_redirect_pending when the popup is blocked', async () => {
    standin.user = {
      uid: 'u1',
      email: 'phil@example.com',
      displayName: null,
      providerData: [{ providerId: 'google.com' }],
    }
    standin.popupError = { code: 'auth/popup-blocked' }
    const auth = await authModule()

    expect(await auth.reauthenticate()).toEqual({ status: 'redirect' })
    expect(standin.calls.reauthenticateWithPopup).toBe(1)
    expect(standin.calls.reauthenticateWithRedirect).toBe(1)
    expect(localStorage.getItem('account_redirect_pending')).toBe('1')
  })

  it('goes straight to redirect in the installed app', async () => {
    standalone.value = true
    standin.user = {
      uid: 'u1',
      email: 'phil@example.com',
      displayName: null,
      providerData: [{ providerId: 'google.com' }],
    }
    const auth = await authModule()

    expect(await auth.reauthenticate()).toEqual({ status: 'redirect' })
    expect(standin.calls.reauthenticateWithPopup).toBe(0)
    expect(standin.calls.reauthenticateWithRedirect).toBe(1)
    expect(localStorage.getItem('account_redirect_pending')).toBe('1')
  })

  it('reports a closed popup as cancelled', async () => {
    standin.user = {
      uid: 'u1',
      email: 'phil@example.com',
      displayName: null,
      providerData: [{ providerId: 'google.com' }],
    }
    standin.popupError = { code: 'auth/popup-closed-by-user' }
    const auth = await authModule()

    expect(await auth.reauthenticate()).toEqual({ status: 'cancelled' })
  })

  it('sends an email link and returns link-sent for an email-link user', async () => {
    standin.user = {
      uid: 'u1',
      email: 'phil@example.com',
      displayName: null,
      providerData: [{ providerId: 'password' }],
    }
    const auth = await authModule()

    expect(await auth.reauthenticate()).toEqual({ status: 'link-sent' })
    expect(standin.calls.sendSignInLinkToEmail).toBe(1)
    expect(localStorage.getItem('account_email_for_sign_in')).toBe('phil@example.com')
  })
})
