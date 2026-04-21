import { expect, test, type Locator, type Page } from '@playwright/test'
import { mintE2EToken } from '../helpers/auth'
import { seedClass, seedMembers, uniqueClassId, type SeedMember } from '../helpers/seed'
import { TEST_USERS } from '../fixtures/test-users'

/**
 * Phase 3 — Members CRUD flow.
 *
 * Covers:
 *   1. 新增班員（最小必填：姓名）
 *   2. 新增班員（完整欄位）
 *   3. 編輯班員（姓名 + 備註）
 *   4. PUT allow-list：未列名欄位（iccfStatus）不被接受
 *   5. 長按移除（含原因必填驗證）
 *   6. 空狀態顯示
 *
 * Isolation: each test seeds a unique classId via `uniqueClassId('e2e-mem-*')`.
 * Leader user gets re-pinned to that class via mintE2EToken.
 */

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3101'
const EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099'
const VITE_API_KEY = 'e2e-fake-api-key'  // matches playwright.config.ts env

// ─── Setup ──────────────────────────────────────────────────────────────────

/** Sign in leader with a fresh class (+ optional members); land on /members. */
async function setupLeaderOnMembers(
  page: Page,
  members: SeedMember[] = [],
): Promise<{ classId: string }> {
  const classId = uniqueClassId('e2e-mem')
  await seedClass(classId, 'E2E Members Class')
  if (members.length > 0) await seedMembers(classId, members)

  const token = await mintE2EToken({ ...TEST_USERS.leader, classId })
  await page.goto(`/members?e2e_token=${encodeURIComponent(token)}`)
  await expect(page).toHaveURL(/\/members$/)
  await expect(page.getByRole('heading', { name: '班員管理' })).toBeVisible()
  return { classId }
}

// ─── Locators & helpers ─────────────────────────────────────────────────────

function memberCard(page: Page, name: string): Locator {
  return page.locator('li').filter({ hasText: name }).locator('button').first()
}

/** Trigger the 600ms long-press by dispatching pointerdown without pointerup. */
async function longPress(locator: Locator, holdMs = 700): Promise<void> {
  await locator.dispatchEvent('pointerdown')
  await locator.page().waitForTimeout(holdMs)
  await locator.dispatchEvent('pointerup')
}

/**
 * Exchange a Firebase custom token for an ID token via the Auth Emulator REST
 * API. The emulator accepts any non-empty API key but still requires the
 * `key=` query param. The returned ID token can be used as `Bearer` against
 * the bantang-server `requireAuth` middleware.
 */
async function exchangeForIdToken(customToken: string): Promise<string> {
  const res = await fetch(
    `http://${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${VITE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  )
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { idToken?: string }
  if (!json.idToken) throw new Error('No idToken in exchange response')
  return json.idToken
}

/** Call the backend with a pre-obtained ID token. Returns parsed JSON envelope. */
async function apiCallAs(
  idToken: string,
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return res.json() as Promise<{ success: boolean; data?: unknown; error?: string }>
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Members — CRUD flows', () => {

  test('新增班員（最小必填：僅姓名）', async ({ page }) => {
    await setupLeaderOnMembers(page)

    await expect(page.getByText('尚無班員')).toBeVisible()
    await page.getByRole('button', { name: '＋ 新增' }).click()
    await expect(page.getByRole('heading', { name: '新增班員' })).toBeVisible()

    await page.getByPlaceholder('請輸入姓名').fill('小明')
    await page.getByRole('button', { name: /^儲存$/ }).click()

    // Sheet closes and list refreshes
    await expect(page.getByRole('heading', { name: '新增班員' })).toBeHidden()
    const row = memberCard(page, '小明')
    await expect(row).toBeVisible()
    await expect(row).toContainText('0 堂')
  })

  test('新增班員（完整欄位）', async ({ page }) => {
    await setupLeaderOnMembers(page)

    await page.getByRole('button', { name: '＋ 新增' }).click()
    await expect(page.getByRole('heading', { name: '新增班員' })).toBeVisible()

    await page.getByPlaceholder('請輸入姓名').fill('王小華')
    await page.getByPlaceholder('月').fill('3')
    await page.getByPlaceholder('日').fill('15')
    await page.getByPlaceholder('選填').first().fill('引保師某某')   // first 選填 = 引保師
    await page.locator('select').first().selectOption('精明')         // region unit
    await page.locator('input[type="number"][min="0"]').fill('5')     // 加入前既有堂數

    await page.getByRole('button', { name: /^儲存$/ }).click()
    await expect(page.getByRole('heading', { name: '新增班員' })).toBeHidden()

    const row = memberCard(page, '王小華')
    await expect(row).toBeVisible()
    await expect(row).toContainText('5 堂')
    await expect(row).toContainText('精明')
  })

  test('編輯班員（姓名 + 備註）', async ({ page }) => {
    const classId = uniqueClassId('e2e-mem')
    await seedClass(classId, 'E2E Members Class')
    await seedMembers(classId, [{ id: `${classId}-m1`, name: '原始姓名' }])

    const token = await mintE2EToken({ ...TEST_USERS.leader, classId })
    await page.goto(`/members?e2e_token=${encodeURIComponent(token)}`)

    await memberCard(page, '原始姓名').click()
    await expect(page).toHaveURL(/\/members\/.+/)
    await expect(page.getByRole('heading', { name: '原始姓名' })).toBeVisible()

    await page.getByRole('button', { name: '編輯' }).click()
    await expect(page.getByRole('heading', { name: '編輯班員' })).toBeVisible()

    await page.getByPlaceholder('請輸入姓名').fill('改過的名字')
    // MemberForm has exactly one textarea — the 備註 field. The <label> does
    // not use htmlFor, so getByRole('textbox', { name }) would not match.
    await page.locator('textarea').fill('這是一段備註')

    await page.getByRole('button', { name: /^儲存$/ }).click()
    await expect(page.getByRole('heading', { name: '編輯班員' })).toBeHidden()

    await expect(page.getByRole('heading', { name: '改過的名字' })).toBeVisible()
    await expect(page.getByText('這是一段備註')).toBeVisible()
  })

  test('PUT allow-list：未列名欄位（iccfStatus）被後端丟棄', async () => {
    const classId = uniqueClassId('e2e-mem')
    const memberId = `${classId}-m1`
    await seedClass(classId, 'E2E Members Class')
    await seedMembers(classId, [{ id: memberId, name: '原姓名' }])

    // Pure API test — no UI involved. Mint a custom token, exchange for an ID
    // token, and hit the backend directly.
    const customToken = await mintE2EToken({ ...TEST_USERS.leader, classId })
    const idToken = await exchangeForIdToken(customToken)

    // Attempt to sneak iccfStatus + iccfMemberId through PUT — neither is in
    // MEMBER_EDITABLE_FIELDS, so both must be silently dropped.
    const putResp = await apiCallAs(idToken, 'PUT', `/api/members/${memberId}`, {
      name: '新姓名',
      iccfStatus: 'synced',
      iccfMemberId: 'attacker-injected-id',
    })
    expect(putResp.success).toBe(true)

    const getResp = await apiCallAs(idToken, 'GET', `/api/members/${memberId}`)
    expect(getResp.success).toBe(true)
    const m = getResp.data as { name: string; iccfStatus?: string; iccfMemberId?: string }
    expect(m.name).toBe('新姓名')                 // allow-listed field updated
    expect(m.iccfStatus).toBeUndefined()           // not in allow-list
    expect(m.iccfMemberId).toBeUndefined()         // not in allow-list
  })

  test('長按移除班員（原因必填）', async ({ page }) => {
    const classId = uniqueClassId('e2e-mem')
    await seedClass(classId, 'E2E Members Class')
    await seedMembers(classId, [
      { id: `${classId}-m1`, name: '班員甲' },
      { id: `${classId}-m2`, name: '班員乙' },
    ])
    const token = await mintE2EToken({ ...TEST_USERS.leader, classId })
    await page.goto(`/members?e2e_token=${encodeURIComponent(token)}`)
    await expect(memberCard(page, '班員甲')).toBeVisible()

    await longPress(memberCard(page, '班員甲'))
    await expect(page.getByRole('heading', { name: '移除出班' })).toBeVisible()

    // Empty reason → error message, dialog stays open
    await page.getByRole('button', { name: '確認移除' }).click()
    await expect(page.getByText('請填寫移除原因')).toBeVisible()
    await expect(page.getByRole('heading', { name: '移除出班' })).toBeVisible()

    // Fill reason → confirm → dialog closes and 甲 removed
    await page.getByPlaceholder('請填寫移除原因').fill('已退班')
    await page.getByRole('button', { name: '確認移除' }).click()
    await expect(page.getByRole('heading', { name: '移除出班' })).toBeHidden()

    await expect(memberCard(page, '班員甲')).toHaveCount(0)
    await expect(memberCard(page, '班員乙')).toBeVisible()
  })

  test('空狀態：班級無成員時顯示「尚無班員」', async ({ page }) => {
    await setupLeaderOnMembers(page)
    await expect(page.getByText('尚無班員')).toBeVisible()
    await expect(page.getByRole('button', { name: '＋ 新增' })).toBeVisible()
  })
})
