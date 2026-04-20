import { expect, test } from '@playwright/test'
import { mintE2EToken } from '../helpers/auth'
import { TEST_USERS } from '../fixtures/test-users'

/**
 * Navigate to `/attendance?e2e_token=<token>` so main.tsx picks up the token,
 * signs in via the Auth Emulator, strips the query, then React renders as usual.
 */
async function signInAs(page: import('@playwright/test').Page, userKey: keyof typeof TEST_USERS, landing = '/attendance') {
  const token = await mintE2EToken(TEST_USERS[userKey])
  await page.goto(`${landing}?e2e_token=${encodeURIComponent(token)}`)
}

test.describe('Login — authentication + role-based navigation', () => {
  test('unauthenticated visit to /attendance redirects to /login', async ({ page }) => {
    await page.goto('/attendance')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: /Google/ })).toBeVisible()
  })

  test('leader sees 4 bottom-nav tabs (no 總覽)', async ({ page }) => {
    await signInAs(page, 'leader')
    await expect(page).toHaveURL(/\/attendance$/)
    const nav = page.locator('nav')
    await expect(nav.getByText('點名')).toBeVisible()
    await expect(nav.getByText('本週')).toBeVisible()
    await expect(nav.getByText('班員')).toBeVisible()
    await expect(nav.getByText('統計')).toBeVisible()
    await expect(nav.getByText('總覽')).toHaveCount(0)
  })

  test('head_leader sees 5 bottom-nav tabs including 總覽', async ({ page }) => {
    await signInAs(page, 'headLeader')
    await expect(page).toHaveURL(/\/attendance$/)
    const nav = page.locator('nav')
    await expect(nav.getByText('點名')).toBeVisible()
    await expect(nav.getByText('總覽')).toBeVisible()
  })

  test('class_master (主班) sees 5 bottom-nav tabs including 總覽', async ({ page }) => {
    await signInAs(page, 'classMaster')
    await expect(page).toHaveURL(/\/attendance$/)
    const nav = page.locator('nav')
    await expect(nav.getByText('班員')).toBeVisible()
    await expect(nav.getByText('總覽')).toBeVisible()
  })

  test('junior_leader is redirected to /portal/schedule', async ({ page }) => {
    await signInAs(page, 'juniorLeader')
    await expect(page).toHaveURL(/\/portal\/schedule$/)
  })
})
