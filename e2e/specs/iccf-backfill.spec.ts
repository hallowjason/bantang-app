import { expect, test } from '@playwright/test'
import { seedClass, uniqueClassId } from '../helpers/seed'

/**
 * Covers backfillIccfClassCode's three branches via /api/_test/iccf-backfill.
 * The real iccf server is never contacted — we drive the function directly
 * with synthetic "discovered" entries.
 *
 * Rules (see server/src/routes/iccfSession.ts):
 *   1. Existing empty + exactly one active → fill (reason 'backfill')
 *   2. Existing non-empty maps to ended + exactly one active replacement → overwrite (reason 'annual_renewal')
 *   3. Anything else → no-op (preserves admin-only edit rule)
 */

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3101'

interface DiscoveredEntry {
  classCode: string
  className: string
  iccfClassCode: string
  status: 'active' | 'ended' | 'joint_ended'
}

interface ClassDoc {
  _id: string
  iccfClassCode?: string
  iccfClassCodeHistory?: Array<{
    from: string
    to: string
    at: string
    byLeaderUid: string
    reason: 'backfill' | 'annual_renewal'
  }>
}

async function seedUser(u: {
  uid: string
  email: string
  name: string
  role: 'class_master' | 'leader' | 'junior_leader' | 'member'
  classId: string
}): Promise<void> {
  const res = await fetch(`${API_URL}/api/_test/seed-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(u),
  })
  if (!res.ok) {
    throw new Error(`seed-user failed: ${res.status} ${await res.text()}`)
  }
}

async function runBackfill(leaderUid: string, discovered: DiscoveredEntry[]): Promise<void> {
  const res = await fetch(`${API_URL}/api/_test/iccf-backfill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leaderUid, discovered }),
  })
  if (!res.ok) {
    throw new Error(`iccf-backfill failed: ${res.status} ${await res.text()}`)
  }
}

async function readClass(classId: string): Promise<ClassDoc> {
  const res = await fetch(`${API_URL}/api/_test/class/${classId}`)
  if (!res.ok) throw new Error(`class read failed: ${res.status}`)
  const body = await res.json()
  return body.data as ClassDoc
}

test.describe('backfillIccfClassCode — three-branch rule', () => {
  test('empty + one active → fill with backfill history entry', async () => {
    const classId = uniqueClassId('e2e-bf-empty')
    const leaderUid = `e2e-bf-leader-${Date.now()}`
    await seedClass(classId, 'E2E Backfill Empty')
    await seedUser({
      uid: leaderUid,
      email: `${leaderUid}@e2e.test`,
      name: 'E2E Backfill Leader',
      role: 'leader',
      classId,
    })

    await runBackfill(leaderUid, [
      { classCode: 'TWT', className: '2026 新班', iccfClassCode: 'B9000001', status: 'active' },
    ])

    const cls = await readClass(classId)
    expect(cls.iccfClassCode).toBe('B9000001')
    expect(cls.iccfClassCodeHistory?.length).toBe(1)
    expect(cls.iccfClassCodeHistory?.[0]).toMatchObject({
      from: '',
      to: 'B9000001',
      byLeaderUid: leaderUid,
      reason: 'backfill',
    })
  })

  test('empty + multiple active → no-op (ambiguous)', async () => {
    const classId = uniqueClassId('e2e-bf-ambig')
    const leaderUid = `e2e-bf-ambig-leader-${Date.now()}`
    await seedClass(classId, 'E2E Backfill Ambiguous')
    await seedUser({
      uid: leaderUid,
      email: `${leaderUid}@e2e.test`,
      name: 'E2E Ambiguous',
      role: 'leader',
      classId,
    })

    await runBackfill(leaderUid, [
      { classCode: 'TWT', className: 'A班', iccfClassCode: 'B9000010', status: 'active' },
      { classCode: 'TWC', className: 'B班', iccfClassCode: 'B9000011', status: 'active' },
    ])

    const cls = await readClass(classId)
    expect(cls.iccfClassCode ?? '').toBe('')
    expect(cls.iccfClassCodeHistory ?? []).toHaveLength(0)
  })

  test('annual renewal: current→ended + one active replacement → overwrite', async () => {
    const classId = uniqueClassId('e2e-bf-renew')
    const leaderUid = `e2e-bf-renew-leader-${Date.now()}`
    await seedClass(classId, 'E2E Backfill Renewal', { iccfClassCode: 'B3000490' })
    await seedUser({
      uid: leaderUid,
      email: `${leaderUid}@e2e.test`,
      name: 'E2E Renewal',
      role: 'leader',
      classId,
    })

    await runBackfill(leaderUid, [
      { classCode: 'TWT', className: '2026 新班', iccfClassCode: 'B7000170', status: 'active' },
      { classCode: 'TWC', className: '2025 舊班', iccfClassCode: 'B3000490', status: 'ended' },
    ])

    const cls = await readClass(classId)
    expect(cls.iccfClassCode).toBe('B7000170')
    expect(cls.iccfClassCodeHistory?.length).toBe(1)
    expect(cls.iccfClassCodeHistory?.[0]).toMatchObject({
      from: 'B3000490',
      to: 'B7000170',
      byLeaderUid: leaderUid,
      reason: 'annual_renewal',
    })
  })

  test('joint_ended also triggers renewal', async () => {
    const classId = uniqueClassId('e2e-bf-joint')
    const leaderUid = `e2e-bf-joint-leader-${Date.now()}`
    await seedClass(classId, 'E2E Joint Renewal', { iccfClassCode: 'B2000347' })
    await seedUser({
      uid: leaderUid,
      email: `${leaderUid}@e2e.test`,
      name: 'E2E Joint',
      role: 'leader',
      classId,
    })

    await runBackfill(leaderUid, [
      { classCode: 'TWT', className: '2026 新班', iccfClassCode: 'B7000170', status: 'active' },
      { classCode: 'TWA', className: '2024 聯班', iccfClassCode: 'B2000347', status: 'joint_ended' },
    ])

    const cls = await readClass(classId)
    expect(cls.iccfClassCode).toBe('B7000170')
    expect(cls.iccfClassCodeHistory?.[0]?.reason).toBe('annual_renewal')
  })

  test('no-op: current is set and still appears as active → do not touch', async () => {
    const classId = uniqueClassId('e2e-bf-noop')
    const leaderUid = `e2e-bf-noop-leader-${Date.now()}`
    await seedClass(classId, 'E2E No-Op', { iccfClassCode: 'B7000170' })
    await seedUser({
      uid: leaderUid,
      email: `${leaderUid}@e2e.test`,
      name: 'E2E No-Op',
      role: 'leader',
      classId,
    })

    await runBackfill(leaderUid, [
      { classCode: 'TWT', className: '2026 班', iccfClassCode: 'B7000170', status: 'active' },
    ])

    const cls = await readClass(classId)
    expect(cls.iccfClassCode).toBe('B7000170')
    expect(cls.iccfClassCodeHistory ?? []).toHaveLength(0)
  })

  test('forgery guard: ended entry without an active replacement → no-op', async () => {
    const classId = uniqueClassId('e2e-bf-forge')
    const leaderUid = `e2e-bf-forge-leader-${Date.now()}`
    await seedClass(classId, 'E2E Forge Guard', { iccfClassCode: 'B3000490' })
    await seedUser({
      uid: leaderUid,
      email: `${leaderUid}@e2e.test`,
      name: 'E2E Forge',
      role: 'leader',
      classId,
    })

    // Only an ended entry discovered — no active replacement.
    // Class doc must stay at the original B-number.
    await runBackfill(leaderUid, [
      { classCode: 'TWC', className: '2025 舊班', iccfClassCode: 'B3000490', status: 'ended' },
    ])

    const cls = await readClass(classId)
    expect(cls.iccfClassCode).toBe('B3000490')
    expect(cls.iccfClassCodeHistory ?? []).toHaveLength(0)
  })

  test('renewal refuses when multiple active exist (cannot decide target)', async () => {
    const classId = uniqueClassId('e2e-bf-multi')
    const leaderUid = `e2e-bf-multi-leader-${Date.now()}`
    await seedClass(classId, 'E2E Multi Active', { iccfClassCode: 'B3000490' })
    await seedUser({
      uid: leaderUid,
      email: `${leaderUid}@e2e.test`,
      name: 'E2E Multi',
      role: 'leader',
      classId,
    })

    await runBackfill(leaderUid, [
      { classCode: 'TWT', className: '2026 A班', iccfClassCode: 'B7000170', status: 'active' },
      { classCode: 'TWC', className: '2026 B班', iccfClassCode: 'B7000171', status: 'active' },
      { classCode: 'TWA', className: '2025 舊班', iccfClassCode: 'B3000490', status: 'ended' },
    ])

    const cls = await readClass(classId)
    expect(cls.iccfClassCode).toBe('B3000490')
    expect(cls.iccfClassCodeHistory ?? []).toHaveLength(0)
  })
})
