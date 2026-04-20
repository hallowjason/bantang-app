import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { addMember, updateMember, type IccfSyncResult } from '../lib/api/members'
import { iccfGetCurrentSessions, type IccfLoginResult, type IccfSessionInfo } from '../lib/api/iccfSession'
import { getRegionUnits, getEtiquetteItems, addRegionUnit } from '../lib/api/settings'
import { getIccfCopy } from '../lib/iccfCopy'
import IccfLoginModal from './IccfLoginModal'
import type { Member, EtiquetteItem, EtiquetteStatus, IccfSyncStatus } from '../types'

// ─── 狀態設定 ─────────────────────────────────────────────

type StatusOption = EtiquetteStatus | 'none'

const STATUS_CONFIG: Record<
  StatusOption,
  { label: string; bg: string; text: string; activeBg: string; activeText: string }
> = {
  none:      { label: '—',  bg: 'bg-gray-100',   text: 'text-gray-400',  activeBg: 'bg-gray-400',   activeText: 'text-white' },
  preparing: { label: '準', bg: 'bg-amber-50',    text: 'text-amber-400', activeBg: 'bg-amber-400',  activeText: 'text-white' },
  failed:    { label: '✗',  bg: 'bg-red-50',      text: 'text-red-400',   activeBg: 'bg-red-400',    activeText: 'text-white' },
  passed:    { label: '✓',  bg: 'bg-green-50',    text: 'text-green-500', activeBg: 'bg-green-500',  activeText: 'text-white' },
}

const STATUS_ORDER: StatusOption[] = ['none', 'preparing', 'failed', 'passed']

// ─── Props ────────────────────────────────────────────────

interface Props {
  classId: string
  iccfClassCode?: string   // e.g. "TWT019" — if provided, triggers iccf 補入 on create
  member?: Member          // 有值 → 編輯；undefined → 新增
  onClose: () => void
  onSaved: () => void
}

// ─── 欄位元件 ─────────────────────────────────────────────

function Field({ label, required, children }: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls = 'border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400'

// ─── 主元件 ───────────────────────────────────────────────

export default function MemberForm({ classId, iccfClassCode, member, onClose, onSaved }: Props) {
  const { user } = useAuth()

  // 基本資料
  const [name, setName]               = useState(member?.name ?? '')
  const [month, setMonth]             = useState(member?.birthday ? String(parseInt(member.birthday.split('-')[0])) : '')
  const [day, setDay]                 = useState(member?.birthday ? String(parseInt(member.birthday.split('-')[1])) : '')
  const [mentor, setMentor]           = useState(member?.mentor ?? '')
  const [regionUnit, setRegionUnit]   = useState(member?.regionUnit ?? '')
  const [regionNumber, setRegionNumber] = useState(member?.regionNumber ?? '')
  const [initialCount, setInitialCount] = useState(String(member?.initialAttendanceCount ?? 0))
  const [notes, setNotes]             = useState(member?.notes ?? '')

  // 區域自訂輸入
  const [customRegion, setCustomRegion] = useState(false)
  const [customRegionVal, setCustomRegionVal] = useState('')

  // 禮節狀態
  const [etiquetteStatuses, setEtiquetteStatuses] = useState<Record<string, EtiquetteStatus>>(
    member?.etiquetteItems ?? {},
  )

  // 設定資料
  const [regionUnits, setRegionUnits]       = useState<string[]>([])
  const [etiquetteItems, setEtiquetteItems] = useState<EtiquetteItem[]>([])
  const [settingsLoading, setSettingsLoading] = useState(true)

  // iccf session
  const [iccfSession, setIccfSession]         = useState<IccfSessionInfo | null>(null)
  const [showIccfLogin, setShowIccfLogin]     = useState(false)
  const [iccfResult, setIccfResult]           = useState<IccfSyncResult | null>(null)
  const [pendingSubmit, setPendingSubmit]     = useState(false)

  // 狀態
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getRegionUnits(), getEtiquetteItems()])
      .then(([units, items]) => {
        setRegionUnits(units)
        setEtiquetteItems(items)
      })
      .finally(() => setSettingsLoading(false))
  }, [])

  // Load existing iccf session if we're in create-with-iccf mode
  useEffect(() => {
    if (!iccfClassCode || member) return
    iccfGetCurrentSessions()
      .then(sessions => {
        if (sessions.length > 0) setIccfSession(sessions[0])
      })
      .catch(() => { /* non-critical */ })
  }, [iccfClassCode, member])


  const setEtiquetteStatus = (itemId: string, status: StatusOption) => {
    setEtiquetteStatuses(prev => {
      if (status === 'none') {
        const { [itemId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [itemId]: status }
    })
  }

  const buildMemberData = (): Omit<Member, 'id'> => {
    const m = month ? String(month).padStart(2, '0') : ''
    const d = day   ? String(day).padStart(2, '0')   : ''
    return {
      name:                   name.trim(),
      birthday:               m && d ? `${m}-${d}` : '',
      initialAttendanceCount: Math.max(0, parseInt(initialCount) || 0),
      mentor:                 mentor.trim(),
      regionUnit:             customRegion ? customRegionVal.trim() : regionUnit,
      regionNumber:           regionNumber.trim(),
      etiquetteItems:         etiquetteStatuses,
      notes,
      createdAt:              member?.createdAt ?? new Date().toISOString().slice(0, 10),
      createdBy:              member?.createdBy ?? (user?.uid ?? ''),
    }
  }

  const doSave = async (sessionId?: string) => {
    const memberData = buildMemberData()
    setSaving(true)
    setError(null)
    setIccfResult(null)
    try {
      if (customRegion && customRegionVal.trim()) {
        await addRegionUnit(customRegionVal.trim())
      }
      if (member) {
        await updateMember(member.id, memberData)
        onSaved()
      } else {
        const iccfOptions = sessionId && iccfClassCode
          ? { sessionId, classCode: iccfClassCode }
          : undefined
        const result = await addMember(memberData, classId, user?.uid ?? '', iccfOptions)
        if (result.iccf) {
          if (result.iccf.status === 'session_expired') {
            // Session died between login and save — clear session, re-prompt, retry
            setIccfSession(null)
            setPendingSubmit(true)
            setShowIccfLogin(true)
            return
          }
          setIccfResult(result.iccf)
          if (result.iccf.status === 'synced') {
            setTimeout(onSaved, 1500)
          }
          // For non-synced, stay open so user can see the error
        } else {
          onSaved()
        }
      }
    } catch {
      setError('儲存失敗，請再試一次')
    } finally {
      setSaving(false)
      setPendingSubmit(false)
    }
  }

  // ── 送出 ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('請輸入姓名'); return }

    // New member + iccf enabled: ensure session exists
    if (!member && iccfClassCode) {
      if (!iccfSession) {
        setPendingSubmit(true)
        setShowIccfLogin(true)
        return
      }
      await doSave(iccfSession.sessionId)
      return
    }

    await doSave()
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
    if (pendingSubmit) {
      await doSave(result.sessionId)
    }
  }

  return (
    <>
    {showIccfLogin && (
      <IccfLoginModal
        onSuccess={handleIccfLoginSuccess}
        onCancel={() => { setShowIccfLogin(false); setPendingSubmit(false) }}
      />
    )}
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl px-5 pt-4 pb-10 flex flex-col gap-5 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto shrink-0" />

        <h2 className="text-lg font-bold text-gray-800 shrink-0">
          {member ? '編輯班員' : '新增班員'}
        </h2>

        {/* iccf session 狀態列 */}
        {!member && iccfClassCode && (
          <div className="flex items-center gap-2 text-xs shrink-0">
            {iccfSession ? (
              <>
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-gray-500">
                  iccf 已登入（{iccfSession.profile?.name ?? iccfSession.iccfAccount}）
                </span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                <span className="text-gray-400">儲存時將要求登入 iccf 以完成補入</span>
              </>
            )}
          </div>
        )}

        {/* iccf 同步結果 */}
        {iccfResult && (() => {
          const copy = getIccfCopy(iccfResult.status as IccfSyncStatus)
          const toneClass =
            copy?.tone === 'green' ? 'bg-green-50 text-green-700 border-green-200' :
            copy?.tone === 'red'   ? 'bg-red-50 text-red-600 border-red-200' :
            copy?.tone === 'blue'  ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                     'bg-amber-50 text-amber-700 border-amber-200'
          return (
            <div className={`text-xs rounded-xl px-4 py-3 shrink-0 border ${toneClass}`}>
              <p className="font-semibold">
                {iccfResult.status === 'synced'
                  ? `✓ iccf 補入成功${iccfResult.iccfMemberId ? `（ID: ${iccfResult.iccfMemberId}）` : ''}`
                  : `⚠ ${copy?.summary ?? iccfResult.status}`
                }
              </p>
              {iccfResult.status !== 'synced' && copy?.suggestedReply && (
                <p className="mt-1.5 leading-snug text-current opacity-80">
                  {copy.suggestedReply(iccfResult.message ?? '')}
                </p>
              )}
              {iccfResult.status !== 'synced' && !copy?.suggestedReply && (
                <p className="mt-1 opacity-70">班員已建立，請手動至 iccf 補入。</p>
              )}
            </div>
          )
        })()}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2 shrink-0">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {/* ── 基本資料 ── */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider -mb-2">基本資料</p>

          <Field label="姓名" required>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="請輸入姓名" className={inputCls} />
          </Field>

          <Field label="生日（月 / 日）">
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={12} value={month}
                onChange={e => setMonth(e.target.value)} placeholder="月"
                className={`w-24 ${inputCls}`} />
              <span className="text-gray-400 text-lg">/</span>
              <input type="number" min={1} max={31} value={day}
                onChange={e => setDay(e.target.value)} placeholder="日"
                className={`w-24 ${inputCls}`} />
            </div>
          </Field>

          <Field label="引保師">
            <input type="text" value={mentor} onChange={e => setMentor(e.target.value)}
              placeholder="選填" className={inputCls} />
          </Field>

          {/* ── 區域 ── */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider -mb-2">區域資料</p>

          <Field label="區域單位">
            {settingsLoading ? (
              <p className="text-sm text-gray-400 py-2">載入中...</p>
            ) : customRegion ? (
              <div className="flex gap-2">
                <input type="text" value={customRegionVal}
                  onChange={e => setCustomRegionVal(e.target.value)}
                  placeholder="輸入自訂單位" className={`flex-1 ${inputCls}`} />
                <button type="button" onClick={() => setCustomRegion(false)}
                  className="text-xs text-gray-400 hover:text-gray-600 px-2">取消</button>
              </div>
            ) : (
              <select value={regionUnit} onChange={e => {
                if (e.target.value === '__custom__') { setCustomRegion(true); setRegionUnit('') }
                else setRegionUnit(e.target.value)
              }} className={inputCls}>
                <option value="">請選擇</option>
                {regionUnits.map(u => <option key={u} value={u}>{u}</option>)}
                <option value="__custom__">＋ 自訂輸入</option>
              </select>
            )}
          </Field>

          <Field label="區域數字">
            <input type="text" value={regionNumber}
              onChange={e => setRegionNumber(e.target.value)}
              placeholder="選填" className={inputCls} />
          </Field>

          {/* ── 出席 ── */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider -mb-2">出席設定</p>

          <Field label="加入前既有堂數">
            <input type="number" min={0} value={initialCount}
              onChange={e => setInitialCount(e.target.value)}
              placeholder="0" className={`w-32 ${inputCls}`} />
          </Field>

          {/* ── 禮節項目 ── */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider -mb-2">禮節項目</p>

          {settingsLoading ? (
            <p className="text-sm text-gray-400">載入禮節項目中...</p>
          ) : (
            <div className="flex flex-col gap-0 divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
              {etiquetteItems.map(item => {
                const current: StatusOption = etiquetteStatuses[item.id] ?? 'none'
                return (
                  <div key={item.id} className="flex items-center justify-between px-4 py-3 bg-white">
                    <span className="text-sm text-gray-700 flex-1">{item.name}</span>
                    <div className="flex gap-1.5 shrink-0">
                      {STATUS_ORDER.map(s => {
                        const cfg = STATUS_CONFIG[s]
                        const active = current === s
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setEtiquetteStatus(item.id, s)}
                            className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                              active
                                ? `${cfg.activeBg} ${cfg.activeText}`
                                : `${cfg.bg} ${cfg.text}`
                            }`}
                          >
                            {cfg.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── 備註 ── */}
          <Field label="備註">
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="選填" rows={3}
              className={`${inputCls} resize-none`} />
          </Field>

          {/* ── 按鈕 ── */}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50">
              取消
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-3 rounded-xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 disabled:opacity-50">
              {saving ? '儲存中...' : '儲存'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </>
  )
}
