import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { getMembers, getClassInfo } from '../lib/api/members'
import {
  subscribeToClassAttendance,
  setAttendanceRecord,
  initializeAbsentForAll,
} from '../lib/api/attendance'
import {
  getOrCreateSession,
  finalizeSession,
  reopenSession,
  subscribeToSession,
} from '../lib/api/sessions'
import { iccfGetCurrentSessions, type IccfLoginResult, type IccfSessionInfo } from '../lib/api/iccfSession'
import { createIccfSyncJob, pollIccfSyncJob, type SyncJob } from '../lib/api/iccfSync'
import IccfLoginModal from '../components/IccfLoginModal'
import type { Member, Attendance, Session, AttendanceStatus } from '../types'

// ─── 出席三態循環定義 ─────────────────────────────────────

const STATUS_CYCLE: AttendanceStatus[] = ['absent', 'present', 'leave']

function nextStatus(current: AttendanceStatus): AttendanceStatus {
  const idx = STATUS_CYCLE.indexOf(current)
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
}

const STATUS_STYLE: Record<
  AttendanceStatus,
  { bg: string; text: string; border: string; label: string }
> = {
  present: {
    bg: 'bg-green-500',
    text: 'text-white',
    border: 'border-green-400',
    label: '出席',
  },
  leave: {
    bg: 'bg-amber-400',
    text: 'text-white',
    border: 'border-amber-400',
    label: '請假',
  },
  absent: {
    bg: 'bg-gray-100',
    text: 'text-gray-400',
    border: 'border-gray-200',
    label: '未到',
  },
}

// ─── 工具 ─────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function Attendance() {
  const { user } = useAuth()

  const [date, setDate]                   = useState(todayStr)
  const [members, setMembers]             = useState<Member[]>([])
  const [iccfClassCode, setIccfClassCode] = useState<string | undefined>()
  const [attendanceMap, setAttendanceMap] = useState<Map<string, Attendance>>(new Map())
  const [session, setSession]             = useState<Session | null>(null)
  const [loading, setLoading]             = useState(true)
  const [savingSet, setSavingSet]         = useState<Set<string>>(new Set())
  const [finalizing, setFinalizing]       = useState(false)

  // iccf sync state
  const [iccfSession, setIccfSession]         = useState<IccfSessionInfo | null>(null)
  const [showIccfLogin, setShowIccfLogin]     = useState(false)
  const [iccfSyncJob, setIccfSyncJob]         = useState<SyncJob | null>(null)
  const [pendingFinalize, setPendingFinalize] = useState(false)
  const pollTimerRef                          = useRef<ReturnType<typeof setInterval> | null>(null)

  // 追蹤已初始化的 classId_date，避免重複呼叫 initializeAbsentForAll
  const initializedRef = useRef<string>('')

  // ─── 載入班員（只需做一次） ──────────────────────────────

  useEffect(() => {
    if (!user?.classId) return
    setLoading(true)
    Promise.all([getMembers(user.classId), getClassInfo(user.classId)])
      .then(([data, classInfo]) => {
        setMembers(data)
        setIccfClassCode(classInfo?.iccfClassCode || undefined)
      })
      .finally(() => setLoading(false))
  }, [user?.classId])

  // Load existing iccf session if this class has iccf sync enabled
  useEffect(() => {
    if (!iccfClassCode) return
    iccfGetCurrentSessions()
      .then(sessions => { if (sessions.length > 0) setIccfSession(sessions[0]) })
      .catch(() => { /* non-critical */ })
  }, [iccfClassCode])

  // Poll sync job status
  useEffect(() => {
    if (!iccfSyncJob) return
    if (iccfSyncJob.status === 'done' || iccfSyncJob.status === 'failed') return

    pollTimerRef.current = setInterval(async () => {
      try {
        const updated = await pollIccfSyncJob(iccfSyncJob.jobId)
        setIccfSyncJob(updated)
        if (updated.status === 'done' || updated.status === 'failed') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current)
        }
      } catch { /* ignore */ }
    }, 2500)

    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }
  }, [iccfSyncJob?.jobId, iccfSyncJob?.status])

  // ─── 訂閱出席記錄（onSnapshot — 支援多領班即時同步） ─────

  useEffect(() => {
    if (!user?.classId) return
    const unsub = subscribeToClassAttendance(user.classId, date, records => {
      const map = new Map<string, Attendance>()
      records.forEach(r => map.set(r.memberId, r))
      setAttendanceMap(map)
    })
    return unsub
  }, [user?.classId, date])

  // ─── 訂閱 Session 狀態 ───────────────────────────────────

  useEffect(() => {
    if (!user?.classId) return
    const unsub = subscribeToSession(user.classId, date, setSession)
    return unsub
  }, [user?.classId, date])

  // ─── 建立 Session + 初始化所有班員為 absent ──────────────

  useEffect(() => {
    if (!user?.classId || !user.uid || members.length === 0) return
    const key = `${user.classId}_${date}`
    if (initializedRef.current === key) return
    initializedRef.current = key

    getOrCreateSession(user.classId, date, user.uid).then(sess => {
      // Session 已完成（補看過去紀錄），不重新初始化出席狀態
      if (sess.isFinalized) return
      initializeAbsentForAll({
        classId: user.classId,
        memberIds: members.map(m => m.id),
        date,
        userId: user.uid,
      })
    })
  }, [user?.classId, user?.uid, date, members])

  // ─── 切換出席狀態（樂觀更新） ────────────────────────────

  const handleToggle = useCallback(
    async (member: Member, currentStatus: AttendanceStatus) => {
      if (!user?.classId || !user.uid) return
      if (session?.isFinalized) return

      const newStatus = nextStatus(currentStatus)

      // 樂觀更新：先更新 UI，再寫 Firestore
      setAttendanceMap(prev => {
        const newMap = new Map(prev)
        const existing = prev.get(member.id)
        newMap.set(member.id, {
          id: existing?.id ?? '',
          memberId: member.id,
          classId: user.classId,
          date,
          note: existing?.note ?? '',
          recordedBy: existing?.recordedBy ?? user.uid,
          lastUpdatedBy: user.uid,
          lastUpdatedAt: new Date().toISOString(),
          status: newStatus,
        })
        return newMap
      })

      setSavingSet(prev => new Set(prev).add(member.id))
      try {
        await setAttendanceRecord({
          classId: user.classId,
          memberId: member.id,
          date,
          status: newStatus,
          userId: user.uid,
        })
      } finally {
        setSavingSet(prev => {
          const s = new Set(prev)
          s.delete(member.id)
          return s
        })
      }
    },
    [user, date, session?.isFinalized],
  )

  // ─── 完成點名 ─────────────────────────────────────────────

  const doFinalize = async (sessionId?: string) => {
    if (!user?.classId || !user.uid) return
    setFinalizing(true)
    try {
      await finalizeSession(user.classId, date, user.uid)

      // Trigger iccf sync if classCode and session are available
      if (iccfClassCode && sessionId) {
        try {
          const { jobId, message } = await createIccfSyncJob({
            classId: user.classId,
            date,
            sessionId,
          })
          if (jobId) {
            setIccfSyncJob({
              jobId,
              status: 'pending',
              result: null,
              error: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
          } else if (message) {
            // e.g. "無出席班員，略過 iccf 同步"
            setIccfSyncJob({
              jobId: '',
              status: 'done',
              result: { marked: [], notFound: [] },
              error: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
          }
        } catch {
          // iccf sync failure is non-blocking
        }
      }
    } finally {
      setFinalizing(false)
      setPendingFinalize(false)
    }
  }

  const handleFinalize = async () => {
    if (!user?.classId || !user.uid) return

    // If iccf sync is enabled and no session, prompt login first
    if (iccfClassCode && !iccfSession) {
      setPendingFinalize(true)
      setShowIccfLogin(true)
      return
    }

    await doFinalize(iccfSession?.sessionId)
  }

  const handleIccfLoginSuccess = async (result: IccfLoginResult) => {
    setShowIccfLogin(false)
    const sessionInfo: IccfSessionInfo = {
      sessionId: result.sessionId,
      iccfAccount: '',
      profile: result.profile,
      classes: result.classes,
      lastUsedAt: new Date().toISOString(),
      expiresAt: result.expiresAt,
    }
    setIccfSession(sessionInfo)
    if (pendingFinalize) {
      await doFinalize(result.sessionId)
    }
  }

  // ─── 重新開啟（補登） ────────────────────────────────────

  const handleReopen = async () => {
    if (!user?.classId) return
    await reopenSession(user.classId, date)
  }

  // ─── 日期切換：重置初始化旗標 ────────────────────────────

  const handleDateChange = (newDate: string) => {
    initializedRef.current = ''
    setDate(newDate)
  }

  // ─── 統計 ────────────────────────────────────────────────

  const checkedCount = [...attendanceMap.values()].filter(
    r => r.status === 'present' || r.status === 'leave',
  ).length

  const total = members.length
  const progress = total > 0 ? (checkedCount / total) * 100 : 0

  // ─── 未設定班級 ───────────────────────────────────────────

  if (!loading && !user?.classId) {
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

      {showIccfLogin && (
        <IccfLoginModal
          onSuccess={handleIccfLoginSuccess}
          onCancel={() => { setShowIccfLogin(false); setPendingFinalize(false) }}
        />
      )}

      {/* ── Header + 進度列 ── */}
      <header className="bg-white border-b border-amber-100 sticky top-0 z-10">

        {/* 標題列 */}
        <div className="max-w-screen-sm mx-auto px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <h1 className="text-base font-bold text-gray-800 shrink-0">點名</h1>
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={e => handleDateChange(e.target.value)}
            className="text-sm text-gray-700 border border-amber-200 rounded-lg px-2.5 py-1 bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {/* 進度列 */}
        <div className="max-w-screen-sm mx-auto px-4 pb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-400">
              已確認{' '}
              <span className="font-semibold text-amber-700">{checkedCount}</span>
              {' '}/ {total} 人
            </span>
            {session?.isFinalized && (
              <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                ✓ 已完成
              </span>
            )}
          </div>
          <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </header>

      {/* ── 班員列表 ── */}
      <main className="max-w-screen-sm mx-auto px-4 pt-4 pb-36">
        {loading ? (
          <div className="flex justify-center py-20">
            <p className="text-gray-400 text-sm">載入中...</p>
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">👥</p>
            <p className="text-gray-500 font-medium">尚無班員</p>
            <p className="text-gray-400 text-sm mt-1">請先至「班員」頁面新增班員</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map(member => {
              const status: AttendanceStatus =
                attendanceMap.get(member.id)?.status ?? 'absent'
              const style = STATUS_STYLE[status]
              const isSaving = savingSet.has(member.id)
              const isFinalized = session?.isFinalized ?? false

              return (
                <li key={member.id}>
                  <button
                    onClick={() => handleToggle(member, status)}
                    disabled={isFinalized || isSaving}
                    className={`
                      w-full flex items-center justify-between gap-3
                      bg-white rounded-2xl shadow-sm border px-5 py-4
                      transition-all active:scale-[0.98] select-none
                      ${isFinalized ? 'opacity-60 cursor-default' : 'hover:bg-amber-50'}
                      ${style.border}
                    `}
                  >
                    <span className="font-medium text-gray-800 text-left flex-1">
                      {member.name}
                    </span>
                    <span
                      className={`
                        text-sm font-semibold px-3 py-1 rounded-full
                        ${style.bg} ${style.text}
                        min-w-[52px] text-center shrink-0
                        transition-opacity duration-150
                        ${isSaving ? 'opacity-50' : 'opacity-100'}
                      `}
                    >
                      {style.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {/* ── 完成點名 / 重新開啟 — 固定在 BottomNav 上方 ── */}
      {!loading && members.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-10">
          <div className="max-w-screen-sm mx-auto px-4 py-3 bg-white/90 backdrop-blur-sm border-t border-amber-100 flex flex-col gap-2">

            {/* iccf sync status */}
            {iccfSyncJob && iccfSyncJob.jobId && (
              <div className={`text-xs rounded-xl px-3 py-2 ${
                iccfSyncJob.status === 'done'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : iccfSyncJob.status === 'failed'
                    ? 'bg-red-50 text-red-600 border border-red-200'
                    : 'bg-blue-50 text-blue-600 border border-blue-200'
              }`}>
                {iccfSyncJob.status === 'pending' && '⏳ iccf 同步排隊中…'}
                {iccfSyncJob.status === 'processing' && '⏳ iccf 同步中…'}
                {iccfSyncJob.status === 'done' && (
                  `✓ iccf 同步完成：${iccfSyncJob.result?.marked.length ?? 0} 人出席已上傳` +
                  (iccfSyncJob.result?.notFound.length ? `，${iccfSyncJob.result.notFound.length} 人未找到` : '')
                )}
                {iccfSyncJob.status === 'failed' && `✗ iccf 同步失敗：${iccfSyncJob.error ?? '未知錯誤'}`}
              </div>
            )}

            {/* iccf session indicator (when enabled and session present) */}
            {iccfClassCode && !session?.isFinalized && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${iccfSession ? 'bg-blue-500' : 'bg-gray-300'}`} />
                <span className={iccfSession ? 'text-blue-500' : 'text-gray-400'}>
                  {iccfSession ? `iccf 已登入（完成點名時自動同步）` : `完成點名時將要求登入 iccf`}
                </span>
              </div>
            )}

            {session?.isFinalized ? (
              <button
                onClick={handleReopen}
                className="w-full py-3.5 rounded-2xl border-2 border-amber-400 text-amber-700 font-semibold text-sm hover:bg-amber-50 active:scale-[0.98] transition-all"
              >
                重新開啟補登
              </button>
            ) : (
              <button
                onClick={handleFinalize}
                disabled={finalizing}
                className="w-full py-3.5 rounded-2xl bg-amber-700 text-white font-semibold text-sm hover:bg-amber-800 active:scale-[0.98] transition-all shadow-md disabled:opacity-60"
              >
                {finalizing ? '儲存中...' : '完成點名'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
