import { Router } from 'express'
import { getDB } from '../db'
import type { AppUser, UserRole, Class, Member, ClassMember, Session, Attendance, AttendanceStatus } from '../types'

/**
 * Test-only seeding router. Registered on the main app ONLY when
 * FIREBASE_AUTH_EMULATOR_HOST is set (E2E / dev). Never mounted in production.
 */
const router = Router()

const ALL_ROLES: readonly UserRole[] = [
  'class_master',
  'head_leader',
  'leader',
  'junior_leader',
  'member',
]

// ─── POST /api/_test/seed-user ──────────────────────────────────────────────

router.post('/seed-user', async (req, res) => {
  const { uid, email, name, role, classId } = req.body ?? {}

  if (typeof uid !== 'string' || !uid) {
    res.status(400).json({ success: false, error: 'uid required' })
    return
  }
  if (!(ALL_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({ success: false, error: `role must be one of ${ALL_ROLES.join(', ')}` })
    return
  }

  const user = {
    _id: uid,
    name: typeof name === 'string' ? name : '',
    email: typeof email === 'string' ? email : null,
    photoURL: null,
    role: role as UserRole,
    classId: typeof classId === 'string' ? classId : '',
  }

  await getDB().collection<AppUser>('users').updateOne(
    { _id: uid },
    { $set: user },
    { upsert: true },
  )

  res.json({ success: true, data: user })
})

router.get('/user/:uid', async (req, res) => {
  const user = await getDB().collection<AppUser>('users').findOne({ _id: req.params.uid })
  if (!user) {
    res.status(404).json({ success: false, error: 'not found' })
    return
  }
  res.json({ success: true, data: user })
})

// ─── POST /api/_test/seed-class ─────────────────────────────────────────────

router.post('/seed-class', async (req, res) => {
  const { classId, name, leaderIds, iccfClassCode } = req.body ?? {}

  if (typeof classId !== 'string' || !classId) {
    res.status(400).json({ success: false, error: 'classId required' })
    return
  }
  if (typeof name !== 'string' || !name) {
    res.status(400).json({ success: false, error: 'name required' })
    return
  }

  const doc: Class = {
    _id: classId,
    name,
    leaderIds: Array.isArray(leaderIds) ? leaderIds.filter((x: unknown) => typeof x === 'string') : [],
    ...(typeof iccfClassCode === 'string' && iccfClassCode ? { iccfClassCode } : {}),
  }

  await getDB().collection<Class>('classes').updateOne(
    { _id: classId },
    { $set: doc },
    { upsert: true },
  )

  res.json({ success: true, data: doc })
})

// ─── POST /api/_test/seed-members ───────────────────────────────────────────
//
// Body: { classId, members: [{ id, name, regionUnit?, regionNumber? }] }
// Upserts into `members` and creates active `class_members` links.
router.post('/seed-members', async (req, res) => {
  const { classId, members } = req.body ?? {}

  if (typeof classId !== 'string' || !classId) {
    res.status(400).json({ success: false, error: 'classId required' })
    return
  }
  if (!Array.isArray(members) || members.length === 0) {
    res.status(400).json({ success: false, error: 'members array required' })
    return
  }

  const db = getDB()
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  const memberOps = members.map((m: { id: string; name: string; birthday?: string; regionUnit?: string; regionNumber?: string }) => ({
    updateOne: {
      filter: { _id: m.id },
      update: {
        $set: {
          _id: m.id,
          name: m.name,
          birthday: typeof m.birthday === 'string' ? m.birthday : '',
          initialAttendanceCount: 0,
          mentor: '',
          regionUnit: m.regionUnit ?? '',
          regionNumber: m.regionNumber ?? '',
          etiquetteItems: {},
          notes: '',
          createdAt: now,
          createdBy: 'e2e-seed',
        } satisfies Member,
      },
      upsert: true,
    },
  }))

  const linkOps = members.map((m: { id: string }) => ({
    updateOne: {
      filter: { _id: `${classId}_${m.id}` },
      update: {
        $set: {
          _id: `${classId}_${m.id}`,
          memberId: m.id,
          classId,
          joinedAt: today,
          addedBy: 'e2e-seed',
          isActive: true,
        } satisfies ClassMember,
      },
      upsert: true,
    },
  }))

  await db.collection<Member>('members').bulkWrite(memberOps)
  await db.collection<ClassMember>('class_members').bulkWrite(linkOps)

  res.json({ success: true, data: { count: members.length } })
})

// ─── POST /api/_test/seed-attendance ────────────────────────────────────────
//
// Body: { classId, date, records: [{ memberId, status }] }
// Upserts attendance records directly — bypasses session lock checks.
router.post('/seed-attendance', async (req, res) => {
  const { classId, date, records } = req.body ?? {}

  if (typeof classId !== 'string' || !classId) {
    res.status(400).json({ success: false, error: 'classId required' })
    return
  }
  if (typeof date !== 'string' || !date) {
    res.status(400).json({ success: false, error: 'date required' })
    return
  }
  if (!Array.isArray(records) || records.length === 0) {
    res.status(400).json({ success: false, error: 'records array required' })
    return
  }

  const db = getDB()
  const now = new Date().toISOString()

  const ops = (records as { memberId: string; status: AttendanceStatus }[]).map(r => ({
    updateOne: {
      filter: { _id: `${classId}_${r.memberId}_${date}` },
      update: {
        $set: {
          _id: `${classId}_${r.memberId}_${date}`,
          memberId: r.memberId,
          classId,
          date,
          status: r.status,
          note: '',
          recordedBy: 'e2e-seed',
          lastUpdatedBy: 'e2e-seed',
          lastUpdatedAt: now,
        } satisfies Attendance,
      },
      upsert: true,
    },
  }))

  await db.collection<Attendance>('attendance').bulkWrite(ops)
  res.json({ success: true, data: { count: records.length } })
})

// ─── POST /api/_test/reset-session ──────────────────────────────────────────
//
// Body: { classId, date }
// Wipes session + attendance rows for that class/date so a test can start clean.
router.post('/reset-session', async (req, res) => {
  const { classId, date } = req.body ?? {}

  if (typeof classId !== 'string' || !classId || typeof date !== 'string' || !date) {
    res.status(400).json({ success: false, error: 'classId and date required' })
    return
  }

  const db = getDB()
  const sessionId = `${classId}_${date}`
  await Promise.all([
    db.collection<Session>('sessions').deleteOne({ _id: sessionId }),
    db.collection<Attendance>('attendance').deleteMany({ classId, date }),
  ])

  res.json({ success: true })
})

export default router
