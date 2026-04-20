import { apiPost, apiGet } from './client'

export type SyncJobStatus = 'pending' | 'processing' | 'done' | 'failed'
export type SyncJobErrorCode = 'session_expired' | 'network_error' | 'unknown'

export interface SyncJobResult {
  marked: string[]
  notFound: string[]
  error?: string
}

export interface SyncJob {
  jobId: string
  status: SyncJobStatus
  result: SyncJobResult | null
  error: string | null
  errorCode: SyncJobErrorCode | null
  createdAt: string
  updatedAt: string
}

export interface CreateSyncJobResponse {
  jobId: string | null
  message?: string
  /** True when the iccf session was dead before the job was even queued. */
  sessionExpired?: boolean
  /** True when this (classId, date) was already synced successfully. Pass force:true to override. */
  alreadySynced?: boolean
  iccfSyncedAt?: string
}

export async function createIccfSyncJob(params: {
  classId: string
  date: string
  sessionId: string
  topicName: string
  force?: boolean
}): Promise<CreateSyncJobResponse> {
  return apiPost<CreateSyncJobResponse>('/api/iccf/sync', params)
}

export async function pollIccfSyncJob(jobId: string): Promise<SyncJob> {
  return apiGet<SyncJob>(`/api/iccf/sync/${jobId}`)
}
