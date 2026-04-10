import { apiGet, apiPost, apiPut } from './client'
import type { WeeklyTask } from '../../types'

// ─── Date utilities (same logic as firebase/weekly.ts) ───────────────────────

function toLocalDateStr(d: Date): string {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return toLocalDateStr(d)
}

export function shiftWeek(weekStart: string, n: number): string {
  const d = new Date(weekStart + 'T00:00:00')
  d.setDate(d.getDate() + n * 7)
  return toLocalDateStr(d)
}

export function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`
  return `${fmt(start)}（一）∼ ${fmt(end)}（日）`
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function getOrCreateWeeklyTask(
  classId: string,
  weekStart: string,
): Promise<WeeklyTask> {
  return apiPost<WeeklyTask>('/api/weekly-tasks/get-or-create', { classId, weekStart })
}

export async function updateWeeklyTask(
  classId: string,
  weekStart: string,
  data: Partial<Omit<WeeklyTask, 'id' | 'weekStart'>>,
): Promise<void> {
  const id = `${classId}_${weekStart}`
  await apiPut(`/api/weekly-tasks/${id}`, data)
}

/**
 * Poll-based substitute for onSnapshot.
 */
export function subscribeToWeeklyTask(
  classId: string,
  weekStart: string,
  onData: (task: WeeklyTask | null) => void,
): () => void {
  const doFetch = () =>
    apiGet<WeeklyTask | null>(`/api/weekly-tasks?classId=${classId}&weekStart=${weekStart}`)
      .then(onData)
      .catch(console.error)

  doFetch()
  const id = setInterval(doFetch, 4000)
  return () => clearInterval(id)
}

export async function toggleSpeakerStatus(
  classId: string,
  weekStart: string,
  date: string,
  invited: boolean,
): Promise<void> {
  const id = `${classId}_${weekStart}`
  await apiPut(`/api/weekly-tasks/${id}`, { [`speakerStatuses.${date}`]: invited })
}

export async function toggleVerifyStatus(
  classId: string,
  weekStart: string,
  date: string,
  verified: boolean,
): Promise<void> {
  const id = `${classId}_${weekStart}`
  await apiPut(`/api/weekly-tasks/${id}`, { [`verifyStatuses.${date}`]: verified })
}

export async function getWeeklyTaskNote(
  classId: string,
  weekStart: string,
): Promise<string> {
  try {
    const id = `${classId}_${weekStart}`
    const data = await apiGet<{ notes: string }>(`/api/weekly-tasks/${id}/note`)
    return data.notes
  } catch {
    return ''
  }
}

export async function getClassName(classId: string): Promise<string> {
  if (!classId) return '未知班級'
  try {
    const classes = await apiGet<Array<{ id: string; name: string }>>('/api/admin/classes')
    return classes.find(c => c.id === classId)?.name ?? classId
  } catch {
    return classId
  }
}
