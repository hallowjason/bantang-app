import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getPublishedEvents } from '../../lib/api/portal'
import type { PortalEvent, EventType } from '../../types'

// ─── 活動意願調查列表 ─────────────────────────────────────

const TYPE_LABEL: Record<EventType, string> = {
  lecture: '講座',
  trip:    '出遊',
  camp:    '營隊',
  class:   '課程',
  other:   '其他',
}

const TYPE_COLOR: Record<EventType, string> = {
  lecture: 'bg-amber-100 text-amber-700',
  trip:    'bg-teal-100 text-teal-700',
  camp:    'bg-green-100 text-green-700',
  class:   'bg-sky-100 text-sky-700',
  other:   'bg-gray-100 text-gray-500',
}

/** 判斷是否已截止 */
function isPastDeadline(deadline: string): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return deadline < today
}

/** 格式化多個活動日期 */
function formatDates(dates: string[]): string {
  return dates
    .map(d => {
      const dt = new Date(d + 'T00:00:00')
      const days = ['日', '一', '二', '三', '四', '五', '六']
      return `${dt.getMonth() + 1}/${dt.getDate()}（${days[dt.getDay()]}）`
    })
    .join('、')
}

// ─── 考慮中 Reminder ──────────────────────────────────────

interface MaybeReminder {
  eventId: string
  eventTitle: string
  deadline: string
  submittedAt: number
}

function loadMaybeReminders(): MaybeReminder[] {
  try {
    return JSON.parse(localStorage.getItem('maybe_reminders') ?? '[]')
  } catch {
    return []
  }
}

function dismissReminder(eventId: string) {
  const pending = loadMaybeReminders().filter(r => r.eventId !== eventId)
  localStorage.setItem('maybe_reminders', JSON.stringify(pending))
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function PortalEvents() {
  const [events, setEvents]       = useState<PortalEvent[]>([])
  const [loading, setLoading]     = useState(true)
  const [reminders, setReminders] = useState<MaybeReminder[]>([])

  useEffect(() => {
    getPublishedEvents()
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false))

    // 檢查「考慮中」提醒：submittedAt >= 3天前 且 deadline 未過
    const now = Date.now()
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000
    const today = new Date().toISOString().slice(0, 10)
    const pending = loadMaybeReminders().filter(r =>
      now - r.submittedAt >= threeDaysMs &&
      r.deadline >= today,
    )
    setReminders(pending)
  }, [])

  const handleDismissReminder = (eventId: string) => {
    dismissReminder(eventId)
    setReminders(prev => prev.filter(r => r.eventId !== eventId))
  }

  const activeEvents = events.filter(e => !isPastDeadline(e.deadline))
  const pastEvents   = events.filter(e => isPastDeadline(e.deadline))

  return (
    <div className="max-w-lg mx-auto px-4 pt-5 flex flex-col gap-5">

      <h2 className="text-sm font-bold text-sky-700 px-1">活動意願調查</h2>

      {/* 「考慮中」提醒 banner */}
      {reminders.length > 0 && (
        <div className="flex flex-col gap-2">
          {reminders.map(r => (
            <div key={r.eventId}
              className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-3">
              <span className="text-sm shrink-0 font-semibold text-amber-700">通知</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-amber-700">
                  你還沒確定《{r.eventTitle}》的參加意願
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  截止日：{r.deadline.replace(/-/g, '/')}，要更新你的意願嗎？
                </p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <Link
                  to={`/portal/events/${r.eventId}`}
                  className="text-xs text-sky-600 underline"
                >
                  前往更新
                </Link>
                <button
                  onClick={() => handleDismissReminder(r.eventId)}
                  className="text-xs text-gray-400 underline"
                >
                  忽略
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-8">讀取中...</p>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm px-5 py-8 text-center">
          <p className="text-sm text-gray-400">目前沒有進行中的活動</p>
          <p className="text-xs text-gray-300 mt-1">請稍後再回來查看</p>
        </div>
      ) : (
        <>
          {/* 進行中 */}
          {activeEvents.length > 0 && (
            <div className="flex flex-col gap-3">
              {activeEvents.map(event => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}

          {/* 已截止 */}
          {pastEvents.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold text-gray-400 px-1">已截止</h3>
              {pastEvents.map(event => (
                <EventCard key={event.id} event={event} past />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function EventCard({ event, past = false }: { event: PortalEvent; past?: boolean }) {
  return (
    <Link
      to={`/portal/events/${event.id}`}
      className={`bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow ${past ? 'opacity-60' : ''}`}
    >
      {/* 封面圖片 */}
      {event.imageUrl && (
        <img
          src={event.imageUrl}
          alt={event.title}
          className="w-full object-cover aspect-video"
        />
      )}

      <div className="px-5 py-4 flex flex-col gap-2">
        {/* 標題列 */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-800 leading-snug">{event.title}</h3>
          </div>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${TYPE_COLOR[event.type] ?? 'bg-gray-100 text-gray-500'}`}>
            {TYPE_LABEL[event.type] ?? event.type}
          </span>
        </div>

        {/* 活動日期 */}
        {event.eventDates?.length > 0 && (
          <p className="text-xs text-gray-500">{formatDates(event.eventDates)}</p>
        )}

        {/* 說明預覽 */}
        {event.description && (
          <p className="text-xs text-gray-500 line-clamp-2">{event.description}</p>
        )}

        {/* 截止日 */}
        <div className="flex items-center justify-between pt-1">
          <span className={`text-xs ${past ? 'text-gray-400' : 'text-red-500'}`}>
            截止：{event.deadline.replace(/-/g, '/')}
            {past ? '（已截止）' : ''}
          </span>
          {!past && (
            <span className="text-xs text-sky-600 font-medium">填寫意願 →</span>
          )}
        </div>
      </div>
    </Link>
  )
}
