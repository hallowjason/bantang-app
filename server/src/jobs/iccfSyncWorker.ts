import { randomUUID } from 'crypto'
import { getSession, touchSession } from '../iccf/sessionStore'
import { markAttendance, type MarkAttendanceResult } from '../iccf/client'

// ─── Job types ────────────────────────────────────────────

export type SyncJobStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface IccfSyncJob {
  jobId: string
  classId: string
  classCode: string
  date: string                  // YYYY-MM-DD
  sessionId: string
  presentMemberNames: string[]
  status: SyncJobStatus
  result?: MarkAttendanceResult
  error?: string
  createdAt: Date
  updatedAt: Date
}

// ─── In-memory store ──────────────────────────────────────

const jobs = new Map<string, IccfSyncJob>()

const JOB_TTL_MS = 60 * 60 * 1000 // keep jobs for 1 hour

/** Create and immediately enqueue a sync job. */
export function createSyncJob(params: {
  classId: string
  classCode: string
  date: string
  sessionId: string
  presentMemberNames: string[]
}): IccfSyncJob {
  const now = new Date()
  const job: IccfSyncJob = {
    jobId: randomUUID(),
    ...params,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }
  jobs.set(job.jobId, job)
  setImmediate(() => processJob(job.jobId))
  return job
}

export function getJob(jobId: string): IccfSyncJob | null {
  return jobs.get(jobId) ?? null
}

/** Purge jobs older than TTL. Call periodically. */
export function sweepOldJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt.getTime() < cutoff) jobs.delete(id)
  }
}

// ─── Worker ───────────────────────────────────────────────

async function processJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) return

  job.status = 'processing'
  job.updatedAt = new Date()

  try {
    const session = await getSession(job.sessionId)
    if (!session) {
      job.status = 'failed'
      job.error = 'iccf session 已過期，請重新登入'
      job.updatedAt = new Date()
      return
    }

    await touchSession(job.sessionId)

    const result = await markAttendance(
      session.cookieJar,
      job.classCode,
      job.date,
      job.presentMemberNames,
    )

    job.result = result
    job.status = result.error ? 'failed' : 'done'
    job.error = result.error
    job.updatedAt = new Date()
  } catch (e) {
    job.status = 'failed'
    job.error = (e as Error).message
    job.updatedAt = new Date()
  }
}
