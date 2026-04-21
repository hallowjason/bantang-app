import { expect, test, type Page } from '@playwright/test'
import { mintE2EToken } from '../helpers/auth'
import { seedClass, seedMembers, seedAttendance, uniqueClassId } from '../helpers/seed'
import { TEST_USERS } from '../fixtures/test-users'

/**
 * Phase 4 — Report (出席報表) flows.
 *
 * Covers:
 *   1. 基本渲染 — heading, date picker, stat cards, copy button
 *   2. 統計卡反映點名資料 — seeded attendance maps to correct present/leave/absent counts
 *   3. 備註加入報表預覽 — typing notes updates the <pre> text immediately
 *   4. 複製按鈕 feedback — button shows "已複製" then reverts after 2.5 s
 */

const todayStr = () => new Date().toISOString().slice(0, 10)

async function setupLeaderOnReport(
  page: Page,
  members: { id: string; name: string }[] = [],
  attendanceRecords: { memberId: string; status: 'present' | 'leave' | 'absent' }[] = [],
): Promise<{ classId: string }> {
  const classId = uniqueClassId('e2e-rpt')
  await seedClass(classId, 'E2E Report Class')
  if (members.length) await seedMembers(classId, members)
  if (attendanceRecords.length) await seedAttendance(classId, todayStr(), attendanceRecords)
  const token = await mintE2EToken({ ...TEST_USERS.leader, classId })
  await page.goto(`/report?e2e_token=${encodeURIComponent(token)}`)
  await expect(page.getByRole('heading', { name: '出席報表' })).toBeVisible()
  return { classId }
}

test.describe('Report — 出席報表', () => {

  test('基本渲染：heading + date picker + 統計卡 + 複製按鈕', async ({ page }) => {
    await setupLeaderOnReport(page)
    await expect(page.locator('input[type="date"]')).toBeVisible()
    // Stat card labels are exact strings (distinct from "出席報表" heading and pre text)
    await expect(page.getByText('出席', { exact: true })).toBeVisible()
    await expect(page.getByText('請假', { exact: true })).toBeVisible()
    await expect(page.getByText('缺席', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '一鍵複製報表' })).toBeVisible()
  })

  test('統計卡反映點名資料', async ({ page }) => {
    const classId = uniqueClassId('e2e-rpt')
    await seedClass(classId, 'E2E Report Class')
    await seedMembers(classId, [
      { id: `${classId}-m1`, name: '班員甲' },
      { id: `${classId}-m2`, name: '班員乙' },
      { id: `${classId}-m3`, name: '班員丙' },
    ])
    // m1=present, m2=leave, m3 has no record → absent
    await seedAttendance(classId, todayStr(), [
      { memberId: `${classId}-m1`, status: 'present' },
      { memberId: `${classId}-m2`, status: 'leave' },
    ])
    const token = await mintE2EToken({ ...TEST_USERS.leader, classId })
    await page.goto(`/report?e2e_token=${encodeURIComponent(token)}`)
    await expect(page.getByRole('heading', { name: '出席報表' })).toBeVisible()

    // Report <pre> text includes member names grouped by status
    const pre = page.locator('pre')
    await expect(pre).toContainText('出席（1人）：班員甲')
    await expect(pre).toContainText('請假（1人）：班員乙')
    await expect(pre).toContainText('缺席（1人）：班員丙')
  })

  test('備註加入報表預覽', async ({ page }) => {
    await setupLeaderOnReport(page)
    // Wait for the async getOrCreateWeeklyTask to settle (class name appears in pre)
    // before filling notes, otherwise the fetch response may overwrite the typed value
    await expect(page.locator('pre')).toContainText('E2E Report Class')
    await page.locator('textarea').fill('E2E 測試備註文字')
    await expect(page.locator('pre')).toContainText('備註：E2E 測試備註文字')
  })

  test('複製按鈕 feedback：顯示已複製 → 2.5 秒後恢復', async ({ page }) => {
    await setupLeaderOnReport(page)
    await page.getByRole('button', { name: '一鍵複製報表' }).click()
    await expect(page.getByRole('button', { name: /已複製/ })).toBeVisible()
    // After 2.5 s the button reverts — allow up to 5 s total
    await expect(page.getByRole('button', { name: '一鍵複製報表' })).toBeVisible({ timeout: 5000 })
  })
})
