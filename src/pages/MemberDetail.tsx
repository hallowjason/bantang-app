import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getMemberById,
  getMemberAttendance,
  getMemberAttendanceCount,
  getMemberActiveClasses,
} from '../lib/api/members'
import { getEtiquetteItems } from '../lib/api/settings'
import MemberForm from '../components/MemberForm'
import type { Member, Attendance, EtiquetteItem, ClassMemberWithName, EtiquetteStatus } from '../types'

// ─── 工具函式 ─────────────────────────────────────────────

function formatBirthday(birthday: string): string {
  if (!birthday) return '未設定'
  const [m, d] = birthday.split('-')
  return `${parseInt(m)}月${parseInt(d)}日`
}

function daysUntilBirthday(birthday: string): number {
  const [m, d] = birthday.split('-').map(Number)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  let bday = new Date(today.getFullYear(), m - 1, d)
  if (bday < today) bday = new Date(today.getFullYear() + 1, m - 1, d)
  return Math.ceil((bday.getTime() - today.getTime()) / 86_400_000)
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr); then.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.floor((today.getTime() - then.getTime()) / 86_400_000)
}

// ─── 禮節狀態色碼 ─────────────────────────────────────────

const ETIQUETTE_STYLE: Record<EtiquetteStatus | 'none', { bg: string; text: string; label: string }> = {
  none:      { bg: 'bg-gray-100',   text: 'text-gray-400',  label: '—'   },
  preparing: { bg: 'bg-amber-100',  text: 'text-amber-700', label: '準備中' },
  failed:    { bg: 'bg-red-100',    text: 'text-red-600',   label: '未通過' },
  passed:    { bg: 'bg-green-100',  text: 'text-green-700', label: '已通過' },
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function MemberDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [member, setMember]         = useState<Member | null>(null)
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [activeClasses, setActiveClasses] = useState<ClassMemberWithName[]>([])
  const [etiquetteItems, setEtiquetteItems] = useState<EtiquetteItem[]>([])
  const [loading, setLoading]       = useState(true)
  const [showEdit, setShowEdit]     = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [m, att, count, classes, items] = await Promise.all([
      getMemberById(id),
      getMemberAttendance(id),
      getMemberAttendanceCount(id),
      getMemberActiveClasses(id),
      getEtiquetteItems(),
    ])
    setMember(m)
    setAttendance(att)
    setTotalCount(count)
    setActiveClasses(classes)
    setEtiquetteItems(items)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-muted text-sm">載入中...</p>
      </div>
    )
  }

  if (!member) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-3">
        <p className="text-ink">找不到此班員</p>
        <button onClick={() => navigate('/members')} className="text-ink text-sm font-medium underline">
          ← 返回列表
        </button>
      </div>
    )
  }

  const presentRecords   = attendance.filter(a => a.status === 'present')
  const lastPresentDate  = presentRecords[0]?.date ?? null
  const daysSinceLast    = lastPresentDate ? daysSince(lastPresentDate) : null
  const bdayDays         = member.birthday ? daysUntilBirthday(member.birthday) : null
  const birthdaySoon     = bdayDays !== null && bdayDays <= 30

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="bg-cream border-b border-hairline sticky top-0 z-10">
        <div className="max-w-screen-sm mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={() => navigate('/members')} className="text-ink text-sm font-medium">
            ← 返回
          </button>
          <h1 className="text-base font-semibold text-ink truncate max-w-[160px] tracking-tight">{member.name}</h1>
          <button
            onClick={() => setShowEdit(true)}
            className="btn-ghost text-sm px-3 py-1.5"
          >
            編輯
          </button>
        </div>
      </header>

      <main className="max-w-screen-sm mx-auto px-4 py-5 flex flex-col gap-4 pb-20">

        {/* 生日提醒 */}
        {birthdaySoon && (
          <div className="bg-pink-50 border border-pink-200 rounded-2xl px-5 py-3 flex items-center gap-3">
            <div>
              <p className="text-sm font-semibold text-pink-700">即將生日！</p>
              <p className="text-xs text-pink-500">
                {bdayDays === 0
                  ? '今天是生日'
                  : `距生日還有 ${bdayDays} 天（${formatBirthday(member.birthday)}）`}
              </p>
            </div>
          </div>
        )}

        {/* 基本資料 */}
        <div className="card-lovable flex flex-col gap-2">
          <p className="text-xs font-semibold text-muted mb-1">基本資料</p>
          <InfoRow label="引保師" value={member.mentor || '—'} />
          <InfoRow
            label="區域"
            value={[member.regionUnit, member.regionNumber].filter(Boolean).join('') || '—'}
          />
          <InfoRow label="生日" value={member.birthday ? formatBirthday(member.birthday) : '—'} />
        </div>

        {/* 統計 */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard value={totalCount} label="累計堂數" />
          <StatCard value={daysSinceLast !== null ? daysSinceLast : '—'} label="距上次(天)" />
          <StatCard
            value={member.birthday ? `${parseInt(member.birthday.split('-')[0])}/${parseInt(member.birthday.split('-')[1])}` : '—'}
            label="生日"
            small
          />
        </div>

        {/* 所屬班級 */}
        {activeClasses.length > 0 && (
          <section>
            <SectionTitle>所屬班級</SectionTitle>
            <div className="flex flex-col gap-2">
              {activeClasses.map(c => (
                <div key={c.classId}
                  className="card-lovable-compact flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{c.className}</span>
                  <span className="text-xs text-muted">加入 {c.joinedAt}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 禮節項目 */}
        <section>
          <SectionTitle>禮節項目進度</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {etiquetteItems.map(item => {
              const status = (member.etiquetteItems?.[item.id] ?? 'none') as EtiquetteStatus | 'none'
              const style = ETIQUETTE_STYLE[status]
              return (
                <div key={item.id}
                  className={`rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 ${style.bg}`}>
                  <span className={`text-xs font-medium ${style.text} flex-1`}>{item.name}</span>
                  <span className={`text-xs ${style.text} shrink-0`}>{style.label}</span>
                </div>
              )
            })}
          </div>
        </section>

        {/* 備註 */}
        {member.notes && (
          <div className="card-lovable">
            <p className="text-xs font-medium text-muted mb-1">備註</p>
            <p className="text-sm text-ink whitespace-pre-wrap">{member.notes}</p>
          </div>
        )}

        {/* 出席歷史 */}
        <section>
          <SectionTitle>出席記錄（共 {attendance.length} 筆）</SectionTitle>
          {attendance.length === 0 ? (
            <div className="card-lovable py-10 text-center">
              <p className="text-sm text-muted">尚無出席記錄</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {attendance.map(rec => (
                <li key={rec.id}
                  className="card-lovable-compact flex items-center justify-between">
                  <span className="text-sm text-ink">{rec.date}</span>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
                    rec.status === 'present' ? 'bg-green-100 text-green-700'
                    : rec.status === 'leave'   ? 'bg-amber-100 text-amber-700'
                    :                            'bg-red-50 text-red-500'
                  }`}>
                    {rec.status === 'present' ? '出席' : rec.status === 'leave' ? '請假' : '缺席'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {showEdit && user && (
        <MemberForm
          classId={user.classId}
          member={member}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load() }}
        />
      )}
    </div>
  )
}

// ─── 小元件 ───────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted w-14 shrink-0">{label}</span>
      <span className="text-sm text-ink">{value}</span>
    </div>
  )
}

function StatCard({ value, label, small }: { value: string | number; label: string; small?: boolean }) {
  return (
    <div className="card-lovable-compact py-4 text-center flex flex-col items-center justify-center">
      <p className={`font-semibold text-ink leading-tight ${small ? 'text-base' : 'text-3xl'}`}>
        {value}
      </p>
      <p className="text-xs text-muted mt-1">{label}</p>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 px-1">
      {children}
    </h2>
  )
}
