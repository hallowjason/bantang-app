import { expect, test, type Page } from '@playwright/test'
import { mintE2EToken } from '../helpers/auth'
import { seedClass, seedMembers, resetSession, uniqueClassId } from '../helpers/seed'
import { TEST_USERS } from '../fixtures/test-users'

/**
 * Phase 2 — Attendance flow.
 *
 * Covers:
 *   1. 三態循環：absent → present → leave → absent
 *   2. Finalize：「完成點名」→ 「✓ 已完成」badge + 「重新開啟補登」按鈕
 *   3. Finalized 禁止修改：點班員 badge 不變
 *   4. Reopen：「重新開啟補登」→ 班員可再編輯
 *
 * Isolation: each test seeds a unique classId + members, leader user gets
 * re-pinned to that class via mintE2EToken.
 */

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

/** Sign in leader with a fresh class + 2 members; land on /attendance. */
async function setupLeaderOnAttendance(page: Page): Promise<{
  classId: string
  members: { id: string; name: string }[]
}> {
  const classId = uniqueClassId()
  const members = [
    { id: `${classId}-m1`, name: '班員甲' },
    { id: `${classId}-m2`, name: '班員乙' },
  ]

  await seedClass(classId, 'E2E Attendance Class')
  await seedMembers(classId, members)
  await resetSession(classId, todayStr())

  const token = await mintE2EToken({ ...TEST_USERS.leader, classId })
  await page.goto(`/attendance?e2e_token=${encodeURIComponent(token)}`)
  await expect(page).toHaveURL(/\/attendance$/)

  // Wait for member list to render
  await expect(page.getByRole('button', { name: new RegExp(members[0].name) })).toBeVisible()
  return { classId, members }
}

/** Locator for a single member row (button). Matches member's name inside. */
function memberRow(page: Page, name: string) {
  return page.locator('li').filter({ hasText: name }).locator('button').first()
}

/** Read the status badge label for a given member row ('未到' / '出席' / '請假'). */
async function getStatus(page: Page, name: string): Promise<string> {
  const row = memberRow(page, name)
  // badge is the last <span> inside the button — text is one of 未到/出席/請假
  const badge = row.locator('span').last()
  return (await badge.textContent())?.trim() ?? ''
}

async function waitForStatus(page: Page, name: string, expected: string) {
  await expect
    .poll(async () => getStatus(page, name), { timeout: 6000 })
    .toBe(expected)
}

test.describe('Attendance — three-state cycle + finalize + reopen', () => {
  test('三態循環：未到 → 出席 → 請假 → 未到', async ({ page }) => {
    const { members } = await setupLeaderOnAttendance(page)
    const [a] = members

    await waitForStatus(page, a.name, '未到')

    await memberRow(page, a.name).click()
    await waitForStatus(page, a.name, '出席')

    await memberRow(page, a.name).click()
    await waitForStatus(page, a.name, '請假')

    await memberRow(page, a.name).click()
    await waitForStatus(page, a.name, '未到')
  })

  test('完成點名：顯示已完成 badge 與重新開啟按鈕', async ({ page }) => {
    const { members } = await setupLeaderOnAttendance(page)
    const [a, b] = members

    // A=present, B=leave (one click + two clicks from initial absent)
    await memberRow(page, a.name).click()
    await waitForStatus(page, a.name, '出席')
    await memberRow(page, b.name).click()
    await memberRow(page, b.name).click()
    await waitForStatus(page, b.name, '請假')

    await page.getByRole('button', { name: '完成點名' }).click()

    // Optimistic update — should appear fast (< expect default timeout)
    await expect(page.getByText('✓ 已完成')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新開啟補登' })).toBeVisible()
  })

  test('完成後點班員按鈕不會改變狀態', async ({ page }) => {
    const { members } = await setupLeaderOnAttendance(page)
    const [a] = members

    await memberRow(page, a.name).click()
    await waitForStatus(page, a.name, '出席')

    await page.getByRole('button', { name: '完成點名' }).click()
    await expect(page.getByRole('button', { name: '重新開啟補登' })).toBeVisible()

    // Post-finalize the row button is disabled; assert that directly instead
    // of forcing a click and polling for non-change.
    await expect(memberRow(page, a.name)).toBeDisabled()
    expect(await getStatus(page, a.name)).toBe('出席')
  })

  test('重新開啟：班員可再次編輯', async ({ page }) => {
    const { members } = await setupLeaderOnAttendance(page)
    const [a] = members

    await memberRow(page, a.name).click()
    await memberRow(page, a.name).click()
    await waitForStatus(page, a.name, '請假')

    await page.getByRole('button', { name: '完成點名' }).click()
    await expect(page.getByRole('button', { name: '重新開啟補登' })).toBeVisible()

    await page.getByRole('button', { name: '重新開啟補登' }).click()
    await expect(page.getByRole('button', { name: '完成點名' })).toBeVisible()

    // Next click cycles: 請假 → 未到
    await memberRow(page, a.name).click()
    await waitForStatus(page, a.name, '未到')
  })
})
