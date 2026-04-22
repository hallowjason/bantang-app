import { expect, test, type Page } from '@playwright/test'
import { mintE2EToken } from '../helpers/auth'
import { seedClass, seedMembers, seedAttendance, uniqueClassId } from '../helpers/seed'
import { TEST_USERS } from '../fixtures/test-users'

/**
 * Phase 5 — Stats (出席統計) flows.
 *
 * Covers:
 *   1. Tab 切換 — 班級趨勢 ↔ 班員紀錄
 *   2. 週數切換 — 近 4 週 ↔ 近 8 週
 *   3. 班級趨勢空狀態 — presentCount 全為 0 時顯示提示文字
 *   4. 班員紀錄空狀態 — 無班員時顯示提示文字
 *   5. 班員圖表 modal — 點擊班員卡片展開，✕ 關閉
 */

const todayStr = () => new Date().toISOString().slice(0, 10)

async function goToStats(page: Page, classId: string) {
  const token = await mintE2EToken({ ...TEST_USERS.leader, classId })
  await page.goto(`/stats?e2e_token=${encodeURIComponent(token)}`)
  await expect(page.getByRole('heading', { name: '出席統計' })).toBeVisible()
}

test.describe('Stats — 出席統計', () => {

  test('Tab 切換：班級趨勢 ↔ 班員紀錄', async ({ page }) => {
    const classId = uniqueClassId('e2e-stats')
    await seedClass(classId, 'E2E Stats Class')
    await goToStats(page, classId)

    const classTab = page.getByRole('button', { name: '班級趨勢' })
    const memberTab = page.getByRole('button', { name: '班員紀錄' })
    await expect(classTab).toBeVisible()
    await expect(memberTab).toBeVisible()

    // 切換到班員紀錄
    await memberTab.click()
    await expect(memberTab).toBeVisible()
    // 切回班級趨勢
    await classTab.click()
    await expect(classTab).toBeVisible()
  })

  test('週數切換：近 4 週 ↔ 近 8 週', async ({ page }) => {
    const classId = uniqueClassId('e2e-stats')
    await seedClass(classId, 'E2E Stats Class')
    await goToStats(page, classId)

    const btn4 = page.getByRole('button', { name: '近 4 週' })
    const btn8 = page.getByRole('button', { name: '近 8 週' })
    await expect(btn4).toBeVisible()
    await expect(btn8).toBeVisible()

    await btn8.click()
    await expect(btn8).toBeVisible()
    await btn4.click()
    await expect(btn4).toBeVisible()
  })

  test('班級趨勢空狀態：有班員但無出席紀錄時顯示提示', async ({ page }) => {
    const classId = uniqueClassId('e2e-stats')
    await seedClass(classId, 'E2E Stats Class')
    await seedMembers(classId, [{ id: `${classId}-m1`, name: '班員甲' }])
    // 不 seed attendance → 每週 presentCount 為 0 → 顯示空狀態
    await goToStats(page, classId)
    await expect(page.getByText('此期間尚無出席紀錄')).toBeVisible({ timeout: 8000 })
  })

  test('班員紀錄空狀態：無班員時顯示提示', async ({ page }) => {
    const classId = uniqueClassId('e2e-stats')
    await seedClass(classId, 'E2E Stats Class')
    // 不 seed 任何班員 → memberHistory 為空陣列
    await goToStats(page, classId)
    await page.getByRole('button', { name: '班員紀錄' }).click()
    await expect(page.getByText('此期間尚無出席紀錄')).toBeVisible({ timeout: 8000 })
  })

  test('班員圖表 modal：點擊班員卡片展開 → ✕ 關閉', async ({ page }) => {
    const classId = uniqueClassId('e2e-stats')
    await seedClass(classId, 'E2E Stats Class')
    await seedMembers(classId, [{ id: `${classId}-m1`, name: '班員甲' }])
    await seedAttendance(classId, todayStr(), [
      { memberId: `${classId}-m1`, status: 'present' },
    ])
    await goToStats(page, classId)

    // 切換到班員紀錄 tab
    await page.getByRole('button', { name: '班員紀錄' }).click()

    // 等待班員卡片出現（含「共 N 堂」文字）
    const memberCard = page.locator('button').filter({ hasText: /共/ }).first()
    await expect(memberCard).toBeVisible({ timeout: 8000 })

    // 展開 modal
    await memberCard.click()
    const closeBtn = page.getByRole('button', { name: '✕' })
    await expect(closeBtn).toBeVisible()
    // modal 內顯示班員姓名
    await expect(page.locator('.fixed').getByText('班員甲')).toBeVisible()

    // 點 ✕ 關閉 modal
    await closeBtn.click()
    await expect(closeBtn).not.toBeVisible()
  })

})
