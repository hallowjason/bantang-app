import { expect, test, type Page } from '@playwright/test'
import { mintE2EToken } from '../helpers/auth'
import { seedClass, uniqueClassId } from '../helpers/seed'
import { TEST_USERS } from '../fixtures/test-users'

/**
 * Phase 5 — Admin (/admin) role-gating flows.
 *
 * Dashboard.tsx exists but is not registered in the router (wildcard → /attendance).
 * The meaningful role-gate to test is /admin:
 *   - class_master (and isAdmin-tagged leaders) can enter; sees "領班管理後台"
 *   - plain leader is redirected to /attendance
 *
 * Covers:
 *   1. class_master 進入 /admin 看到「領班管理後台」
 *   2. leader 進入 /admin 被導向 /attendance
 */

async function goToAdmin(page: Page, role: 'leader' | 'classMaster') {
  const classId = uniqueClassId('e2e-dash')
  await seedClass(classId, 'E2E Dash Class')
  const user = role === 'classMaster' ? TEST_USERS.classMaster : TEST_USERS.leader
  const token = await mintE2EToken({ ...user, classId })
  await page.goto(`/admin?e2e_token=${encodeURIComponent(token)}`)
}

test.describe('Admin — /admin 角色 gating', () => {

  test('class_master 進入 /admin 看到管理後台標題', async ({ page }) => {
    await goToAdmin(page, 'classMaster')
    await expect(page.getByRole('heading', { name: '領班管理後台' })).toBeVisible()
  })

  test('leader 進入 /admin 被導向 /attendance', async ({ page }) => {
    await goToAdmin(page, 'leader')
    await expect(page).toHaveURL(/\/attendance/)
  })

})
