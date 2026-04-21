import { Router, Response } from 'express'
import { getDB } from '../db'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import type { WeeklyTask } from '../types'

const router = Router()
router.use(requireAuth)

// ─── GET /api/weekly-tasks?classId=&weekStart= ───────────────────────────────

router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, weekStart } = req.query as { classId?: string; weekStart?: string }
  if (!classId || !weekStart) {
    res.status(400).json({ success: false, error: 'classId and weekStart are required' })
    return
  }

  const id = `${classId}_${weekStart}`
  const db = getDB()
  const task = await db.collection<WeeklyTask>('weekly_tasks').findOne({ _id: id })
  res.json({ success: true, data: task ? toDto(task) : null })
})

// ─── POST /api/weekly-tasks/get-or-create ────────────────────────────────────

router.post('/get-or-create', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, weekStart } = req.body as { classId: string; weekStart: string }
  if (!classId || !weekStart) {
    res.status(400).json({ success: false, error: 'classId and weekStart are required' })
    return
  }

  const id = `${classId}_${weekStart}`
  const db = getDB()
  const col = db.collection<WeeklyTask>('weekly_tasks')

  // Use upsert to avoid duplicate-key errors from concurrent calls
  // (React strict mode fires effects twice; both may reach here before the first insert completes)
  await col.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        _id: id,
        classId,
        weekStart,
        hostNotified: false,
        speakerStatuses: {},
        verifyStatuses: {},
        notes: '',
      } satisfies WeeklyTask,
    },
    { upsert: true },
  )
  const task = (await col.findOne({ _id: id }))!
  res.json({ success: true, data: toDto(task) })
})

// ─── PUT /api/weekly-tasks/:id — Update weekly task ──────────────────────────

router.put('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const update = req.body as Partial<Omit<WeeklyTask, '_id'>>
  const db = getDB()
  await db.collection<WeeklyTask>('weekly_tasks').updateOne(
    { _id: req.params.id },
    { $set: update },
  )
  res.json({ success: true })
})

// ─── GET /api/weekly-tasks/:id/note — Notes only (for stats) ─────────────────

router.get('/:id/note', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()
  const task = await db.collection<WeeklyTask>('weekly_tasks')
    .findOne({ _id: req.params.id }, { projection: { notes: 1 } })
  res.json({ success: true, data: { notes: task?.notes ?? '' } })
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function toDto(t: WeeklyTask) {
  return {
    id: t._id,
    classId: t.classId,
    weekStart: t.weekStart,
    hostNotified: t.hostNotified,
    speakerStatuses: t.speakerStatuses ?? {},
    verifyStatuses: t.verifyStatuses ?? {},
    notes: t.notes ?? '',
  }
}

export default router
