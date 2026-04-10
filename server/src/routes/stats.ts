import { Router, Response } from 'express'
import { getDB } from '../db'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import type { Attendance, Member, WeeklyTask } from '../types'

const router = Router()
router.use(requireAuth)

interface WeekStat {
  weekStart: string
  dateLabel: string
  actualDate: string
  presentCount: number
  notes: string
}

interface MemberWeekHistory {
  memberId: string
  memberName: string
  weekCounts: number[]
  cumulativeCounts: number[]
  total: number
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function toDateLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// ─── GET /api/stats?classId=&weeks= ──────────────────────────────────────────
// weeks: comma-separated week start dates, e.g. "2026-01-06,2026-01-13"

router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, weeks: weeksParam } = req.query as { classId?: string; weeks?: string }

  if (!classId || !weeksParam) {
    res.status(400).json({ success: false, error: 'classId and weeks are required' })
    return
  }

  const weeks = weeksParam.split(',').filter(Boolean)
  if (weeks.length === 0) {
    res.json({ success: true, data: { classStats: [], memberHistory: [] } })
    return
  }

  const fromDate = weeks[0]
  const toDate = addDays(weeks[weeks.length - 1], 6)

  const db = getDB()

  // Fetch attendance records in range + weekly task notes in parallel
  const [records, members, weeklyTasks] = await Promise.all([
    db.collection<Attendance>('attendance')
      .find({ classId, date: { $gte: fromDate, $lte: toDate } })
      .toArray(),
    db.collection<Member>('members').find().toArray(),
    db.collection<WeeklyTask>('weekly_tasks')
      .find({ classId, weekStart: { $in: weeks } })
      .toArray(),
  ])

  const notesMap = new Map(weeklyTasks.map(t => [t.weekStart, t.notes ?? '']))

  // Class stats
  const classStats: WeekStat[] = weeks.map(weekStart => {
    const weekEnd = addDays(weekStart, 6)
    const weekRecords = records.filter(
      r => r.status === 'present' && r.date >= weekStart && r.date <= weekEnd,
    )
    const presentCount = weekRecords.length
    const dateFreq: Record<string, number> = {}
    weekRecords.forEach(r => { dateFreq[r.date] = (dateFreq[r.date] ?? 0) + 1 })
    const actualDate =
      Object.entries(dateFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? weekStart
    return {
      weekStart,
      actualDate,
      dateLabel: toDateLabel(actualDate),
      presentCount,
      notes: notesMap.get(weekStart) ?? '',
    }
  })

  // Member history
  const byMember: Record<string, Attendance[]> = {}
  for (const r of records) {
    if (!byMember[r.memberId]) byMember[r.memberId] = []
    byMember[r.memberId].push(r)
  }

  const memberHistory: MemberWeekHistory[] = members
    .map(member => {
      const mrs = byMember[member._id] ?? []
      let cumulative = 0
      const weekCounts: number[] = []
      const cumulativeCounts: number[] = []

      for (const weekStart of weeks) {
        const weekEnd = addDays(weekStart, 6)
        const attended = mrs.some(
          r => r.status === 'present' && r.date >= weekStart && r.date <= weekEnd,
        ) ? 1 : 0
        cumulative += attended
        weekCounts.push(attended)
        cumulativeCounts.push(cumulative)
      }

      return {
        memberId: member._id,
        memberName: member.name,
        weekCounts,
        cumulativeCounts,
        total: cumulative,
      }
    })
    .sort((a, b) => b.total - a.total)

  res.json({ success: true, data: { classStats, memberHistory } })
})

export default router
