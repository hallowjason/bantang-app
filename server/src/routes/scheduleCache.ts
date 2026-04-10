import { Router, Response } from 'express'
import { getDB } from '../db'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import type { ScheduleData } from '../types'

interface ScheduleCacheDoc {
  _id: string   // "{classId}_{weekStart}"
  classId: string
  weekStart: string
  data: ScheduleData
  cachedAt: number  // Date.now()
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

const router = Router()

/** GET /api/schedule-cache?classId=&weekStart= */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, weekStart } = req.query as { classId?: string; weekStart?: string }
  if (!classId || !weekStart) {
    res.status(400).json({ success: false, error: 'classId and weekStart are required' })
    return
  }

  const id = `${classId}_${weekStart}`
  const db = getDB()
  const doc = await db.collection<ScheduleCacheDoc>('schedule_cache').findOne({ _id: id })

  if (!doc) {
    res.json({ success: true, data: null })
    return
  }

  // Expire stale cache
  if (Date.now() - doc.cachedAt > CACHE_TTL_MS) {
    res.json({ success: true, data: null })
    return
  }

  res.json({ success: true, data: doc.data })
})

/** POST /api/schedule-cache — Save schedule to cache */
router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, weekStart, data } = req.body as {
    classId: string
    weekStart: string
    data: ScheduleData
  }

  if (!classId || !weekStart || !data) {
    res.status(400).json({ success: false, error: 'classId, weekStart, data are required' })
    return
  }

  const id = `${classId}_${weekStart}`
  const doc: ScheduleCacheDoc = {
    _id: id,
    classId,
    weekStart,
    data,
    cachedAt: Date.now(),
  }

  const db = getDB()
  await db.collection<ScheduleCacheDoc>('schedule_cache').replaceOne(
    { _id: id },
    doc,
    { upsert: true },
  )

  res.json({ success: true })
})

export default router
