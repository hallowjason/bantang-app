import { useState, useEffect, useCallback, useRef } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getAllVenues, createVenue, updateVenue, deleteVenue,
  getAllEvents, createEvent, updateEvent, deleteEvent,
  toggleEventPublished, getEventResponses, deleteEventResponse,
  uploadEventImage,
  claimEvent, unclaimEvent, updateEventResponse, subscribeToEventResponses,
} from '../lib/api/portal'
import { getAllUsers, updateUserProfile } from '../lib/api/admin'
import type {
  AppUser, Venue, PortalEvent, EventResponse, EventType, Responsible, InterestLevel,
} from '../types'

// ─── 輔助函式 ─────────────────────────────────────────────

const isPortalAdminRole = (role: string) =>
  role === 'class_master' || role === 'head_leader' || role === 'junior_leader'

// ─── 共用元件 ─────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'border border-gray-200 rounded-xl px-3 py-2.5 text-sm w-full focus:outline-none focus:border-sky-400'

// ─── 型別 ─────────────────────────────────────────────────

type Tab = 'events' | 'venues' | 'users'

const TYPE_OPTIONS: { value: EventType; label: string }[] = [
  { value: 'lecture', label: '📖 講座' },
  { value: 'trip',    label: '✈️ 出遊' },
  { value: 'camp',    label: '⛺ 營隊' },
  { value: 'class',   label: '🎓 課程' },
  { value: 'other',   label: '📌 其他' },
]

const INTEREST_LABEL: Record<string, string> = {
  yes: '✅ 參加', maybe: '🤔 考慮', no: '❌ 無法',
}

const CITY_OPTIONS = ['台北', '新北', '桃園']

// ─── 活動管理 Tab ─────────────────────────────────────────

const EMPTY_EVENT: Omit<PortalEvent, 'id'> = {
  title: '', type: 'lecture', description: '',
  imageUrl: undefined,
  eventDates: [], deadline: '',
  responsible: [],
  isPublished: false, createdAt: '', createdBy: '',
}

function EventsTab({ currentUid, currentUserName }: { currentUid: string; currentUserName: string }) {
  const [events, setEvents]           = useState<PortalEvent[]>([])
  const [loading, setLoading]         = useState(true)
  const [editId, setEditId]           = useState<string | 'new' | null>(null)
  const [form, setForm]               = useState<Omit<PortalEvent, 'id'>>(EMPTY_EVENT)
  const [dateInput, setDateInput]     = useState('')
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState('')
  const [deleting, setDeleting]       = useState('')
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl]   = useState('')

  // 回覆查看
  const [viewResponsesId, setViewResponsesId] = useState('')
  const [responses, setResponses]             = useState<EventResponse[]>([])
  const [loadingRes, setLoadingRes]           = useState(false)
  const [isLiveView, setIsLiveView]           = useState(false)

  // 認領
  const [claiming, setClaiming] = useState('')

  // 背景訂閱（認領活動 badge）+ 查看訂閱
  const bgUnsubsRef  = useRef<Record<string, () => void>>({})
  const viewUnsubRef = useRef<(() => void) | null>(null)
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({})
  const [seenCounts, setSeenCounts] = useState<Record<string, number>>({})

  // 編輯回覆
  const [editRespId, setEditRespId]     = useState<string | null>(null)
  const [editRespForm, setEditRespForm] = useState({
    name: '', phone: '', email: '', interest: 'yes' as InterestLevel, note: '',
  })
  const [savingResp, setSavingResp] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setEvents(await getAllEvents())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // 背景訂閱：認領中的活動有新回覆時更新 badge 計數
  useEffect(() => {
    Object.values(bgUnsubsRef.current).forEach(fn => fn())
    bgUnsubsRef.current = {}
    events.filter(ev => ev.claimedBy?.uid === currentUid).forEach(ev => {
      bgUnsubsRef.current[ev.id] = subscribeToEventResponses(ev.id, data => {
        setLiveCounts(prev => ({ ...prev, [ev.id]: data.length }))
      })
    })
    return () => { Object.values(bgUnsubsRef.current).forEach(fn => fn()) }
  }, [events, currentUid])

  // 元件卸載時清除 view 訂閱
  useEffect(() => () => { viewUnsubRef.current?.() }, [])

  const openNew = () => {
    setForm({ ...EMPTY_EVENT, createdAt: new Date().toISOString(), createdBy: currentUid })
    setDateInput('')
    setPendingImageFile(null)
    setImagePreviewUrl('')
    setEditId('new')
  }

  const openEdit = (ev: PortalEvent) => {
    setForm({
      title:       ev.title       ?? '',
      type:        ev.type        ?? 'lecture',
      description: ev.description ?? '',
      imageUrl:    ev.imageUrl,                           // undefined 在後續 handleSave 中會被移除
      eventDates:  Array.isArray(ev.eventDates) ? [...ev.eventDates] : [],
      deadline:    ev.deadline    ?? '',
      responsible: Array.isArray(ev.responsible) ? [...ev.responsible] : [],
      isPublished: ev.isPublished ?? false,
      createdAt:   ev.createdAt   ?? '',
      createdBy:   ev.createdBy   ?? '',
    })
    setDateInput('')
    setPendingImageFile(null)
    setImagePreviewUrl('')
    setEditId(ev.id)
  }

  // 釋放舊的 blob URL，避免記憶體洩漏
  useEffect(() => {
    return () => {
      if (imagePreviewUrl.startsWith('blob:')) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingImageFile(file)
    setImagePreviewUrl(URL.createObjectURL(file))
  }

  const addDate = () => {
    const d = dateInput.trim()
    if (!d || form.eventDates.includes(d)) return
    setForm(prev => ({ ...prev, eventDates: [...prev.eventDates, d].sort() }))
    setDateInput('')
  }

  const removeDate = (d: string) =>
    setForm(prev => ({ ...prev, eventDates: prev.eventDates.filter(x => x !== d) }))

  const addResponsible = () => {
    if (form.responsible.length >= 3) return
    setForm(prev => ({ ...prev, responsible: [...prev.responsible, { name: '', lineId: '' }] }))
  }

  const updateResponsible = (idx: number, field: keyof Responsible, value: string) =>
    setForm(prev => ({
      ...prev,
      responsible: prev.responsible.map((r, i) => i === idx ? { ...r, [field]: value } : r),
    }))

  const removeResponsible = (idx: number) =>
    setForm(prev => ({ ...prev, responsible: prev.responsible.filter((_, i) => i !== idx) }))

  const handleSave = async () => {
    if (!form.title.trim() || !form.deadline) return
    setSaving(true)
    setSaveError('')
    try {
      // 決定最終 imageUrl（不傳 undefined 給 Firestore，否則會報錯）
      let imageUrl: string | undefined = form.imageUrl
      if (pendingImageFile) {
        imageUrl = await uploadEventImage(pendingImageFile)
      }

      // 建立不含 undefined 欄位的 eventData
      const eventData: Omit<PortalEvent, 'id'> = {
        ...form,
        responsible: form.responsible ?? [],
      }
      if (imageUrl) {
        eventData.imageUrl = imageUrl
      } else {
        delete eventData.imageUrl  // 移除以避免寫入 undefined
      }

      if (editId === 'new') {
        await createEvent(eventData)
      } else if (editId) {
        await updateEvent(editId, eventData)
      }
      setEditId(null)
      setPendingImageFile(null)
      setImagePreviewUrl('')
      await load()
    } catch (err) {
      console.error('[PortalAdmin] handleSave error:', err)
      setSaveError('儲存失敗，請確認欄位後再試一次。')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此活動？')) return
    setDeleting(id)
    try { await deleteEvent(id); await load() }
    finally { setDeleting('') }
  }

  const handleTogglePublish = async (ev: PortalEvent) => {
    await toggleEventPublished(ev.id, !ev.isPublished)
    await load()
  }

  const loadResponses = async (ev: PortalEvent) => {
    const eventId = ev.id
    if (viewResponsesId === eventId) {
      viewUnsubRef.current?.(); viewUnsubRef.current = null
      setViewResponsesId(''); setIsLiveView(false); return
    }
    viewUnsubRef.current?.(); viewUnsubRef.current = null
    setViewResponsesId(eventId); setEditRespId(null)
    // 標記為已讀（清除 badge）
    setSeenCounts(prev => ({ ...prev, [eventId]: liveCounts[eventId] ?? 0 }))
    const isMyClaimed = ev.claimedBy?.uid === currentUid
    if (isMyClaimed) {
      setIsLiveView(true); setLoadingRes(true)
      viewUnsubRef.current = subscribeToEventResponses(eventId, data => {
        setResponses(data); setLoadingRes(false)
      })
    } else {
      setIsLiveView(false); setLoadingRes(true)
      try { setResponses(await getEventResponses(eventId)) }
      catch { setResponses([]) }
      finally { setLoadingRes(false) }
    }
  }

  const handleClaim = async (ev: PortalEvent) => {
    setClaiming(ev.id)
    try {
      if (ev.claimedBy?.uid === currentUid) await unclaimEvent(ev.id)
      else await claimEvent(ev.id, currentUid, currentUserName)
      await load()
    } finally { setClaiming('') }
  }

  const handleEditResp = (r: EventResponse) => {
    setEditRespId(r.id)
    setEditRespForm({ name: r.name, phone: r.phone, email: r.email, interest: r.interest, note: r.note })
  }

  const handleSaveResp = async () => {
    if (!editRespId) return
    setSavingResp(true)
    try {
      await updateEventResponse(editRespId, editRespForm)
      if (!isLiveView) setResponses(prev => prev.map(r => r.id === editRespId ? { ...r, ...editRespForm } : r))
      setEditRespId(null)
    } finally { setSavingResp(false) }
  }

  const handleDeleteResp = async (id: string) => {
    if (!confirm('確定要刪除此回覆？')) return
    await deleteEventResponse(id)
    if (!isLiveView) setResponses(prev => prev.filter(r => r.id !== id))
  }

  const exportCSV = (evTitle: string) => {
    const headers = ['姓名', '電話', 'Email', '意願', '備註', '送出時間']
    const rows = responses.map(r => [
      r.name, r.phone, r.email,
      r.interest === 'yes' ? '參加' : r.interest === 'maybe' ? '考慮中' : '無法參加',
      r.note,
      new Date(r.submittedAt).toLocaleString('zh-TW'),
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `${evTitle}_回覆名單.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const displayImageUrl = imagePreviewUrl || form.imageUrl

  return (
    <div className="flex flex-col gap-4">
      <button onClick={openNew}
        className="w-full py-2.5 rounded-xl bg-sky-600 text-white text-sm font-medium hover:bg-sky-700">
        ＋ 新增活動
      </button>

      {/* 表單 */}
      {editId && (
        <div className="bg-white rounded-2xl border border-sky-200 px-5 py-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-sky-700">{editId === 'new' ? '新增活動' : '編輯活動'}</p>

          <Field label="活動名稱 *">
            <input value={form.title}
              onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
              placeholder="大師系列講座 ─ 春季場"
              className={inputCls} />
          </Field>

          <Field label="活動類型">
            <select value={form.type}
              onChange={e => setForm(prev => ({ ...prev, type: e.target.value as EventType }))}
              className={inputCls}>
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>

          <Field label="活動說明">
            <textarea value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              rows={3} placeholder="活動詳情說明..."
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm w-full focus:outline-none focus:border-sky-400 resize-none" />
          </Field>

          {/* 封面圖片 */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">封面圖片（選填）</label>
            {displayImageUrl && (
              <img src={displayImageUrl} alt="封面預覽"
                className="w-full rounded-xl object-cover aspect-video" />
            )}
            <input type="file" accept="image/*" onChange={handleImageSelect}
              className="text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100" />
          </div>

          {/* 活動日期 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-500">活動日期</label>
            <div className="flex gap-2">
              <input type="date" value={dateInput} onChange={e => setDateInput(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
              <button onClick={addDate}
                className="px-3 py-1.5 rounded-lg bg-sky-100 text-sky-700 text-xs hover:bg-sky-200">
                加入
              </button>
            </div>
            {form.eventDates.map(d => (
              <div key={d} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 flex-1">{d}</span>
                <button onClick={() => removeDate(d)} className="text-xs text-red-400 hover:text-red-600">✕</button>
              </div>
            ))}
          </div>

          <Field label="填寫截止日 *">
            <input type="date" value={form.deadline}
              onChange={e => setForm(prev => ({ ...prev, deadline: e.target.value }))}
              className={inputCls} />
          </Field>

          {/* 負責人（最多 3 位） */}
          <div className="bg-sky-50 border border-sky-100 rounded-xl px-4 py-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-sky-700">活動負責人</p>
              {form.responsible.length < 3 && (
                <button onClick={addResponsible}
                  className="text-xs text-sky-600 hover:text-sky-800 font-medium">
                  ＋ 新增
                </button>
              )}
            </div>
            {form.responsible.length === 0 && (
              <p className="text-xs text-gray-400">尚未新增負責人</p>
            )}
            {form.responsible.map((r, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input value={r.name}
                  onChange={e => updateResponsible(idx, 'name', e.target.value)}
                  placeholder="姓名"
                  className="flex-1 border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:border-sky-400" />
                <input value={r.lineId}
                  onChange={e => updateResponsible(idx, 'lineId', e.target.value)}
                  placeholder="LINE ID"
                  className="flex-1 border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:border-sky-400" />
                <button onClick={() => removeResponsible(idx)}
                  className="text-gray-400 hover:text-red-500 shrink-0 text-lg leading-none">✕</button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="isPublished" checked={form.isPublished}
              onChange={e => setForm(prev => ({ ...prev, isPublished: e.target.checked }))}
              className="w-4 h-4 rounded" />
            <label htmlFor="isPublished" className="text-xs text-gray-600">立即上架</label>
          </div>

          {saveError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{saveError}</p>
          )}

          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2 rounded-xl bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-60">
              {saving ? '儲存中...' : '儲存'}
            </button>
            <button onClick={() => { setEditId(null); setSaveError('') }}
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
              取消
            </button>
          </div>
        </div>
      )}

      {/* 活動列表 */}
      {loading ? (
        <p className="text-center text-sm text-gray-400 py-6">讀取中...</p>
      ) : events.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-6">尚無活動，請新增</p>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map(ev => (
            <div key={ev.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {ev.imageUrl && (
                <img src={ev.imageUrl} alt={ev.title}
                  className="w-full object-cover aspect-video" />
              )}
              <div className="px-5 py-4 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{ev.title}</p>
                    <p className="text-xs text-gray-400">截止：{ev.deadline} · {ev.eventDates.length} 個日期</p>
                    {ev.responsible?.length > 0 && (
                      <p className="text-xs text-gray-400">負責人：{ev.responsible.map(r => r.name).join('、')}</p>
                    )}
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                    ev.isPublished ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                    {ev.isPublished ? '已上架' : '未上架'}
                  </span>
                </div>

                <div className="flex gap-1.5 flex-wrap">
                  <button onClick={() => handleTogglePublish(ev)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                      ev.isPublished
                        ? 'border-orange-200 text-orange-600 hover:bg-orange-50'
                        : 'border-green-200 text-green-600 hover:bg-green-50'
                    }`}>
                    {ev.isPublished ? '下架' : '上架'}
                  </button>
                  {/* 查看回覆（認領後顯示新回覆 badge） */}
                  <button onClick={() => loadResponses(ev)}
                    className="relative text-xs px-2.5 py-1 rounded-lg border border-sky-200 text-sky-600 hover:bg-sky-50">
                    查看回覆
                    {(() => {
                      const badge = (liveCounts[ev.id] ?? 0) - (seenCounts[ev.id] ?? 0)
                      return badge > 0 ? (
                        <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                          {badge > 9 ? '9+' : badge}
                        </span>
                      ) : null
                    })()}
                  </button>
                  {/* 認領管理 */}
                  <button
                    onClick={() => handleClaim(ev)}
                    disabled={claiming === ev.id || (!!ev.claimedBy && ev.claimedBy.uid !== currentUid)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                      ev.claimedBy?.uid === currentUid
                        ? 'border-violet-200 text-violet-600 hover:bg-violet-50'
                        : ev.claimedBy
                        ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                        : 'border-indigo-200 text-indigo-600 hover:bg-indigo-50'
                    }`}
                  >
                    {claiming === ev.id ? '...' :
                     ev.claimedBy?.uid === currentUid ? '✓ 已認領' :
                     ev.claimedBy ? `${ev.claimedBy.name} 認領中` : '認領管理'}
                  </button>
                  <button onClick={() => openEdit(ev)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50">
                    編輯
                  </button>
                  <button onClick={() => handleDelete(ev.id)} disabled={deleting === ev.id}
                    className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 disabled:opacity-50">
                    {deleting === ev.id ? '...' : '刪除'}
                  </button>
                </div>

                {/* 回覆面板 */}
                {viewResponsesId === ev.id && (() => {
                  const yesCnt   = responses.filter(r => r.interest === 'yes').length
                  const maybeCnt = responses.filter(r => r.interest === 'maybe').length
                  const noCnt    = responses.filter(r => r.interest === 'no').length
                  const total    = responses.length
                  return (
                    <div className="mt-1 border-t border-gray-100 pt-3 flex flex-col gap-3">
                      {/* 標題列 */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-gray-600">意願回覆</p>
                          {isLiveView && (
                            <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
                              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                              即時
                            </span>
                          )}
                        </div>
                        {total > 0 && (
                          <button onClick={() => exportCSV(ev.title)}
                            className="text-[11px] text-sky-600 border border-sky-200 rounded-lg px-2 py-0.5 hover:bg-sky-50">
                            ↓ 匯出 CSV
                          </button>
                        )}
                      </div>

                      {loadingRes ? (
                        <p className="text-xs text-gray-400">讀取中...</p>
                      ) : total === 0 ? (
                        <p className="text-xs text-gray-400">尚無回覆</p>
                      ) : (
                        <>
                          {/* 統計圖表 */}
                          <div className="bg-gray-50 rounded-xl px-3 py-2.5 flex flex-col gap-1.5">
                            {[
                              { key: 'yes',   label: '✅ 參加', color: 'bg-green-400',  count: yesCnt },
                              { key: 'maybe', label: '🤔 考慮', color: 'bg-amber-400',  count: maybeCnt },
                              { key: 'no',    label: '❌ 無法', color: 'bg-red-300',    count: noCnt },
                            ].map(row => (
                              <div key={row.key} className="flex items-center gap-2">
                                <span className="text-[11px] text-gray-500 w-14 shrink-0">{row.label}</span>
                                <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full ${row.color} rounded-full transition-all duration-500`}
                                    style={{ width: total > 0 ? `${(row.count / total) * 100}%` : '0%' }}
                                  />
                                </div>
                                <span className="text-[11px] text-gray-600 w-6 text-right shrink-0 font-medium">{row.count}</span>
                              </div>
                            ))}
                            <p className="text-[11px] text-gray-400 mt-0.5">共 {total} 筆</p>
                          </div>

                          {/* 回覆列表 */}
                          <div className="flex flex-col gap-2">
                            {responses.map(r => (
                              <div key={r.id} className="bg-gray-50 rounded-xl overflow-hidden">
                                {editRespId === r.id ? (
                                  /* 編輯模式 */
                                  <div className="px-3 py-2.5 flex flex-col gap-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <input value={editRespForm.name}
                                        onChange={e => setEditRespForm(p => ({ ...p, name: e.target.value }))}
                                        placeholder="姓名"
                                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400" />
                                      <input value={editRespForm.phone}
                                        onChange={e => setEditRespForm(p => ({ ...p, phone: e.target.value }))}
                                        placeholder="電話"
                                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400" />
                                    </div>
                                    <input value={editRespForm.email}
                                      onChange={e => setEditRespForm(p => ({ ...p, email: e.target.value }))}
                                      placeholder="Email"
                                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400 w-full" />
                                    <div className="flex gap-2 items-center">
                                      <select value={editRespForm.interest}
                                        onChange={e => setEditRespForm(p => ({ ...p, interest: e.target.value as InterestLevel }))}
                                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400 flex-1">
                                        <option value="yes">✅ 參加</option>
                                        <option value="maybe">🤔 考慮中</option>
                                        <option value="no">❌ 無法參加</option>
                                      </select>
                                      <input value={editRespForm.note}
                                        onChange={e => setEditRespForm(p => ({ ...p, note: e.target.value }))}
                                        placeholder="備註"
                                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400 flex-1" />
                                    </div>
                                    <div className="flex gap-2">
                                      <button onClick={handleSaveResp} disabled={savingResp}
                                        className="flex-1 py-1 rounded-lg bg-sky-600 text-white text-xs font-medium hover:bg-sky-700 disabled:opacity-60">
                                        {savingResp ? '儲存中...' : '儲存'}
                                      </button>
                                      <button onClick={() => setEditRespId(null)}
                                        className="px-3 py-1 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-white">
                                        取消
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  /* 顯示模式 */
                                  <div className="px-3 py-2 flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-gray-700">
                                        {r.name}
                                        <span className="text-gray-400 font-normal ml-1">{r.phone}</span>
                                      </p>
                                      {r.email && <p className="text-[11px] text-gray-400">{r.email}</p>}
                                      {r.note  && <p className="text-[11px] text-gray-400 mt-0.5">{r.note}</p>}
                                      <p className="text-[10px] text-gray-300 mt-0.5">
                                        {new Date(r.submittedAt).toLocaleString('zh-TW', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <span className="text-xs">{INTEREST_LABEL[r.interest] ?? r.interest}</span>
                                      <button onClick={() => handleEditResp(r)}
                                        className="text-gray-300 hover:text-sky-500 text-xs px-1">✏️</button>
                                      <button onClick={() => handleDeleteResp(r.id)}
                                        className="text-gray-300 hover:text-red-500 text-xs px-1">✕</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 據點管理 Tab ─────────────────────────────────────────

const EMPTY_VENUE: Omit<Venue, 'id'> = {
  name: '', city: '台北', address: '', mapUrl: '',
  lineGroupUrl: '', description: '', members: [], order: 0,
}

function VenuesTab() {
  const [venues, setVenues]     = useState<Venue[]>([])
  const [loading, setLoading]   = useState(true)
  const [editId, setEditId]     = useState<string | 'new' | null>(null)
  const [form, setForm]         = useState<Omit<Venue, 'id'>>(EMPTY_VENUE)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleting, setDeleting] = useState('')
  const [memberInput, setMemberInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setVenues(await getAllVenues())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openNew = () => {
    setForm({ ...EMPTY_VENUE, order: venues.length })
    setMemberInput('')
    setEditId('new')
  }

  const openEdit = (v: Venue) => {
    setForm({
      name: v.name, city: v.city, address: v.address, mapUrl: v.mapUrl,
      lineGroupUrl: v.lineGroupUrl ?? '', description: v.description,
      members: v.members ?? [], order: v.order,
    })
    setMemberInput('')
    setEditId(v.id)
  }

  const addMember = () => {
    const name = memberInput.trim()
    if (!name || form.members?.includes(name)) return
    setForm(prev => ({ ...prev, members: [...(prev.members ?? []), name] }))
    setMemberInput('')
  }

  const removeMember = (name: string) =>
    setForm(prev => ({ ...prev, members: (prev.members ?? []).filter(m => m !== name) }))

  const handleSave = async () => {
    if (!form.name.trim() || !form.address.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      if (editId === 'new') {
        await createVenue(form)
      } else if (editId) {
        await updateVenue(editId, form)
      }
      setEditId(null)
      await load()
    } catch {
      setSaveError('儲存失敗，請確認欄位後再試一次。')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此據點？')) return
    setDeleting(id)
    try { await deleteVenue(id); await load() }
    finally { setDeleting('') }
  }

  const f = (key: keyof Omit<Venue, 'id'>) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value }))

  return (
    <div className="flex flex-col gap-4">
      <button onClick={openNew}
        className="w-full py-2.5 rounded-xl bg-sky-600 text-white text-sm font-medium hover:bg-sky-700">
        ＋ 新增據點
      </button>

      {editId && (
        <div className="bg-white rounded-2xl border border-sky-200 px-5 py-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-sky-700">{editId === 'new' ? '新增據點' : '編輯據點'}</p>

          <Field label="佛堂名稱 *">
            <input value={form.name} onChange={f('name')} placeholder="三重佛堂" className={inputCls} />
          </Field>
          <Field label="城市">
            <select value={form.city} onChange={f('city')} className={inputCls}>
              {CITY_OPTIONS.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="完整地址 *">
            <input value={form.address} onChange={f('address')} placeholder="台北市○○區○○路○號" className={inputCls} />
          </Field>
          <Field label="Google Maps 連結">
            <input value={form.mapUrl} onChange={f('mapUrl')} placeholder="https://maps.app.goo.gl/..." className={inputCls} />
          </Field>
          <Field label="LINE 群組連結（選填）">
            <input value={form.lineGroupUrl ?? ''} onChange={f('lineGroupUrl')} placeholder="https://line.me/R/ti/g/..." className={inputCls} />
          </Field>
          <Field label="說明（可空）">
            <textarea value={form.description} onChange={f('description')} rows={2}
              placeholder="簡短說明此據點..."
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm w-full focus:outline-none focus:border-sky-400 resize-none" />
          </Field>
          <Field label="顯示順序">
            <input type="number" value={form.order}
              onChange={e => setForm(prev => ({ ...prev, order: Number(e.target.value) }))}
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm w-24 focus:outline-none focus:border-sky-400" />
          </Field>

          {/* 成員名單管理 */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">成員名單</label>
            <div className="flex gap-2">
              <input value={memberInput} onChange={e => setMemberInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addMember()}
                placeholder="輸入姓名"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400" />
              <button onClick={addMember}
                className="px-3 py-1.5 rounded-lg bg-sky-100 text-sky-700 text-xs hover:bg-sky-200">
                加入
              </button>
            </div>
            {(form.members ?? []).length === 0 ? (
              <p className="text-xs text-gray-400">尚無成員</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(form.members ?? []).map(name => (
                  <span key={name}
                    className="flex items-center gap-1 text-xs bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full">
                    {name}
                    <button onClick={() => removeMember(name)} className="text-sky-400 hover:text-red-500">✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {saveError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{saveError}</p>
          )}

          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2 rounded-xl bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-60">
              {saving ? '儲存中...' : '儲存'}
            </button>
            <button onClick={() => { setEditId(null); setSaveError('') }}
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
              取消
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-6">讀取中...</p>
      ) : venues.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-6">尚無據點，請新增</p>
      ) : (
        <div className="flex flex-col gap-2">
          {venues.map(v => (
            <div key={v.id} className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{v.name}</p>
                <p className="text-xs text-gray-400">{v.city} · {v.address}</p>
                {v.members && v.members.length > 0 && (
                  <p className="text-xs text-gray-400">成員：{v.members.join('、')}</p>
                )}
                {v.lineGroupUrl && (
                  <p className="text-xs text-green-600">LINE 群組已設定</p>
                )}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => openEdit(v)}
                  className="text-xs text-sky-600 border border-sky-200 px-2.5 py-1 rounded-lg hover:bg-sky-50">
                  編輯
                </button>
                <button onClick={() => handleDelete(v.id)} disabled={deleting === v.id}
                  className="text-xs text-red-400 border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-50 disabled:opacity-50">
                  {deleting === v.id ? '...' : '刪除'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 人員管理 Tab ─────────────────────────────────────────

function UsersTab() {
  const [users, setUsers]     = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saved, setSaved]       = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    const all = await getAllUsers()
    // 只顯示班員側使用者
    setUsers(all.filter(u => u.role === 'member' || u.role === 'junior_leader'))
    setLoading(false)
  }, [])

  useEffect(() => {
    loadUsers()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [loadUsers])

  const handleToggle = async (u: AppUser) => {
    const newRole = u.role === 'junior_leader' ? 'member' : 'junior_leader'
    setSavingId(u.uid)
    try {
      await updateUserProfile(u.uid, { role: newRole })
      setSaved(u.uid)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSaved(null), 1500)
      await loadUsers()
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-sky-50 border border-sky-200 rounded-2xl px-4 py-3">
        <p className="text-xs text-sky-700 font-medium">💡 小班長升級說明</p>
        <p className="text-xs text-sky-600 mt-1">
          點擊「升為小班長」後，該班員即可登入班員後台管理活動與據點。<br />
          點擊「降為班員」可取消小班長權限。
        </p>
      </div>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-6">讀取中...</p>
      ) : users.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-6">目前沒有班員或小班長帳號</p>
      ) : (
        users.map(u => (
          <div key={u.uid}
            className={`bg-white rounded-2xl border px-4 py-3 flex items-center gap-3 transition-colors
              ${saved === u.uid ? 'border-green-300' : 'border-gray-100'}`}>
            {u.photoURL && <img src={u.photoURL} alt={u.name} className="w-8 h-8 rounded-full shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{u.name || '（無姓名）'}</p>
              <p className="text-xs text-gray-400 truncate">{u.email ?? '—'}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                u.role === 'junior_leader' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {u.role === 'junior_leader' ? '小班長' : '班員'}
              </span>
              {saved === u.uid ? (
                <span className="text-xs text-green-600 font-medium">✓ 已更新</span>
              ) : (
                <button
                  onClick={() => handleToggle(u)}
                  disabled={savingId === u.uid}
                  className={`text-xs px-3 py-1.5 rounded-xl border transition-colors disabled:opacity-50 ${
                    u.role === 'junior_leader'
                      ? 'border-orange-200 text-orange-600 hover:bg-orange-50'
                      : 'border-sky-200 text-sky-600 hover:bg-sky-50'
                  }`}
                >
                  {savingId === u.uid ? '...' : u.role === 'junior_leader' ? '降為班員' : '升為小班長'}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function PortalAdmin() {
  const { user, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<Tab>('events')

  // 載入中
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sky-50">
        <p className="text-gray-400 text-sm">載入中...</p>
      </div>
    )
  }

  // 非班員後台管理員：導向班員入口
  if (!user || !isPortalAdminRole(user.role)) {
    return <Navigate to="/portal/schedule" replace />
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'events', label: '🎉 活動' },
    { key: 'venues', label: '📍 據點' },
    { key: 'users',  label: '👤 人員' },
  ]

  return (
    <div className="min-h-screen bg-sky-50">
      <header className="bg-white border-b border-sky-100 sticky top-0 z-10">
        <div className="max-w-screen-sm mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-sky-800">班員後台</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {user.role === 'junior_leader' ? '小班長' : user.role === 'class_master' ? '主班' : '大領班'} · {user.name}
            </p>
          </div>
          <Link to="/portal/schedule" className="text-xs text-sky-600 border border-sky-200 rounded-lg px-2.5 py-1 hover:bg-sky-50">
            ← 班員入口
          </Link>
        </div>
        <div className="max-w-screen-sm mx-auto px-4 pb-0 flex border-b border-sky-100">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors
                ${tab === t.key
                  ? 'border-sky-600 text-sky-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-screen-sm mx-auto px-4 pt-4 pb-10">
        {tab === 'events' ? (
          <EventsTab currentUid={user.uid} currentUserName={user.name} />
        ) : tab === 'venues' ? (
          <VenuesTab />
        ) : (
          <UsersTab />
        )}
      </main>
    </div>
  )
}
