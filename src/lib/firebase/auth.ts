import {
  GoogleAuthProvider,
  signInWithCustomToken,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { auth } from './config'

const googleProvider = new GoogleAuthProvider()

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(auth, googleProvider)
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth)
}

/**
 * E2E-only sign-in via custom token. Gated by DEV build + Auth Emulator host,
 * so this path cannot be triggered in production bundles.
 */
export async function signInWithE2EToken(token: string): Promise<void> {
  const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST
  if (!import.meta.env.DEV || !emulatorHost) {
    throw new Error('E2E sign-in is disabled outside dev + Auth Emulator')
  }
  await signInWithCustomToken(auth, token)
}
