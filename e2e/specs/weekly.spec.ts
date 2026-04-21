import { expect, test, type Page } from '@playwright/test'
import { mintE2EToken } from '../helpers/auth'
import { seedClass, seedMembers, uniqueClassId } from '../helpers/seed'
import { TEST_USERS } from '../fixtures/test-users'

/**
 * Phase 4 — Weekly (本週任務) flows.
 *
 * Covers:
 *   1. 基本渲染 — heading, week range, prev/next nav buttons, notes textarea
 *   2. 週次導航 — ‹/› buttons shift the displayed week range
 *   3. 課表未授權 — "連接 Google 課表" button visible when no Sheets token
 *   4. 備註持久化 — notes typed in textarea survive a page reload
 *   5. 近期生日 — member with birthday within 14 days triggers birthday section
 */

async function setupLeaderOnWeekly(page: Page): Promise<{ classId: string }> {
  const classId = uniqueClassId('e2e-wkl')
  await seedClass(classId, 'E2E Weekly Class')
  const token = await mintE2EToken({ ...TEST_USERS.leader, classId })
  await page.goto(`/weekly?e2e_token=${encodeURIComponent(token)}`)
  await expect(page.getByRole('heading', { name: '本週任務' })).toBeVisible()
  // Wait for WeeklyTask to load (taskLoading = false → textarea appears)
  await expect(page.locator('textarea')).toBeVisible({ timeout: 8000 })
  return { classId }
}

test.describe('Weekly — 本週任務', () => {

  test('基本渲染：heading + 週次 + 導航按鈕 + 備註欄', async ({ page }) => {
    await setupLeaderOnWeekly(page)
    // Week range label  e.g. "4月21日（一）∼ 4月27日（日）"
    await expect(page.getByText(/月\d+日（一）∼\s*\d+月\d+日（日）/)).toBeVisible()
    await expect(page.getByRole('button', { name: '‹' })).toBeVisible()
    await expect(page.getByRole('button', { name: '›' })).toBeVisible()
    await expect(page.locator('textarea')).toBeVisible()
  })

  test('週次導航：前後切換顯示不同週次', async ({ page }) => {
    await setupLeaderOnWeekly(page)

    const weekRangeLocator = page.getByText(/月\d+日（一）∼\s*\d+月\d+日（日）/)
    const initialText = await weekRangeLocator.textContent()

    // Shift to previous week
    await page.getByRole('button', { name: '‹' }).click()
    const prevText = await weekRangeLocator.textContent()
    expect(prevText).not.toBe(initialText)

    // Shift forward → back to original week
    await page.getByRole('button', { name: '›' }).click()
    await expect(weekRangeLocator).toHaveText(initialText!)
  })

  test('課表未授權：顯示「連接 Google 課表」按鈕', async ({ page }) => {
    await setupLeaderOnWeekly(page)
    // No Sheets token in E2E env → scheduleState = 'no_token'
    await expect(page.getByRole('button', { name: '連接 Google 課表' })).toBeVisible()
  })

  test('備註持久化：重新載入後備註仍保留', async ({ page }) => {
    // Inline setup so we can arm a waitForResponse before page.goto — the
    // page fires its GET polls on mount and we need to catch them.
    const classId = uniqueClassId('e2e-wkl')
    await seedClass(classId, 'E2E Weekly Class')
    const token = await mintE2EToken({ ...TEST_USERS.leader, classId })

    // Root cause of the earlier flake: Weekly.tsx's `update()` early-returns
    // when React's `task` state is still null. `task` is populated by a
    // polling GET /api/weekly-tasks?classId=…&weekStart=…, which races the
    // POST /api/weekly-tasks/get-or-create that creates the document. When
    // the first GET wins the race it returns null; the textarea becomes
    // visible (taskLoading=false) but `task` is null, so typing fires no PUT.
    // Wait for a GET whose body carries a populated task before typing.
    const taskReady = page.waitForResponse(async r => {
      if (!/\/api\/weekly-tasks\?classId=/.test(r.url())) return false
      if (!r.ok()) return false
      try {
        const body = await r.json()
        return Boolean(body?.success) && body.data != null && typeof body.data === 'object'
      } catch {
        return false
      }
    })

    await page.goto(`/weekly?e2e_token=${encodeURIComponent(token)}`)
    await expect(page.getByRole('heading', { name: '本週任務' })).toBeVisible()
    await expect(page.locator('textarea')).toBeVisible({ timeout: 8000 })
    await taskReady

    const notesText = `E2E 持久化備註 ${Date.now()}`
    const [putRes] = await Promise.all([
      page.waitForResponse(
        r =>
          /\/api\/weekly-tasks\/[^/?#]+$/.test(r.url()) &&
          r.request().method() === 'PUT' &&
          r.url().includes(classId),
      ),
      page.locator('textarea').fill(notesText),
    ])
    expect(putRes.ok()).toBe(true)

    // Navigate back with a fresh token (re-mints user, same classId)
    const token2 = await mintE2EToken({ ...TEST_USERS.leader, classId })
    await page.goto(`/weekly?e2e_token=${encodeURIComponent(token2)}`)
    await expect(page.getByRole('heading', { name: '本週任務' })).toBeVisible()
    await expect(page.locator('textarea')).toBeVisible({ timeout: 8000 })

    await expect(page.locator('textarea')).toHaveValue(notesText)
  })

  test('近期生日：14 天內班員顯示提醒', async ({ page }) => {
    const classId = uniqueClassId('e2e-wkl')
    await seedClass(classId, 'E2E Weekly Class')

    // Compute a birthday 3 days from now (format: MM-DD)
    const future = new Date()
    future.setDate(future.getDate() + 3)
    const birthday = [
      String(future.getMonth() + 1).padStart(2, '0'),
      String(future.getDate()).padStart(2, '0'),
    ].join('-')

    await seedMembers(classId, [{ id: `${classId}-m1`, name: '壽星同學', birthday }])

    const token = await mintE2EToken({ ...TEST_USERS.leader, classId })
    await page.goto(`/weekly?e2e_token=${encodeURIComponent(token)}`)
    await expect(page.getByRole('heading', { name: '本週任務' })).toBeVisible()

    await expect(page.getByText('🎂 近期生日（14 天內）')).toBeVisible()
    await expect(page.getByText('壽星同學')).toBeVisible()
  })
})
