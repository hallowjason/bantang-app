import { expect, test } from '@playwright/test'
import admin from 'firebase-admin'

/**
 * Regression test for the intentRole privilege-escalation fix.
 * A malicious client that mints a custom token claiming intentRole='head_leader'
 * must NOT be granted that role on first login — the server should downgrade
 * self-declared elevated roles to the safe default.
 */

const PROJECT_ID = 'bantang-e2e'
const EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099'
const API_URL = 'http://localhost:3101'

let initialized = false

function ensureAdmin() {
  if (initialized) return
  process.env.FIREBASE_AUTH_EMULATOR_HOST = EMULATOR_HOST
  admin.initializeApp({ projectId: PROJECT_ID })
  initialized = true
}

test('intentRole=head_leader on first login is downgraded to leader', async ({ page }) => {
  ensureAdmin()

  const uid = 'e2e-attacker-001'
  const auth = admin.auth()
  try { await auth.deleteUser(uid) } catch { /* not present */ }
  await auth.createUser({ uid, email: 'attacker@e2e.test', displayName: 'Attacker' })

  // Malicious custom token claiming elevated role
  const token = await auth.createCustomToken(uid, { intentRole: 'head_leader' })

  await page.goto(`/attendance?e2e_token=${encodeURIComponent(token)}`)
  await expect(page).toHaveURL(/\/attendance$/)
  // First-login call to /api/users/me completes async; wait for BottomNav as proof.
  await expect(page.locator('nav').getByText('點名')).toBeVisible()

  // Read the persisted user record directly from the test-only DB endpoint.
  const res = await fetch(`${API_URL}/api/_test/user/${uid}`)
  const body = await res.json()
  expect(body.success).toBe(true)
  expect(body.data.role).toBe('leader') // ← downgraded, NOT head_leader
})
