import admin from 'firebase-admin'
import type { TestUser } from '../fixtures/test-users'

const PROJECT_ID = process.env.E2E_FIREBASE_PROJECT_ID ?? 'bantang-e2e'
const EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3101'

let initialized = false

function ensureAdmin(): admin.app.App {
  if (!initialized) {
    // Admin SDK auto-uses emulator when FIREBASE_AUTH_EMULATOR_HOST is set.
    process.env.FIREBASE_AUTH_EMULATOR_HOST = EMULATOR_HOST
    admin.initializeApp({ projectId: PROJECT_ID })
    initialized = true
  }
  return admin.app()
}

const SELF_ASSIGNABLE = new Set(['leader', 'junior_leader', 'member'])

/**
 * Ensure user exists in Auth Emulator and — for elevated roles that the server
 * refuses to self-assign on first login — pre-seed the MongoDB user document
 * via the emulator-gated /api/_test/seed-user endpoint. Then mint a custom
 * token so the frontend can sign in.
 */
export async function mintE2EToken(user: TestUser): Promise<string> {
  ensureAdmin()
  const auth = admin.auth()
  try {
    await auth.getUser(user.uid)
  } catch {
    await auth.createUser({
      uid: user.uid,
      email: user.email,
      displayName: user.name,
    })
  }

  if (!SELF_ASSIGNABLE.has(user.role)) {
    const res = await fetch(`${API_URL}/api/_test/seed-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
      }),
    })
    if (!res.ok) {
      throw new Error(`Failed to seed elevated user ${user.uid}: ${res.status}`)
    }
  }

  return auth.createCustomToken(user.uid, { intentRole: user.role })
}

/** Wipe all Auth Emulator accounts — call between tests to get a clean slate. */
export async function resetAuthEmulator(): Promise<void> {
  const res = await fetch(
    `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' },
  )
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to reset Auth Emulator: ${res.status}`)
  }
}
