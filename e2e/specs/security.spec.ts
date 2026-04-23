import { expect, test } from '@playwright/test'
import admin from 'firebase-admin'
import { mintE2EToken } from '../helpers/auth'
import { TEST_USERS } from '../fixtures/test-users'
import { seedClass, uniqueClassId } from '../helpers/seed'

/**
 * Regression test for the intentRole privilege-escalation fix.
 * A malicious client that mints a custom token claiming intentRole='class_master'
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

test('intentRole=class_master on first login is downgraded to leader', async ({ page }) => {
  ensureAdmin()

  const uid = 'e2e-attacker-001'
  const auth = admin.auth()
  try { await auth.deleteUser(uid) } catch { /* not present */ }
  await auth.createUser({ uid, email: 'attacker@e2e.test', displayName: 'Attacker' })

  // Malicious custom token claiming elevated role
  const token = await auth.createCustomToken(uid, { intentRole: 'class_master' })

  await page.goto(`/attendance?e2e_token=${encodeURIComponent(token)}`)
  await expect(page).toHaveURL(/\/attendance$/)
  // First-login call to /api/users/me completes async; wait for BottomNav as proof.
  await expect(page.locator('nav').getByText('點名')).toBeVisible()

  // Read the persisted user record directly from the test-only DB endpoint.
  const res = await fetch(`${API_URL}/api/_test/user/${uid}`)
  const body = await res.json()
  expect(body.success).toBe(true)
  expect(body.data.role).toBe('leader') // ← downgraded, NOT class_master
  expect(body.data.isAdmin).not.toBe(true) // ← admin tag also not self-assignable
})

/**
 * 「調整班別代號」admin-only rule：iccfClassCode (B-number) 只能由主班 / 管理員
 * 透過 /admin → PUT /api/admin/classes/:id 編輯。領班 / 小班長 即便有合法 token
 * 也會在 requireTopAdmin 被擋。
 */
test('PUT /api/admin/classes/:id — leader without isAdmin is rejected', async () => {
  ensureAdmin()

  const classId = uniqueClassId('e2e-iccfcode')
  await seedClass(classId, 'E2E iccf 班代測試')

  // Leader 無 isAdmin，用合法 custom token 呼叫 PUT /api/admin/classes/:id
  const leaderToken = await mintE2EToken({
    ...TEST_USERS.leader,
    uid: `e2e-leader-iccfcode-${Date.now()}`,
    email: `leader-iccfcode-${Date.now()}@e2e.test`,
  })
  // Exchange custom token for an ID token via Auth Emulator REST endpoint.
  const idTokenRes = await fetch(
    `http://${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=e2e-fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: leaderToken, returnSecureToken: true }),
    },
  )
  const idTokenBody = await idTokenRes.json()
  const idToken = idTokenBody.idToken as string
  expect(idToken).toBeTruthy()

  const putRes = await fetch(`${API_URL}/api/admin/classes/${classId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ iccfClassCode: 'B9999999' }),
  })
  expect(putRes.status).toBe(403)

  // DB 未被改動：用同一個 token 呼叫讀取 class 端點確認 iccfClassCode 仍為空
  const getRes = await fetch(`${API_URL}/api/classes/${classId}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  })
  const getBody = await getRes.json()
  expect(getBody.data?.iccfClassCode ?? '').toBe('')
})
