import { Router, Response } from 'express'
import { getDB } from '../db'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import type { Session } from '../types'

const router = Router()
router.use(requireAuth)

// ─── GET /api/sessions?classId=&date= ────────────────────────────────────────

router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, date } = req.query as { classId?: string; date?: string }
  if (!classId || !date) {
    res.status(400).json({ success: false, error: 'classId and date are required' })
    return
  }

  const id = `${classId}_${date}`
  const db = getDB()
  const session = await db.collection<Session>('sessions').findOne({ _id: id })
  res.json({ success: true, data: session ? toDto(session) : null })
})

// ─── POST /api/sessions/get-or-create ────────────────────────────────────────

router.post('/get-or-create', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, date } = req.body as { classId: string; date: string }
  if (!classId || !date) {
    res.status(400).json({ success: false, error: 'classId and date are required' })
    return
  }

  const id = `${classId}_${date}`
  const db = getDB()
  const col = db.collection<Session>('sessions')

  const existing = await col.findOne({ _id: id })
  if (existing) {
    res.json({ success: true, data: toDto(existing) })
    return
  }

  const now = new Date().toISOString()
  const newSession: Session = {
    _id: id,
    classId,
    date,
    createdBy: req.user!._id,
    createdAt: now,
    isFinalized: false,
  }
  await col.insertOne(newSession)
  res.json({ success: true, data: toDto(newSession) })
})

// ─── PUT /api/sessions/:id/finalize ──────────────────────────────────────────

router.put('/:id/finalize', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()
  await db.collection<Session>('sessions').updateOne(
    { _id: req.params.id },
    {
      $set: {
        isFinalized: true,
        finalizedAt: new Date().toISOString(),
        finalizedBy: req.user!._id,
      },
    },
  )
  res.json({ success: true })
})

// ─── PUT /api/sessions/:id/reopen ────────────────────────────────────────────

router.put('/:id/reopen', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()
  await db.collection<Session>('sessions').updateOne(
    { _id: _req.params.id },
    {
      $set: {
        isFinalized: false,
        finalizedAt: null,
        finalizedBy: null,
      },
    },
  )
  res.json({ success: true })
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function toDto(s: Session) {
  return {
    id: s._id,
    classId: s.classId,
    date: s.date,
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    isFinalized: s.isFinalized,
    finalizedAt: s.finalizedAt,
    finalizedBy: s.finalizedBy,
  }
}

export default router
