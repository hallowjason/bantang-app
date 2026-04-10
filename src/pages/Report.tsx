import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { getMembers } from '../lib/api/members'
import { getClassAttendance } from '../lib/api/attendance'
import { getClassName, getWeekStart, getOrCreateWeeklyTask } from '../lib/api/weekly'
import type { Member, Attendance } from '../types'

// ─── 工具 ─────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function buildReport(params: {
  date: string
  className: string
  present: Member[]
  leave: Member[]
  absent: Member[]
  notes: string
}): string {
  const { date, className, present, leave, absent, notes } = params
  const lines: string[] = []

  lines.push('【進階班出席報表】')
  lines.push(`日期：${formatDate(date)}`)
  lines.push(`班別：${className}`)
  lines.push('')
  lines.push(`出席（${present.length}人）：${present.map(m => m.name).join('、') || '無'}`)

  if (leave.length > 0) {
    lines.push(`請假（${leave.length}人）：${leave.map(m => m.name).join('、')}`)
  }

  lines.push(`缺席（${absent.length}人）：${absent.map(m => m.name).join('、') || '無'}`)
  lines.push('')
  if (notes) lines.push(`備註：${notes}`)
  lines.push('')
  lines.push('— 由佛堂進階班系統自動產生')

  return lines.join('\n')
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function Report() {
  const { user } = useAuth()

  const [date, setDate]             = useState(todayStr)
  const [members, setMembers]       = useState<Member[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [className, setClassName]   = useState('')
  const [notes, setNotes]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [copied, setCopied]         = useState(false)

  // ─── 載入靜態資料（班員、班級名稱） ──────────────────────

  useEffect(() => {
    if (!user?.classId) return
    Promise.all([
      getMembers(user.classId),
      getClassName(user.classId),
    ]).then(([m, name]) => {
      setMembers(m)
      setClassName(name)
    })
  }, [user?.classId])

  // ─── 載入出席記錄 + 備註（隨日期變化） ───────────────────

  useEffect(() => {
    if (!user?.classId) return
    setLoading(true)
    const weekStart = getWeekStart(new Date(date + 'T00:00:00'))
    Promise.all([
      getClassAttendance(user.classId, date),
      getOrCreateWeeklyTask(user.classId, weekStart),
    ])
      .then(([att, task]) => {
        setAttendance(att)
        setNotes(task.notes ?? '')
      })
      .finally(() => setLoading(false))
  }, [user?.classId, date])

  // ─── 分組：出席 / 請假 / 缺席 ────────────────────────────

  const { present, leave, absent } = useMemo(() => {
    const attMap = new Map(attendance.map(a => [a.memberId, a.status]))
    const result = { present: [] as Member[], leave: [] as Member[], absent: [] as Member[] }
    for (const m of members) {
      const status = attMap.get(m.id) ?? 'absent'
      result[status].push(m)
    }
    return result
  }, [members, attendance])

  // ─── 報表文字 ────────────────────────────────────────────

  const reportText = useMemo(
    () => buildReport({ date, className, present, leave, absent, notes }),
    [date, className, present, leave, absent, notes],
  )

  // ─── 一鍵複製 ────────────────────────────────────────────

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText)
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea')
      el.value = reportText
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  // ─── 渲染 ────────────────────────────────────────────────

  if (!user?.classId) {
    return (
      <div className="min-h-screen bg-amber-50 flex items-center justify-center px-4 pb-16">
        <p className="text-sm text-amber-700 bg-white border border-amber-200 rounded-xl px-5 py-4 text-center shadow-sm">
          尚未設定所屬班級<br />
          <span className="text-gray-400">請聯絡管理員</span>
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-amber-50">

      {/* Header */}
      <header className="bg-white border-b border-amber-100 sticky top-0 z-10">
        <div className="max-w-screen-sm mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <h1 className="text-base font-bold text-gray-800 shrink-0">出席報表</h1>
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={e => setDate(e.target.value)}
            className="text-sm text-gray-700 border border-amber-200 rounded-lg px-2.5 py-1 bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
      </header>

      <main className="max-w-screen-sm mx-auto px-4 pt-4 pb-20 flex flex-col gap-4">

        {/* 統計卡片 */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard value={present.length} label="出席" color="green" />
          <StatCard value={leave.length}   label="請假" color="amber" />
          <StatCard value={absent.length}  label="缺席" color="gray"  />
        </div>

        {/* 報表預覽 */}
        <section className="bg-white rounded-2xl shadow-sm border border-amber-100">
          <div className="px-5 pt-4 pb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              報表預覽
            </p>
            {loading && <span className="text-xs text-gray-400">更新中...</span>}
          </div>
          <pre className="px-5 pb-5 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
            {reportText}
          </pre>
        </section>

        {/* 備註編輯 */}
        <section className="bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-4 flex flex-col gap-2">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            備註（選填）
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="輸入備註，會自動加入報表..."
            rows={2}
            className="w-full text-sm text-gray-800 placeholder-gray-300 resize-none focus:outline-none"
          />
        </section>
      </main>

      {/* 固定複製按鈕（BottomNav 上方） */}
      <div className="fixed bottom-16 left-0 right-0 z-10">
        <div className="max-w-screen-sm mx-auto px-4 py-3 bg-white/90 backdrop-blur-sm border-t border-amber-100">
          <button
            onClick={handleCopy}
            className={`w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] shadow-md
              ${copied
                ? 'bg-green-500 text-white'
                : 'bg-amber-700 text-white hover:bg-amber-800'
              }`}
          >
            {copied ? '✓ 已複製到剪貼簿！' : '一鍵複製報表'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 統計小卡 ─────────────────────────────────────────────

function StatCard({
  value,
  label,
  color,
}: {
  value: number
  label: string
  color: 'green' | 'amber' | 'gray'
}) {
  const colors = {
    green: 'text-green-600',
    amber: 'text-amber-600',
    gray:  'text-gray-400',
  }
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-amber-100 p-4 text-center flex flex-col items-center justify-center gap-1">
      <p className={`text-3xl font-bold leading-none ${colors[color]}`}>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  )
}
