import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  getWeekStart,
  shiftWeek,
  formatWeekRange,
  getOrCreateWeeklyTask,
  updateWeeklyTask,
  subscribeToWeeklyTask,
  toggleSpeakerStatus,
  toggleVerifyStatus,
} from '../lib/api/weekly'
import {
  getOrFetchSchedule,
  saveScheduleCache,
} from '../lib/google/schedule'
import {
  requestSheetsAccess,
  getSheetsToken,
} from '../lib/google/sheetsAuth'
import { getAllClasses } from '../lib/api/admin'
import { getMembers } from '../lib/api/members'
import type { WeeklyTask, ScheduleData, Class, UpcomingSpeaker, Member } from '../types'


// ─── 小元件：操持人顯示（唯讀，來自課表）────────────────

function HostDisplay({ label, name }: { label: string; name: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-500 w-16 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
        {name
          ? <span className="text-sm font-medium text-gray-800">{name}</span>
          : <span className="text-xs text-gray-400">（課表未設定）</span>
        }
      </div>
    </div>
  )
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function Weekly() {
  const { user } = useAuth()

  // ── 班別選擇（大領班可切換） ──
  const [allClasses, setAllClasses]           = useState<Class[]>([])
  const [selectedClassId, setSelectedClassId] = useState('')

  // ── 週次 ──
  const [weekStart, setWeekStart] = useState(() => getWeekStart())

  // ── Firestore 資料 ──
  const [task, setTask]           = useState<WeeklyTask | null>(null)
  const [taskLoading, setTaskLoading] = useState(true)

  // ── Sheets 資料 ──
  const [schedule, setSchedule]   = useState<ScheduleData | null>(null)
  const [scheduleState, setScheduleState] = useState<
    'idle' | 'loading' | 'ok' | 'no_token' | 'no_config' | 'error'
  >('idle')
  const [scheduleError, setScheduleError] = useState('')
  const [syncedLabel, setSyncedLabel]     = useState('')

  // ── 近期生日 ──
  const [upcomingBirthdays, setUpcomingBirthdays] = useState<{ member: Member; daysUntil: number }[]>([])

  // ─── 初始化班別清單（大領班）────────────────────────────

  useEffect(() => {
    if (!user) return
    // 所有角色都載入班級清單（copyInvitation 需要班級名稱）
    getAllClasses()
      .then(cls => {
        setAllClasses(cls)
        if (user.role === 'head_leader') {
          setSelectedClassId(user.classId || cls[0]?.id || '')
        } else {
          setSelectedClassId(user.classId)
        }
      })
      .catch(console.error)
  }, [user])

  // ─── 生日提醒（0–14 天內）──────────────────────────────

  useEffect(() => {
    if (!selectedClassId) return
    getMembers(selectedClassId).then(members => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const result = members
        .filter(m => m.birthday)
        .map(m => {
          const [mm, dd] = m.birthday.split('-').map(Number)
          const yr = today.getFullYear()
          let bd = new Date(yr, mm - 1, dd)
          let diff = Math.floor((bd.getTime() - today.getTime()) / 86400000)
          if (diff < 0) {
            bd = new Date(yr + 1, mm - 1, dd)
            diff = Math.floor((bd.getTime() - today.getTime()) / 86400000)
          }
          return { member: m, daysUntil: diff }
        })
        .filter(({ daysUntil }) => daysUntil >= 0 && daysUntil <= 14)
        .sort((a, b) => a.daysUntil - b.daysUntil)
      setUpcomingBirthdays(result)
    }).catch(console.error)
  }, [selectedClassId])

  // ─── 訂閱 WeeklyTask（Firestore onSnapshot）──────────────

  useEffect(() => {
    if (!selectedClassId) return
    setTaskLoading(true)
    getOrCreateWeeklyTask(selectedClassId, weekStart).catch(console.error)
    const unsub = subscribeToWeeklyTask(selectedClassId, weekStart, t => {
      setTask(t)
      setTaskLoading(false)
    })
    return unsub
  }, [selectedClassId, weekStart])

  // ─── 載入課表（Sheets）───────────────────────────────────

  const loadSchedule = useCallback(async (classId: string, ws: string, forceRefresh = false) => {
    setScheduleState('loading')
    setScheduleError('')

    try {
      if (forceRefresh) {
        // 清空快取（設 syncedAt 為 epoch 讓快取邏輯認為已過期）
        await saveScheduleCache(classId, ws, {
          hostThisWeek: '', hostNextWeek: '', upcomingSpeakers: [],
          syncedAt: new Date(0).toISOString(),
        })
      }

      const token = getSheetsToken()
      if (!token) {
        setScheduleState('no_token')
        return
      }

      const data = await getOrFetchSchedule(classId, token, ws)
      setSchedule(data)
      setScheduleState('ok')
      const mins = Math.round((Date.now() - new Date(data.syncedAt).getTime()) / 60000)
      setSyncedLabel(mins <= 1 ? '剛剛同步' : `${mins} 分鐘前同步`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'SHEETS_AUTH_EXPIRED') {
        setScheduleState('no_token')
      } else if (msg.includes('尚未設定課表')) {
        setScheduleState('no_config')
        setScheduleError(msg)
      } else {
        setScheduleState('error')
        setScheduleError(msg)
      }
    }
  }, [])

  useEffect(() => {
    if (selectedClassId) loadSchedule(selectedClassId, weekStart)
  }, [selectedClassId, weekStart, loadSchedule])

  // ─── OAuth 授權 ───────────────────────────────────────────

  const handleAuthorize = async () => {
    try {
      setScheduleState('loading')
      await requestSheetsAccess()
      await loadSchedule(selectedClassId, weekStart)
    } catch {
      setScheduleState('error')
      setScheduleError('Google 授權失敗，請再試一次')
    }
  }

  // ─── 強制同步 ─────────────────────────────────────────────

  const handleRefresh = async () => {
    const token = getSheetsToken()
    if (!token) {
      try {
        await requestSheetsAccess()
      } catch {
        setScheduleState('error')
        setScheduleError('Google 授權失敗')
        return
      }
    }
    await loadSchedule(selectedClassId, weekStart, true)
  }

  // ─── 更新 WeeklyTask ─────────────────────────────────────

  const update = (data: Partial<Omit<WeeklyTask, 'id' | 'weekStart'>>) => {
    if (!selectedClassId || !task) return
    updateWeeklyTask(selectedClassId, weekStart, data).catch(console.error)
  }

  // ── 講師勾選（field-path 寫入，避免整個物件被覆蓋）──────
  const [copiedDate, setCopiedDate] = useState('')

  const onToggleSpeaker = (date: string, checked: boolean) => {
    if (!selectedClassId) return
    toggleSpeakerStatus(selectedClassId, weekStart, date, checked).catch(console.error)
  }

  const onToggleVerify = (date: string, checked: boolean) => {
    if (!selectedClassId) return
    toggleVerifyStatus(selectedClassId, weekStart, date, checked).catch(console.error)
  }

  const copyInvitation = (s: UpcomingSpeaker) => {
    const d = new Date(s.date + 'T00:00:00')
    const days = ['日', '一', '二', '三', '四', '五', '六']
    const dateStr = `${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`
    const cls = allClasses.find(c => c.id === selectedClassId)?.name ?? ''
    const msg =
`【邀課通知】
${s.name}慈悲：
邀請您於${dateStr} ${cls}
分享「${s.topic || '【請填入課名】'}」
■上課時間：20:10-21:10
■形式可穿插設計問題討論、互動環節
＊如需要晚餐、轉接頭、播放影片，可提早與我們留言
敬祝 備課順利 法喜充滿  感謝慈悲`
    navigator.clipboard.writeText(msg).catch(console.error)
    setCopiedDate(s.date)
    setTimeout(() => setCopiedDate(''), 2500)
  }

  if (!user || (!selectedClassId && user.role !== 'head_leader')) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-amber-50">
        <p className="text-gray-400 text-sm">尚未分配班別，請聯絡大領班</p>
      </div>
    )
  }

  const isHeadLeader = user.role === 'head_leader'

  return (
    <div className="min-h-screen bg-amber-50 pb-24">
      <div className="max-w-lg mx-auto px-4 pt-6 flex flex-col gap-5">

        {/* ── 標題 ── */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-amber-800">本週任務</h1>
          {/* 大領班班別切換 */}
          {isHeadLeader && allClasses.length > 0 && (
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              className="text-xs border border-amber-200 bg-amber-50 rounded-lg px-2 py-1.5 text-amber-800"
            >
              {allClasses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* ── 週次導航 ── */}
        <div className="flex items-center justify-between bg-white rounded-2xl shadow-sm px-4 py-3">
          <button
            onClick={() => setWeekStart(w => shiftWeek(w, -1))}
            className="px-3 py-1 rounded-xl text-lg hover:bg-amber-50 active:bg-amber-100 transition-colors"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-gray-700 text-center">
            {formatWeekRange(weekStart)}
          </span>
          <button
            onClick={() => setWeekStart(w => shiftWeek(w, 1))}
            className="px-3 py-1 rounded-xl text-lg hover:bg-amber-50 active:bg-amber-100 transition-colors"
          >
            ›
          </button>
        </div>

        {taskLoading ? (
          <p className="text-center text-sm text-gray-400 py-8">載入中...</p>
        ) : (
          <>
            {/* ── 近期生日（最上方，14 天內）── */}
            {upcomingBirthdays.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm px-5 py-4 flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-gray-600">🎂 近期生日（14 天內）</h2>
                <div className="flex flex-col gap-2">
                  {upcomingBirthdays.map(({ member, daysUntil }) => (
                    <div key={member.id} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{member.name}</span>
                      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                        {daysUntil === 0 ? '今天！' : `${daysUntil}天後`}（{member.birthday.replace('-', '/')}）
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 課表連接狀態 + 講師提醒 ── */}
            <ScheduleSection
              state={scheduleState}
              error={scheduleError}
              syncedLabel={syncedLabel}
              schedule={schedule}
              task={task}
              onAuthorize={handleAuthorize}
              onRefresh={handleRefresh}
              onToggleSpeaker={onToggleSpeaker}
              onToggleVerify={onToggleVerify}
              onCopyInvitation={copyInvitation}
              copiedDate={copiedDate}
            />

            {/* ── 主持/操持者（有 schedule 時顯示）── */}
            {schedule && (
              <div className="bg-white rounded-2xl shadow-sm px-5 py-4 flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-gray-600">主持/操持者</h2>
                <HostDisplay label="本週操持" name={schedule.hostThisWeek} />
                <HostDisplay label="下週操持" name={schedule.hostNextWeek} />
              </div>
            )}

            {/* ── 習勞 ── */}
            {schedule?.cleaningDuty && (
              <div className="bg-white rounded-2xl shadow-sm px-5 py-4 flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-gray-600">🧹 本週習勞</h2>
                <p className="text-sm text-gray-700">{schedule.cleaningDuty}</p>
              </div>
            )}

            {/* ── 備註 ── */}
            <div className="bg-white rounded-2xl shadow-sm px-5 py-4 flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-gray-600">備註</h2>
              <textarea
                value={task?.notes ?? ''}
                onChange={e => update({ notes: e.target.value })}
                placeholder="輸入今天發生的事情，會同步顯示在統計/班級趨勢/該日期下方對話泡泡"
                rows={3}
                className="text-sm text-gray-700 border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-amber-400"
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── 課表區塊（含授權 / 講師提醒） ───────────────────────

function ScheduleSection({
  state,
  error,
  syncedLabel,
  schedule,
  task,
  onAuthorize,
  onRefresh,
  onToggleSpeaker,
  onToggleVerify,
  onCopyInvitation,
  copiedDate,
}: {
  state: 'idle' | 'loading' | 'ok' | 'no_token' | 'no_config' | 'error'
  error: string
  syncedLabel: string
  schedule: ScheduleData | null
  task: WeeklyTask | null
  onAuthorize: () => void
  onRefresh: () => void
  onToggleSpeaker: (date: string, checked: boolean) => void
  onToggleVerify: (date: string, checked: boolean) => void
  onCopyInvitation: (s: UpcomingSpeaker) => void
  copiedDate: string
}) {
  if (state === 'loading') {
    return (
      <div className="bg-white rounded-2xl shadow-sm px-5 py-5 text-center">
        <p className="text-sm text-gray-400">讀取課表中...</p>
      </div>
    )
  }

  if (state === 'no_token') {
    return (
      <div className="bg-white rounded-2xl shadow-sm px-5 py-5 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-600">課表連接</h2>
        <p className="text-xs text-gray-500">
          需要連接 Google 課表才能顯示操持人與講師提醒。<br />
          請確認您的 Google 帳號已有課表的閱覽權限。
        </p>
        <button
          onClick={onAuthorize}
          className="w-full py-2.5 rounded-xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 transition-colors"
        >
          連接 Google 課表
        </button>
      </div>
    )
  }

  if (state === 'no_config') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
        <p className="text-xs text-amber-700 font-medium">⚠️ 未設定課表分頁</p>
        <p className="text-xs text-amber-600 mt-1">
          請大領班在管理後台「班級管理」為此班設定「課表分頁名稱」與「等級班標頭」。
        </p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 flex flex-col gap-2">
        <p className="text-xs text-red-700 font-medium">課表讀取失敗</p>
        <p className="text-xs text-red-500">{error}</p>
        <button onClick={onRefresh} className="text-xs text-amber-700 underline self-start">
          重新嘗試
        </button>
      </div>
    )
  }

  if (!schedule) return null

  const hasSpeakers = schedule.upcomingSpeakers.some(s => s.name)
  const thisWeekSpeakers = schedule.upcomingSpeakers.filter(s => s.weekLabel === '本週')
  const futureSpeakers   = schedule.upcomingSpeakers.filter(s => s.weekLabel !== '本週').slice(0, 2)

  return (
    <div className="bg-white rounded-2xl shadow-sm px-5 py-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-600">🗒 講師/講題</h2>
        <button
          onClick={onRefresh}
          className="text-xs text-gray-400 hover:text-amber-600 transition-colors"
        >
          重新同步
        </button>
      </div>

      {syncedLabel && (
        <p className="text-xs text-gray-400 -mt-2">{syncedLabel}</p>
      )}

      {!hasSpeakers ? (
        <p className="text-xs text-gray-400">課表中未來 4 週無講師安排</p>
      ) : (
        <>
          {/* ── 本週（大字，無邀請 checkbox）── */}
          {thisWeekSpeakers.length > 0 && (
            <div className="flex flex-col gap-2">
              {thisWeekSpeakers.map(s => (
                <div key={s.date}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-amber-600 font-medium">{s.weekLabel}</span>
                    <span className="text-xs text-gray-300">{s.date.slice(5).replace('-', '/')}</span>
                  </div>
                  {s.name ? (
                    <div className="mt-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl font-bold text-gray-800">{s.name}</span>
                        {/* 已驗收（只有課表 驗=TRUE 才顯示） */}
                        {s.verifyNeeded && (
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={task?.verifyStatuses?.[s.date] ?? false}
                              onChange={e => onToggleVerify(s.date, e.target.checked)}
                              className="w-3.5 h-3.5 accent-green-600"
                            />
                            <span className="text-xs text-green-700">已驗收</span>
                          </label>
                        )}
                      </div>
                      {s.topic && (
                        <p className="text-sm text-gray-500 mt-0.5">{s.topic}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-300">（無安排）</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── 未來兩週（小字，有邀請 checkbox）── */}
          {futureSpeakers.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-gray-400 font-medium">未來兩週</p>
              <div className="flex flex-col gap-3">
                {futureSpeakers.map(s => (
                  <div key={s.date} className="flex gap-3">
                    {/* 週標籤 + 日期 */}
                    <div className="flex flex-col items-start shrink-0 pt-0.5">
                      <span className="text-xs text-gray-400 w-10">{s.weekLabel}</span>
                      <span className="text-xs text-gray-300">{s.date.slice(5).replace('-', '/')}</span>
                    </div>

                    {s.name ? (
                      <div className="flex-1 min-w-0">
                        {/* 講師名稱 + 勾選區 */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-gray-800 font-medium">{s.name}</span>
                          {/* 已邀請 */}
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={task?.speakerStatuses?.[s.date] ?? false}
                              onChange={e => onToggleSpeaker(s.date, e.target.checked)}
                              className="w-3.5 h-3.5 accent-amber-700"
                            />
                            <span className="text-xs text-gray-500">已邀請</span>
                          </label>
                          {/* 已驗收（只有課表 驗=TRUE 才顯示） */}
                          {s.verifyNeeded && (
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={task?.verifyStatuses?.[s.date] ?? false}
                                onChange={e => onToggleVerify(s.date, e.target.checked)}
                                className="w-3.5 h-3.5 accent-green-600"
                              />
                              <span className="text-xs text-green-700">已驗收</span>
                            </label>
                          )}
                          {/* 複製邀請通知 */}
                          <button
                            onClick={() => onCopyInvitation(s)}
                            className="text-xs text-amber-600 hover:text-amber-800 underline transition-colors shrink-0"
                          >
                            {copiedDate === s.date ? '✓ 已複製' : '複製邀請'}
                          </button>
                        </div>
                        {/* 講題（灰色小字） */}
                        {s.topic && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{s.topic}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 pt-0.5">（無安排）</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
