import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getEvent, submitEventResponse } from '../../lib/api/portal'
import type { PortalEvent, InterestLevel } from '../../types'

// ─── 活動詳情 + 意願填表 ──────────────────────────────────

// ── 「考慮中」localStorage 記錄 ───────────────────────────

interface MaybeReminder {
  eventId: string
  eventTitle: string
  deadline: string
  submittedAt: number
}

function saveMaybeReminder(eventId: string, eventTitle: string, deadline: string) {
  try {
    const pending: MaybeReminder[] = JSON.parse(localStorage.getItem('maybe_reminders') ?? '[]')
    const others = pending.filter(r => r.eventId !== eventId)
    others.push({ eventId, eventTitle, deadline, submittedAt: Date.now() })
    localStorage.setItem('maybe_reminders', JSON.stringify(others))
  } catch {
    // localStorage 不可用時靜默略過
  }
}

function removeMaybeReminder(eventId: string) {
  try {
    const pending: MaybeReminder[] = JSON.parse(localStorage.getItem('maybe_reminders') ?? '[]')
    localStorage.setItem('maybe_reminders', JSON.stringify(pending.filter(r => r.eventId !== eventId)))
  } catch {
    // 忽略
  }
}

// ── 工具函式 ─────────────────────────────────────────────

const INTEREST_OPTIONS: { value: InterestLevel; label: string; desc: string; color: string }[] = [
  { value: 'yes',   label: '✅ 我要參加', desc: '確定參加',    color: 'border-green-400 bg-green-50 text-green-700' },
  { value: 'maybe', label: '🤔 考慮中',   desc: '可能參加',    color: 'border-amber-400 bg-amber-50 text-amber-700' },
  { value: 'no',    label: '❌ 這次無法', desc: '這次無法參加', color: 'border-gray-300 bg-gray-50 text-gray-500' },
]

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${days[d.getDay()]}）`
}

// ─── 主元件 ───────────────────────────────────────────────

export default function PortalEventDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [event, setEvent]         = useState<PortalEvent | null>(null)
  const [loading, setLoading]     = useState(true)
  const [notFound, setNotFound]   = useState(false)

  // 即時「我要參加」人數（從 /event_yes_counts/{id} 訂閱）
  const [yesCount, setYesCount]   = useState(0)

  // 表單狀態
  const [name, setName]             = useState('')
  const [phone, setPhone]           = useState('')
  const [email, setEmail]           = useState('')
  const [interest, setInterest]     = useState<InterestLevel | ''>('')
  const [note, setNote]             = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [maybeConfirm, setMaybeConfirm] = useState(false)

  // 載入活動資料
  useEffect(() => {
    if (!id) return
    getEvent(id)
      .then(ev => {
        if (!ev || !ev.isPublished) { setNotFound(true); return }
        setEvent(ev)
        // 已登入的任何使用者，自動帶入姓名與 Email（Phone 不在帳號資料內，仍需手填）
        if (user) {
          if (user.name)  setName(prev  => prev  || user.name)
          if (user.email) setEmail(prev => prev  || (user.email as string))
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id, user])

  // 輪詢即時報名人數（從 event 文件的 yesCount 欄位）
  useEffect(() => {
    if (!id) return
    const doFetch = () =>
      getEvent(id).then(ev => {
        if (ev) setYesCount((ev as PortalEvent & { yesCount?: number }).yesCount ?? 0)
      }).catch(() => {})
    doFetch()
    const timer = setInterval(doFetch, 10000)
    return () => clearInterval(timer)
  }, [id])

  const isPast = event ? event.deadline < new Date().toISOString().slice(0, 10) : false

  const emailValid = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

  const handleSubmit = async () => {
    if (!event || !name.trim() || !phone.trim() || !email.trim() || !interest) return
    if (!emailValid(email)) { setSubmitError('請輸入正確的 Email 格式'); return }
    setSubmitting(true)
    setSubmitError('')

    try {
      await submitEventResponse({
        eventId:     event.id,
        name:        name.trim(),
        phone:       phone.trim(),
        email:       email.trim(),
        interest:    interest as InterestLevel,
        note:        note.trim(),
        submittedAt: new Date().toISOString(),
        ...(user ? { submitterUid: user.uid } : {}),
      })

      // 「考慮中」→ 儲存 localStorage 提醒；其他 → 移除該提醒
      if (interest === 'maybe') {
        saveMaybeReminder(event.id, event.title, event.deadline)
        setMaybeConfirm(true)
      } else {
        removeMaybeReminder(event.id)
      }

      setSubmitted(true)
    } catch (e) {
      console.error(e)
      setSubmitError('送出失敗，請稍後再試。')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="text-center text-sm text-gray-400 py-16">讀取中...</div>
  }
  if (notFound) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8 text-center">
        <p className="text-sm text-gray-400">找不到此活動，或活動尚未開放。</p>
        <button onClick={() => navigate('/portal/events')} className="mt-4 text-xs text-sky-600 underline">
          ← 返回活動列表
        </button>
      </div>
    )
  }
  if (!event) return null

  // 火焰熱度動畫 CSS（人數越多越活躍）
  const fireColor = yesCount >= 10 ? '#ef4444' : yesCount >= 5 ? '#f97316' : '#6b7280'
  const fireAnim  = yesCount >= 3 ? 'fire-shake 0.5s ease-in-out infinite' : 'none'
  const fireScale = yesCount >= 5 ? 1.05 : 1

  return (
    <div className="max-w-lg mx-auto px-4 pt-5 flex flex-col gap-4 pb-6">
      {/* CSS keyframes for fire animation */}
      <style>{`
        @keyframes fire-shake {
          0%, 100% { transform: rotate(-2deg) scale(${fireScale}); }
          50%       { transform: rotate(2deg) scale(${fireScale}); }
        }
      `}</style>

      {/* 返回 */}
      <button
        onClick={() => navigate('/portal/events')}
        className="text-xs text-sky-600 self-start hover:underline"
      >
        ← 返回活動列表
      </button>

      {/* 封面圖片 */}
      {event.imageUrl && (
        <img
          src={event.imageUrl}
          alt={event.title}
          className="w-full rounded-2xl object-cover aspect-video shadow-sm"
        />
      )}

      {/* 活動資訊卡 */}
      <div className="bg-white rounded-2xl shadow-sm px-5 py-5 flex flex-col gap-3">
        <h1 className="text-base font-bold text-gray-800">{event.title}</h1>

        {/* 活動日期 */}
        {event.eventDates?.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-400 font-medium">活動日期</span>
            {event.eventDates.map(d => (
              <span key={d} className="text-sm text-gray-700">{formatDateFull(d)}</span>
            ))}
          </div>
        )}

        {/* 截止日 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 font-medium">填寫截止</span>
          <span className={`text-sm ${isPast ? 'text-gray-400' : 'text-red-500 font-medium'}`}>
            {formatDateFull(event.deadline)}
            {isPast && '（已截止）'}
          </span>
        </div>

        {/* 說明 */}
        {event.description && (
          <div>
            <span className="text-xs text-gray-400 font-medium">活動說明</span>
            <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{event.description}</p>
          </div>
        )}

        {/* 負責人（最多 3 位） */}
        {event.responsible && event.responsible.length > 0 && (
          <div className="border-t border-gray-100 pt-3 flex flex-col gap-2">
            <span className="text-xs text-gray-400 font-medium">活動負責人</span>
            <div className="flex flex-wrap gap-2">
              {event.responsible.map((r, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">{r.name}</span>
                  {r.lineId && (
                    <a
                      href={`https://line.me/R/ti/p/~${r.lineId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs bg-green-500 text-white px-2.5 py-1 rounded-xl hover:bg-green-600 transition-colors"
                    >
                      <span>💬</span>
                      <span>LINE</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 意願填表 ── */}
      {isPast ? (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-5 text-center">
          <p className="text-sm text-gray-500">此活動意願調查已截止</p>
          {event.responsible && event.responsible.length > 0 && event.responsible[0].lineId && (
            <a
              href={`https://line.me/R/ti/p/~${event.responsible[0].lineId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-green-600 mt-2 underline"
            >
              有問題可 LINE 聯絡 {event.responsible[0].name}
            </a>
          )}
        </div>
      ) : submitted ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-6 text-center flex flex-col gap-2">
          <p className="text-lg">✅</p>
          <p className="text-sm font-medium text-green-700">意願已送出，感謝你的回覆！</p>
          {maybeConfirm && (
            <p className="text-xs text-amber-600">
              你選擇了「考慮中」，3 天後若未更新意願，下次打開活動頁時將再次提醒你。
            </p>
          )}
          <p className="text-xs text-gray-500">管理人員將於近日整理名單後與你聯繫。</p>
          {/* 負責人 LINE */}
          {event.responsible && event.responsible.length > 0 && event.responsible[0].lineId && (
            <a
              href={`https://line.me/R/ti/p/~${event.responsible[0].lineId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs bg-green-500 text-white px-3 py-1.5 rounded-xl self-center mt-1 hover:bg-green-600 transition-colors"
            >
              <span>💬</span>
              <span>LINE 聯絡負責人</span>
            </a>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm px-5 py-5 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-700">填寫意願</h2>

          {/* Google 登入提示（未登入時顯示） */}
          {!user && (
            <div className="bg-sky-50 border border-sky-100 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-base shrink-0">💡</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-sky-700">
                  <Link to="/portal/login" className="font-medium underline">Google 登入</Link>後可自動帶入姓名等資料
                </p>
              </div>
            </div>
          )}

          {/* 姓名 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">姓名 <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="輸入你的姓名"
              className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-sky-400"
            />
          </div>

          {/* 電話 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">電話 <span className="text-red-400">*</span></label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="輸入聯絡電話"
              className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-sky-400"
            />
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Email <span className="text-red-400">*</span></label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="輸入 Email（活動通知用）"
              className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-sky-400"
            />
          </div>

          {/* 意願選擇 */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">參加意願 <span className="text-red-400">*</span></label>
            {INTEREST_OPTIONS.map(opt => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-colors ${
                  interest === opt.value ? opt.color : 'border-gray-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="interest"
                  value={opt.value}
                  checked={interest === opt.value}
                  onChange={() => setInterest(opt.value)}
                  className="sr-only"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-gray-400">{opt.desc}</p>
                </div>
                {/* 即時報名人數 badge（只顯示在「我要參加」選項） */}
                {opt.value === 'yes' && yesCount > 0 && (
                  <span
                    style={{ color: fireColor, animation: fireAnim }}
                    className="text-xs font-semibold shrink-0"
                  >
                    🔥 {yesCount} 人
                  </span>
                )}
                {interest === opt.value && <span className="text-sm shrink-0">●</span>}
              </label>
            ))}
          </div>

          {/* 備註 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">備註（可選填）</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="有任何問題或補充說明可以在這裡填寫..."
              rows={3}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-sky-400"
            />
          </div>

          {/* 錯誤訊息 */}
          {submitError && (
            <p className="text-xs text-red-500">{submitError}</p>
          )}

          {/* 送出按鈕 */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !phone.trim() || !email.trim() || !interest}
            className="w-full py-3 rounded-xl bg-sky-600 text-white text-sm font-medium
              hover:bg-sky-700 active:bg-sky-800 transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '送出中...' : '送出意願'}
          </button>
          <p className="text-[10px] text-gray-400 text-center">
            填寫後系統會自動通知活動負責人，不需要再另外聯絡。
          </p>
        </div>
      )}
    </div>
  )
}
