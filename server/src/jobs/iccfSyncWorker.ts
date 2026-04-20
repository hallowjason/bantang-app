import { randomUUID } from 'crypto'
import { ensureAlive } from '../iccf/ensureAlive'
import { markAttendance, type MarkAttendanceResult } from '../iccf/client'

export type SyncJobErrorCode = 'session_expired' | 'network_error' | 'unknown'

// ─── Job types ────────────────────────────────────────────

export type SyncJobStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface IccfSyncJob {
  jobId: string
  classId: string
  classCode: string   // iccf B-number (e.g. "B3000549"), stored as class.iccfClassCode in DB
  date: string        // YYYY-MM-DD
  topicName: string   // 課程名稱 for 設定課程 step
  sessionId: string
  presentMemberNames: string[]
  status: SyncJobStatus
  result?: MarkAttendanceResult
  error?: string
  errorCode?: SyncJobErrorCode
  createdAt: Date
  updatedAt: Date
}

// ─── In-memory store ──────────────────────────────────────

const jobs = new Map<string, IccfSyncJob>()

const JOB_TTL_MS = 60 * 60 * 1000

export function createSyncJob(params: {
  classId: string
  classCode: string
  date: string
  topicName: string
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
    const alive = await ensureAlive(job.sessionId)
    if (!alive.ok) {
      job.status = 'failed'
      job.error = alive.message
      job.errorCode = 'session_expired'
      job.updatedAt = new Date()
      return
    }

    // job.classCode is the B-number (e.g. "B3000549") stored in the bantang class.
    // Find the matching session entry to get the sec_code (e.g. "TWC") for form submissions.
    const classEntry = alive.session.classes.find(c => c.iccfClassCode === job.classCode)
    const secCode = classEntry?.classCode ?? job.classCode

    const result = await markAttendance(
      alive.session.cookieJar,
      secCode,
      job.classCode,
      job.date,
      job.topicName,
      job.presentMemberNames,
    )

    job.result = result
    job.status = result.error ? 'failed' : 'done'
    job.error = result.error
    job.updatedAt = new Date()
  } catch (e) {
    job.status = 'failed'
    job.error = (e as Error).message
    job.errorCode = 'unknown'
    job.updatedAt = new Date()
  }
}
