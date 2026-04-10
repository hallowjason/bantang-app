import { useState, useEffect, useMemo } from 'react'
import { getAllClasses } from '../../lib/api/admin'
import { getWeekStart, shiftWeek, formatWeekRange } from '../../lib/api/weekly'
import { getScheduleCache } from '../../lib/google/schedule'
import type { Class, ScheduleData, UpcomingSpeaker } from '../../types'

// ─── 週課表頁（班員公開版）─────────────────────────────────

interface ClassSchedule {
  cls: Class
  data: ScheduleData | null
}

interface DateEntry {
  date: string
  cls: Class
  speaker: UpcomingSpeaker | null
}

async function fetchClassCache(classId: string, weekStart: string): Promise<ScheduleData | null> {
  return getScheduleCache(classId, weekStart)
}

/** YYYY-MM-DD → M月D日（週X） */
function formatDateFull(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`
}

export default function PortalSchedule() {
  const [weekOffset, setWeekOffset]     = useState(0)  // 0=本週, 1=下週
  const [classSchedules, setClassSchedules] = useState<ClassSchedule[]>([])
  const [loading, setLoading]               = useState(true)

  // 目標週次
  const currentWeekStart  = getWeekStart()
  const targetWeekStart   = shiftWeek(currentWeekStart, weekOffset)
  const nextWeekStart     = shiftWeek(targetWeekStart, 1)  // 用於日期範圍上界

  useEffect(() => {
    setLoading(true)
    ;(async () => {
      const classes = await getAllClasses()
      const results = await Promise.all(
        classes.map(async cls => ({
          cls,
          // 快取 key 永遠使用「本週一」；upcomingSpeakers 包含未來 4 週資料，
          // 顯示哪一週由 targetWeekStart 的日期範圍過濾決定
          data: await fetchClassCache(cls.id, currentWeekStart),
        })),
      )
      setClassSchedules(results)
      setLoading(false)
    })().catch(console.error)
  }, [currentWeekStart])

  // ── 以日期範圍過濾並分組（只在資料或目標週變動時重算）───────
  //
  // 以 s.date >= targetWeekStart && s.date < nextWeekStart 篩選，
  // 不依賴 weekLabel 欄位，避免快取時間差造成錯誤顯示。

  const { dateMap, sortedDates, hasAnySync, hasNoSync } = useMemo(() => {
    const map = new Map<string, DateEntry[]>()
    let anySync = false
    let noSync  = false

    for (const { cls, data } of classSchedules) {
      if (!data) { noSync = true; continue }
      anySync = true

      for (const spk of data.upcomingSpeakers) {
        if (spk.date < targetWeekStart || spk.date >= nextWeekStart) continue
        if (!map.has(spk.date)) map.set(spk.date, [])
        map.get(spk.date)!.push({ date: spk.date, cls, speaker: spk })
      }
    }

    return {
      dateMap:     map,
      sortedDates: [...map.keys()].sort(),
      hasAnySync:  anySync,
      hasNoSync:   noSync,
    }
  }, [classSchedules, targetWeekStart, nextWeekStart])

  return (
    <div className="max-w-lg mx-auto px-4 pt-5 flex flex-col gap-4 pb-6">

      {/* ── 本週 / 下週 tab ── */}
      <div className="flex gap-1 bg-white rounded-2xl shadow-sm p-1">
        {(['本週', '下週'] as const).map((label, idx) => (
          <button
            key={label}
            onClick={() => setWeekOffset(idx)}
            className={`flex-1 py-2 text-xs font-medium rounded-xl transition-colors ${
              weekOffset === idx
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── 週次標題 ── */}
      <div className="bg-white rounded-2xl shadow-sm px-4 py-3 text-center">
        <p className="text-xs text-gray-400 font-medium">{weekOffset === 0 ? '本週課表' : '下週課表'}</p>
        <p className="text-sm font-semibold text-gray-700">{formatWeekRange(targetWeekStart)}</p>
      </div>

      {/* ── 內容 ── */}
      {loading ? (
        <p className="text-center text-sm text-gray-400 py-8">讀取中...</p>
      ) : !hasAnySync ? (
        <div className="bg-white rounded-2xl shadow-sm px-5 py-8 text-center">
          <p className="text-sm text-gray-400">課表尚未同步</p>
          <p className="text-xs text-gray-300 mt-1">請稍後再回來查看</p>
        </div>
      ) : sortedDates.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm px-5 py-6 text-center">
          <p className="text-sm text-gray-400">{weekOffset === 0 ? '本週' : '下週'}沒有課程安排</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedDates.map(date => {
            const entries = dateMap.get(date)!
            return (
              <div key={date} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                {/* 日期標頭 */}
                <div className="bg-sky-50 px-4 py-2 border-b border-sky-100">
                  <p className="text-xs font-semibold text-sky-700">{formatDateFull(date)}</p>
                </div>

                {/* 各班條目 */}
                <div className="divide-y divide-gray-50">
                  {entries.map(({ cls, speaker }) => (
                    <div key={cls.id} className="px-4 py-3 flex flex-col gap-0.5">
                      <p className="text-xs font-semibold text-gray-700">{cls.name}</p>
                      {speaker && speaker.name ? (
                        <>
                          <p className="text-xs text-gray-500">
                            講師：{speaker.name}
                          </p>
                          {speaker.topic ? (
                            <p className="text-xs text-gray-500">
                              講題：{speaker.topic}
                            </p>
                          ) : (
                            <p className="text-xs text-gray-300">講題：（待確認）</p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-gray-300">本週無安排</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* 部分班別尚未同步提示 */}
          {hasNoSync && (
            <p className="text-[11px] text-gray-300 text-center px-2">
              部分班別課表尚未同步，如有疑問請洽詢領班。
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] text-gray-400 text-center">
        課表資料由領班定期同步，如有出入請洽詢領班確認。
      </p>
    </div>
  )
}
