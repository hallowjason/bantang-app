import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getAllClasses } from '../lib/api/admin'
import { getMembers } from '../lib/api/members'
import { getWeekStart, shiftWeek } from '../lib/api/weekly'
import { getAllStats } from '../lib/api/stats'
import type { Class, Member } from '../types'
import type { WeekStat, MemberWeekHistory } from '../lib/api/stats'

// ─── 工具 ─────────────────────────────────────────────────

/** 建立最近 n 週的週起始日期陣列（最舊→最新） */
function buildWeeks(count: number): string[] {
  const current = getWeekStart()
  const weeks: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    weeks.push(shiftWeek(current, -i))
  }
  return weeks
}

// ─── 班員顏色盤（暖色系，6色循環）──────────────────────────

const COLORS = [
  '#2563eb', // 藍
  '#d97706', // 琥珀
  '#16a34a', // 綠
  '#7c3aed', // 紫
  '#0891b2', // 青
  '#be185d', // 玫紅
]
function memberColor(idx: number) { return COLORS[idx % COLORS.length] }

// ─── 班級長條圖 SVG ───────────────────────────────────────

function ClassBarChart({ stats }: { stats: WeekStat[] }) {
  const n = stats.length
  if (n === 0) return null

  const VW = 400
  const VH = 170
  const PAD = { top: 32, right: 12, bottom: 28, left: 12 }
  const chartW = VW - PAD.left - PAD.right
  const chartH = VH - PAD.top - PAD.bottom

  const maxCount = Math.max(...stats.map(s => s.presentCount), 1)
  const step = chartW / n
  const barW = Math.min(28, step * 0.6)

  function barX(i: number) { return PAD.left + step * i + step / 2 }
  function barH(count: number) { return (count / maxCount) * chartH }

  return (
    <div>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="w-full"
        aria-label="班級出席長條圖"
      >
        {/* 水平刻度線 */}
        {[0.25, 0.5, 0.75, 1].map(pct => {
          const y = PAD.top + chartH * (1 - pct)
          return (
            <line
              key={pct}
              x1={PAD.left} y1={y}
              x2={VW - PAD.right} y2={y}
              stroke="#f3f4f6"
              strokeWidth={1}
            />
          )
        })}

        {stats.map((s, i) => {
          const cx   = barX(i)
          const bh   = barH(s.presentCount)
          const barY = PAD.top + chartH - bh

          return (
            <g key={s.weekStart}>
              {/* 長條 */}
              <rect
                x={cx - barW / 2}
                y={barY}
                width={barW}
                height={bh}
                fill="#f59e0b"
                rx={4}
              />
              {/* 數字 */}
              <text
                x={cx}
                y={barY - 6}
                textAnchor="middle"
                fontSize={11}
                fontWeight="700"
                fill="#92400e"
              >
                {s.presentCount}
              </text>
              {/* 日期標籤（實際點名日） */}
              <text
                x={cx}
                y={VH - 6}
                textAnchor="middle"
                fontSize={9}
                fill="#9ca3af"
              >
                {s.dateLabel}
              </text>
              {/* 有備註時顯示小標記 */}
              {s.notes && (
                <text
                  x={cx}
                  y={VH - 16}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#f59e0b"
                >
                  ▲
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* 備註氣泡列 */}
      {stats.some(s => s.notes) && (
        <div className="flex mt-1" aria-label="週次備註">
          {stats.map((s, i) => (
            <div key={i} className="flex-1 flex justify-center px-0.5">
              {s.notes && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-2 py-1 text-[10px] text-yellow-800 text-center leading-snug max-w-[80px]">
                  {s.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 班員爬階圖（迷你 / 展開） ────────────────────────────

function MemberChart({
  history,
  color,
  weeks,
  actualDates,
  expanded = false,
}: {
  history: MemberWeekHistory
  color: string
  weeks: string[]
  actualDates?: string[]
  expanded?: boolean
}) {
  const VW = expanded ? 340 : 200
  const VH = expanded ? 180 : 100
  const PAD = { top: 10, right: 8, bottom: 22, left: 18 }
  const chartW = VW - PAD.left - PAD.right
  const chartH = VH - PAD.top - PAD.bottom

  const n = weeks.length
  const maxVal = Math.max(history.total, 1)

  function toX(i: number) {
    return PAD.left + (n <= 1 ? chartW / 2 : (i / (n - 1)) * chartW)
  }
  function toY(val: number) {
    return PAD.top + chartH - (val / maxVal) * chartH
  }

  // 爬階路徑：每步先水平後垂直
  let pathD = ''
  if (n > 0) {
    pathD = `M ${toX(0)},${toY(history.cumulativeCounts[0])}`
    for (let i = 1; i < n; i++) {
      pathD += ` H ${toX(i)} V ${toY(history.cumulativeCounts[i])}`
    }
  }

  // X 軸只顯示首、中、尾三個標籤
  const showLabels = new Set([0, Math.floor((n - 1) / 2), n - 1])

  function xLabel(i: number): string {
    if (actualDates && actualDates[i]) {
      const parts = actualDates[i].split('-')
      return `${parseInt(parts[1])}/${parseInt(parts[2])}`
    }
    const [, m, d] = weeks[i].split('-')
    return `${parseInt(m)}/${parseInt(d)}`
  }

  return (
    <div className={expanded ? '' : 'bg-white rounded-xl p-3 shadow-sm border border-amber-50'}>
      {!expanded && (
        <div className="text-xs font-semibold mb-1 truncate" style={{ color }}>
          {history.memberName}
        </div>
      )}
      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full">
        {/* Y 軸刻度：0 與最大值 */}
        {[0, maxVal].map(v => (
          <text
            key={v}
            x={PAD.left - 3}
            y={toY(v) + 3.5}
            textAnchor="end"
            fontSize={8}
            fill="#d1d5db"
          >
            {v}
          </text>
        ))}

        {/* 爬階折線 */}
        {n > 0 && (
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        )}

        {/* 資料點 */}
        {history.cumulativeCounts.map((val, i) => (
          <circle
            key={i}
            cx={toX(i)}
            cy={toY(val)}
            r={2.5}
            fill={color}
          />
        ))}

        {/* X 軸日期標籤 */}
        {weeks.map((_, i) => {
          if (!showLabels.has(i)) return null
          return (
            <text
              key={i}
              x={toX(i)}
              y={VH - 4}
              textAnchor="middle"
              fontSize={8}
              fill="#9ca3af"
            >
              {xLabel(i)}
            </text>
          )
        })}
      </svg>
      <div className="text-[10px] text-right text-gray-400 -mt-1">
        共 {history.total} 堂
      </div>
    </div>
  )
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function Stats() {
  const { user } = useAuth()

  // ── 班別 ──
  const [allClasses, setAllClasses] = useState<Class[]>([])
  const [selectedClassId, setSelectedClassId] = useState('')

  // ── 模式 & 週數 ──
  const [mode, setMode]           = useState<'class' | 'member'>('class')
  const [weekCount, setWeekCount] = useState(4)
  const [weeks, setWeeks]         = useState<string[]>(() => buildWeeks(4))

  // ── 資料 ──
  const [classStats,    setClassStats]    = useState<WeekStat[]>([])
  const [memberHistory, setMemberHistory] = useState<MemberWeekHistory[]>([])
  const [members,       setMembers]       = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  // ── 展開班員圖表 modal ──
  const [expandedMember, setExpandedMember] = useState<{ history: MemberWeekHistory; color: string } | null>(null)

  // 初始化班別（大領班可切換所有班）
  useEffect(() => {
    if (!user) return
    if (user.role === 'head_leader') {
      getAllClasses()
        .then(cls => {
          setAllClasses(cls)
          setSelectedClassId(user.classId || cls[0]?.id || '')
        })
        .catch(console.error)
    } else {
      setSelectedClassId(user.classId)
    }
  }, [user])

  // 週數改變 → 重建 weeks 陣列
  useEffect(() => {
    setWeeks(buildWeeks(weekCount))
  }, [weekCount])

  // 班別或週數改變 → 重新載入
  useEffect(() => {
    if (!selectedClassId || weeks.length === 0) return
    setLoading(true)
    setError('')

    const load = async () => {
      const memberList = await getMembers(selectedClassId)
      setMembers(memberList)
      const { classStats: cs, memberHistory: mh } = await getAllStats(
        selectedClassId,
        weeks,
        memberList,
      )
      setClassStats(cs)
      setMemberHistory(mh)
    }

    load()
      .catch(err => setError((err as Error).message || '載入失敗'))
      .finally(() => setLoading(false))
  }, [selectedClassId, weeks])

  // ── className 顯示用 ──────────────────────────────────────
  const displayClassName = allClasses.find(c => c.id === selectedClassId)?.name
    ?? members[0]?.name  // fallback
    ?? selectedClassId

  const actualDates = classStats.map(s => s.actualDate)

  // ─── 渲染 ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-amber-50 pb-24">
      {/* 頁首 */}
      <header className="bg-white border-b border-amber-100 px-4 pt-safe-top">
        <div className="max-w-screen-sm mx-auto flex items-center justify-between py-4">
          <h1 className="text-lg font-bold text-amber-900">出席統計</h1>

          {/* 大領班：班別切換 */}
          {user?.role === 'head_leader' && allClasses.length > 0 && (
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              className="text-sm border border-amber-200 rounded-lg px-2 py-1 bg-amber-50 text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
            >
              {allClasses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      </header>

      <div className="max-w-screen-sm mx-auto px-4 py-4 space-y-4">

        {/* 週數選擇器 */}
        <div className="flex gap-2">
          {([4, 8] as const).map(n => (
            <button
              key={n}
              onClick={() => setWeekCount(n)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors
                ${weekCount === n
                  ? 'bg-amber-500 text-white'
                  : 'bg-white text-gray-500 border border-gray-200'}`}
            >
              近 {n} 週
            </button>
          ))}
        </div>

        {/* Tab 切換 */}
        <div className="flex bg-white rounded-xl border border-amber-100 overflow-hidden">
          {(['class', 'member'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors
                ${mode === m
                  ? 'bg-amber-500 text-white'
                  : 'text-gray-500'}`}
            >
              {m === 'class' ? '📊 班級趨勢' : '👤 班員紀錄'}
            </button>
          ))}
        </div>

        {/* 載入中 */}
        {loading && (
          <div className="flex justify-center py-16">
            <p className="text-gray-400 text-sm animate-pulse">載入中…</p>
          </div>
        )}

        {/* 錯誤 */}
        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* ── Tab 1：班級趨勢 ── */}
        {!loading && !error && mode === 'class' && (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-amber-900">各週出席人數</h2>
              <span className="text-xs text-gray-400">{displayClassName}</span>
            </div>

            {classStats.every(s => s.presentCount === 0) ? (
              <p className="text-center text-gray-400 text-sm py-8">
                此期間尚無出席紀錄
              </p>
            ) : (
              <ClassBarChart stats={classStats} />
            )}
          </div>
        )}

        {/* ── Tab 2：班員紀錄 ── */}
        {!loading && !error && mode === 'member' && (
          <div>
            {memberHistory.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-amber-50 p-8 text-center">
                <p className="text-gray-400 text-sm">此期間尚無出席紀錄</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {memberHistory.map((mh, idx) => (
                  <button
                    key={mh.memberId}
                    onClick={() => setExpandedMember({ history: mh, color: memberColor(idx) })}
                    className="text-left w-full focus:outline-none"
                  >
                    <MemberChart
                      history={mh}
                      color={memberColor(idx)}
                      weeks={weeks}
                      actualDates={actualDates}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── 班員圖表放大 Modal ── */}
      {expandedMember && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setExpandedMember(null)}
        >
          <div
            className="bg-white rounded-2xl p-4 w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <span className="font-semibold text-gray-800" style={{ color: expandedMember.color }}>
                {expandedMember.history.memberName}
              </span>
              <button
                onClick={() => setExpandedMember(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1"
              >
                ✕
              </button>
            </div>
            <MemberChart
              history={expandedMember.history}
              color={expandedMember.color}
              weeks={weeks}
              actualDates={actualDates}
              expanded
            />
          </div>
        </div>
      )}
    </div>
  )
}
