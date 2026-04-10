import { Router, Response } from 'express'
import { getDB } from '../db'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import type { Attendance, AttendanceStatus } from '../types'

const router = Router()
router.use(requireAuth)

// ─── GET /api/attendance?classId=&date= ──────────────────────────────────────

router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, date } = req.query as { classId?: string; date?: string }
  if (!classId || !date) {
    res.status(400).json({ success: false, error: 'classId and date are required' })
    return
  }

  const db = getDB()
  const records = await db.collection<Attendance>('attendance')
    .find({ classId, date })
    .toArray()

  res.json({ success: true, data: records.map(toDto) })
})

// ─── PUT /api/attendance/:id — Upsert single record ──────────────────────────

router.put('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, memberId, date, status, note } = req.body as {
    classId: string
    memberId: string
    date: string
    status: AttendanceStatus
    note?: string
  }

  const id = `${classId}_${memberId}_${date}`
  const now = new Date().toISOString()
  const db = getDB()

  // Upsert: on insert set recordedBy; always update lastUpdatedBy
  await db.collection<Attendance>('attendance').updateOne(
    { _id: id },
    {
      $set: {
        memberId,
        classId,
        date,
        status,
        note: note ?? '',
        lastUpdatedBy: req.user!._id,
        lastUpdatedAt: now,
      },
      $setOnInsert: {
        _id: id,
        recordedBy: req.user!._id,
      },
    },
    { upsert: true },
  )

  res.json({ success: true })
})

// ─── POST /api/attendance/init-absent — Batch init absent ────────────────────

router.post('/init-absent', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, memberIds, date } = req.body as {
    classId: string
    memberIds: string[]
    date: string
  }

  if (!classId || !memberIds?.length || !date) {
    res.status(400).json({ success: false, error: 'classId, memberIds, date are required' })
    return
  }

  const now = new Date().toISOString()
  const db = getDB()
  const col = db.collection<Attendance>('attendance')

  // Find already existing records for this class+date
  const existing = await col
    .find({ classId, date })
    .project({ _id: 1, memberId: 1 })
    .toArray()
  const existingSet = new Set(existing.map(r => r.memberId))

  const toInsert = memberIds
    .filter(mid => !existingSet.has(mid))
    .map(memberId => ({
      _id: `${classId}_${memberId}_${date}`,
      memberId,
      classId,
      date,
      status: 'absent' as AttendanceStatus,
      note: '',
      recordedBy: req.user!._id,
      lastUpdatedBy: req.user!._id,
      lastUpdatedAt: now,
    }))

  if (toInsert.length > 0) {
    await col.insertMany(toInsert, { ordered: false })
  }

  res.json({ success: true, data: { inserted: toInsert.length } })
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function toDto(a: Attendance) {
  return {
    id: a._id,
    memberId: a.memberId,
    classId: a.classId,
    date: a.date,
    status: a.status,
    note: a.note,
    recordedBy: a.recordedBy,
    lastUpdatedBy: a.lastUpdatedBy,
    lastUpdatedAt: a.lastUpdatedAt,
  }
}

export default router
