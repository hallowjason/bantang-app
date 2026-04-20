import { apiPost, apiGet } from './client'

export type SyncJobStatus = 'pending' | 'processing' | 'done' | 'failed'

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
  createdAt: string
  updatedAt: string
}

export async function createIccfSyncJob(params: {
  classId: string
  date: string
  sessionId: string
  topicName: string
}): Promise<{ jobId: string | null; message?: string }> {
  const data = await apiPost<{ jobId: string | null; message?: string }>('/api/iccf/sync', params)
  return data
}

export async function pollIccfSyncJob(jobId: string): Promise<SyncJob> {
  return apiGet<SyncJob>(`/api/iccf/sync/${jobId}`)
}
