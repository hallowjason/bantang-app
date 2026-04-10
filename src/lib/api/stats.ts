import { apiGet } from './client'
import type { Member } from '../../types'

export interface WeekStat {
  weekStart: string
  dateLabel: string
  actualDate: string
  presentCount: number
  notes: string
}

export interface MemberWeekHistory {
  memberId: string
  memberName: string
  weekCounts: number[]
  cumulativeCounts: number[]
  total: number
}

export async function getAllStats(
  classId: string,
  weeks: string[],
  _members: Member[],
): Promise<{ classStats: WeekStat[]; memberHistory: MemberWeekHistory[] }> {
  if (weeks.length === 0) return { classStats: [], memberHistory: [] }
  const weeksParam = weeks.join(',')
  return apiGet<{ classStats: WeekStat[]; memberHistory: MemberWeekHistory[] }>(
    `/api/stats?classId=${classId}&weeks=${encodeURIComponent(weeksParam)}`,
  )
}
