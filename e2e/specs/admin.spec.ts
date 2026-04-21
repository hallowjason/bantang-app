import { expect, test, type Page } from '@playwright/test'
import { mintE2EToken } from '../helpers/auth'
import { seedClass, uniqueClassId } from '../helpers/seed'
import { TEST_USERS } from '../fixtures/test-users'
import type { UserRole } from '../../src/types'

/**
 * Phase 6 — Admin (/admin) CRUD flows.
 *
 * Phase 5 covered role-gating (head_leader/class_master vs leader). Phase 6
 * exercises the actual admin UI as head_leader:
 *   1. Tab 切換 — 🏫 班級 / 👤 人員 / 🔗 iccf
 *   2. 建立班級 — 空白驗證 + 成功建立
 *   3. 編輯班級 — 改名 + 課表分頁 + iccf 班別編號 → 列表反映
 *   4. 人員角色 filter — 切到「小班長」只顯示該角色
 *   5. 變更 user role — select → ✓ 已儲存 + 後端持久化
 *   6. iccf tab 空狀態 — 顯示「目前無有效 iccf session」
 */

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3101'

async function seedUserDirect(u: {
  uid: string
  email: string
  name: string
  role: UserRole
  classId?: string
}): Promise<void> {
  const res = await fetch(`${API_URL}/api/_test/seed-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...u, classId: u.classId ?? '' }),
  })
  if (!res.ok) {
    throw new Error(`seed-user failed: ${res.status} ${await res.text()}`)
  }
}

async function goToAdmin(page: Page): Promise<void> {
  const token = await mintE2EToken(TEST_USERS.headLeader)
  await page.goto(`/admin?e2e_token=${encodeURIComponent(token)}`)
  await expect(page.getByRole('heading', { name: '領班管理後台' })).toBeVisible()
  // Wait for initial loadAll() to settle — "載入中..." disappears.
  await expect(page.getByText('載入中...')).not.toBeVisible({ timeout: 10_000 })
}

test.describe('Admin — /admin CRUD flows', () => {

  test('Tab 切換：班級 ↔ 人員 ↔ iccf', async ({ page }) => {
    await goToAdmin(page)

    // Default tab = classes
    await expect(page.getByText('新增班級')).toBeVisible()

    await page.getByRole('button', { name: /👤 人員/ }).click()
    await expect(page.getByText('第一次設定流程')).toBeVisible()

    await page.getByRole('button', { name: /🔗 iccf/ }).click()
    await expect(page.getByText('關於 iccf 同步')).toBeVisible()

    await page.getByRole('button', { name: /🏫 班級/ }).click()
    await expect(page.getByText('新增班級')).toBeVisible()
  })

  test('建立班級：空白 → 錯誤提示；填名 → 列表含該班', async ({ page }) => {
    await goToAdmin(page)

    const createBtn = page.getByRole('button', { name: '建立' })
    // Empty name — inline error
    await createBtn.click()
    await expect(page.getByText('請輸入班級名稱')).toBeVisible()

    // Fill and create
    const name = `E2E 建立測試 ${Date.now()}`
    await page.getByPlaceholder(/班級名稱（例/).fill(name)
    await createBtn.click()
    await expect(page.getByText(name)).toBeVisible({ timeout: 8000 })
  })

  test('編輯班級：改名 + 課表分頁 + iccf 班別編號', async ({ page }) => {
    const classId = uniqueClassId('e2e-adm')
    const original = `E2E Edit Orig ${classId}`
    await seedClass(classId, original)
    await goToAdmin(page)

    // Click the 編輯 button inside the card containing `original`.
    // Scope to `div.bg-white` so we hit the class card, not an ancestor container.
    await page
      .locator('div.bg-white')
      .filter({ hasText: original })
      .getByRole('button', { name: '編輯' })
      .click()

    // Only editName input has no placeholder; the other three inputs are the
    // edit form's sheetTabName / sheetClassLabel / iccfClassCode, uniquely
    // identifiable by placeholder.
    const updated = `E2E Edit Updated ${classId}`
    await page.locator('input:not([placeholder])').first().fill(updated)
    await page.getByPlaceholder('2026光明').fill('2026測試')
    await page.getByPlaceholder('禮行').fill('光明')
    await page.getByPlaceholder('B3000549').fill('B9999999')

    await page.getByRole('button', { name: /^儲存$/ }).click()

    // After save, list refreshes and reflects all three updates.
    await expect(page.getByText(updated)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/課表：2026測試.*光明/)).toBeVisible()
    await expect(page.getByText('iccf: B9999999')).toBeVisible()
  })

  test('人員角色 filter：切到「小班長」只顯示該角色人員', async ({ page }) => {
    const stamp = Date.now()
    const juniorName = `E2E 小班長 ${stamp}`
    const leaderName = `E2E 領班甲 ${stamp}`
    await seedUserDirect({
      uid: `e2e-junior-${stamp}`,
      email: `junior-${stamp}@e2e.test`,
      name: juniorName,
      role: 'junior_leader',
    })
    await seedUserDirect({
      uid: `e2e-leader-extra-${stamp}`,
      email: `leader-${stamp}@e2e.test`,
      name: leaderName,
      role: 'leader',
    })

    await goToAdmin(page)
    await page.getByRole('button', { name: /👤 人員/ }).click()

    // Filter by 小班長 — only juniorName should be visible.
    await page.getByRole('button', { name: /^小班長/ }).click()
    await expect(page.getByText(juniorName)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(leaderName)).not.toBeVisible()

    // Switch to 領班 — leaderName visible, junior hidden.
    await page.getByRole('button', { name: /^領班/ }).click()
    await expect(page.getByText(leaderName)).toBeVisible()
    await expect(page.getByText(juniorName)).not.toBeVisible()
  })

  test('變更 user role：select → ✓ 已儲存 + 後端持久化', async ({ page }) => {
    const stamp = Date.now()
    const uid = `e2e-target-${stamp}`
    const targetName = `E2E Target ${stamp}`
    await seedUserDirect({
      uid,
      email: `${uid}@e2e.test`,
      name: targetName,
      role: 'member',
    })

    await goToAdmin(page)
    await page.getByRole('button', { name: /👤 人員/ }).click()

    // Scope to the user card holding targetName (bg-white distinguishes cards
    // from ancestor containers).
    const card = page
      .locator('div.bg-white')
      .filter({ hasText: targetName })
    await card.locator('select').first().selectOption('leader')

    // ✓ 已儲存 appears for ~1.5 s after the PUT resolves.
    await expect(card.getByText('✓ 已儲存')).toBeVisible({ timeout: 5000 })

    // Verify via emulator-only test endpoint.
    const res = await fetch(`${API_URL}/api/_test/user/${uid}`)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.role).toBe('leader')
  })

  test('iccf tab 空狀態：顯示「目前無有效 iccf session」', async ({ page }) => {
    await goToAdmin(page)
    await page.getByRole('button', { name: /🔗 iccf/ }).click()
    await expect(page.getByText('目前無有效 iccf session')).toBeVisible({ timeout: 8000 })
  })

})
