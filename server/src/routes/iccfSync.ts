import { Router, Response } from 'express'
import { getDB } from '../db'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import { createSyncJob, getJob } from '../jobs/iccfSyncWorker'
import { ensureAlive } from '../iccf/ensureAlive'
import type { Class, Attendance, Session } from '../types'

const router = Router()
router.use(requireAuth)

/**
 * POST /api/iccf/sync
 * Create an attendance sync job. Called after session finalization.
 *
 * Body: { classId, classCode, date, sessionId }
 *
 * Returns the job immediately with status "pending".
 * The worker runs asynchronously — poll GET /:jobId for progress.
 */
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, date, sessionId, topicName, force } = req.body as {
    classId?: string
    date?: string
    sessionId?: string
    topicName?: string
    force?: boolean
  }

  if (!classId || !date || !sessionId) {
    res.status(400).json({ success: false, error: 'classId, date, sessionId are required' })
    return
  }

  // Ownership check: the caller must be a member/leader of this class.
  // Admins (head_leader / class_master) may sync any class.
  const role = req.user?.role
  const isAdmin = role === 'head_leader' || role === 'class_master'
  if (!isAdmin && req.user?.classId !== classId) {
    res.status(403).json({ success: false, error: '無權同步此班' })
    return
  }

  const trimmedTopic = topicName?.trim() ?? ''
  if (!trimmedTopic) {
    res.status(400).json({
      success: false,
      error: '課程名稱不得為空（會清除 iccf 的備註欄）',
      code: 'empty_topic',
    })
    return
  }

  // Ping iccf upfront so we can ask the leader to re-login before a job is queued.
  const alive = await ensureAlive(sessionId)
  if (!alive.ok) {
    res.json({
      success: true,
      data: { jobId: null, sessionExpired: true, message: alive.message },
    })
    return
  }

  const db = getDB()

  // Duplicate-sync guard: if this (classId, date) Session was already synced
  // successfully, require the caller to pass force: true.
  const existingSession = await db.collection<Session>('sessions').findOne({ _id: `${classId}_${date}` })
  if (existingSession?.iccfSyncedAt && !force) {
    res.json({
      success: true,
      data: {
        jobId: null,
        alreadySynced: true,
        iccfSyncedAt: existingSession.iccfSyncedAt,
        message: '此班期已同步過 iccf；如需重新送出，請確認後再試',
      },
    })
    return
  }

  // Look up the B-number (e.g. B3000549) stored as iccfClassCode in the class document
  const cls = await db.collection<Class>('classes').findOne({ _id: classId })
  const iccfBCode = cls?.iccfClassCode?.trim()
  if (!iccfBCode) {
    res.status(400).json({ success: false, error: '此班尚未設定 iccf 班別編號（B-number）' })
    return
  }

  // Fetch the present/leave members for this class+date
  const records = await db.collection<Attendance>('attendance')
    .find({ classId, date, status: { $in: ['present', 'leave'] } })
    .toArray()

  if (records.length === 0) {
    res.json({ success: true, data: { jobId: null, message: '無出席班員，略過 iccf 同步' } })
    return
  }

  // We need member names — fetch from members collection
  const memberIds = records.map(r => r.memberId)
  const members = await db.collection<{ _id: string; name: string }>('members')
    .find({ _id: { $in: memberIds } })
    .project({ _id: 1, name: 1 })
    .toArray()

  const nameMap = new Map(members.map(m => [m._id, m.name]))
  const presentMemberNames = records
    .map(r => nameMap.get(r.memberId))
    .filter((n): n is string => !!n)

  const job = createSyncJob({
    classId,
    classCode: iccfBCode,
    date,
    topicName: trimmedTopic,
    sessionId,
    presentMemberNames,
  })

  res.json({ success: true, data: toJobDto(job) })
})

/**
 * GET /api/iccf/sync/:jobId
 * Poll a sync job status.
 */
router.get('/:jobId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const jobId = req.params['jobId'] as string
  const job = getJob(jobId)
  if (!job) {
    res.status(404).json({ success: false, error: 'job not found' })
    return
  }
  res.json({ success: true, data: toJobDto(job) })
})

function toJobDto(job: ReturnType<typeof getJob>) {
  if (!job) return null
  return {
    jobId: job.jobId,
    status: job.status,
    result: job.result ?? null,
    error: job.error ?? null,
    errorCode: job.errorCode ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  }
}

export default router
