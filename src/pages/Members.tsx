import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getMembers, removeMemberFromClass, getClassInfo } from '../lib/api/members'
import MemberForm from '../components/MemberForm'
import SheetsImportModal from '../components/SheetsImportModal'
import type { Member } from '../types'

// ─── 移除對話框 ───────────────────────────────────────────

interface RemoveDialogProps {
  member: Member
  classId: string
  removedBy: string
  onCancel: () => void
  onRemoved: () => void
}

function RemoveDialog({ member, classId, removedBy, onCancel, onRemoved }: RemoveDialogProps) {
  const [reason, setReason] = useState('')
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    if (!reason.trim()) { setError('請填寫移除原因'); return }
    setRemoving(true)
    setError(null)
    try {
      await removeMemberFromClass(classId, member.id, removedBy, reason.trim())
      onRemoved()
    } catch {
      setError('操作失敗，請再試一次')
      setRemoving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 flex flex-col gap-4">
        <h2 className="text-base font-bold text-gray-800">移除出班</h2>
        <p className="text-sm text-gray-600">
          確定要將 <span className="font-semibold">{member.name}</span> 移除出本班？
          此操作可復原，班員資料不會刪除。
        </p>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">
            移除原因 <span className="text-red-400">*</span>
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="請填寫移除原因"
            rows={3}
            autoFocus
            className="border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={removing}
            className="flex-1 py-3 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50"
          >
            {removing ? '移除中...' : '確認移除'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function Members() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [members, setMembers] = useState<Member[]>([])
  const [iccfClassCode, setIccfClassCode] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)

  // 長按偵測
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasLongPress = useRef(false)

  const load = useCallback(async () => {
    if (!user?.classId) return
    setLoading(true)
    try {
      const [data, classInfo] = await Promise.all([
        getMembers(user.classId),
        getClassInfo(user.classId),
      ])
      setMembers(data)
      setIccfClassCode(classInfo?.iccfClassCode || undefined)
    } finally {
      setLoading(false)
    }
  }, [user?.classId])

  useEffect(() => { load() }, [load])

  const startPress = (member: Member) => {
    wasLongPress.current = false
    pressTimer.current = setTimeout(() => {
      wasLongPress.current = true
      setRemoveTarget(member)
    }, 600)
  }

  const endPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const handleCardClick = (member: Member) => {
    if (!wasLongPress.current) navigate(`/members/${member.id}`)
    wasLongPress.current = false
  }

  const regionLabel = (m: Member) => {
    const parts = [m.regionUnit, m.regionNumber].filter(Boolean)
    return parts.length ? parts.join('') : null
  }

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <header className="bg-white border-b border-amber-100 sticky top-0 z-10">
        <div className="max-w-screen-sm mx-auto px-4 py-3 flex items-center justify-between">
          <div className="w-12" />
          <h1 className="text-base font-bold text-gray-800">班員管理</h1>
          {user?.classId ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowImport(true)}
                className="text-xs text-amber-700 border border-amber-300 px-2.5 py-1.5 rounded-lg hover:bg-amber-50 active:bg-amber-100"
              >
                試算表匯入
              </button>
              <button
                onClick={() => setShowForm(true)}
                className="text-sm font-medium text-white bg-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-800 active:bg-amber-900"
              >
                ＋ 新增
              </button>
            </div>
          ) : (
            <div className="w-12" />
          )}
        </div>
      </header>

      {!user?.classId && (
        <div className="max-w-screen-sm mx-auto px-4 pt-4">
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            尚未設定所屬班級，請聯絡管理員。
          </p>
        </div>
      )}

      <main className="max-w-screen-sm mx-auto px-4 pt-5 pb-20">
        {loading ? (
          <p className="text-center text-gray-400 text-sm py-16">載入中...</p>
        ) : members.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-5xl mb-4">👥</p>
            <p className="text-gray-500 font-medium">尚無班員</p>
            <p className="text-gray-400 text-sm mt-1">點右上角「＋ 新增」開始建立</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-3 px-1">
              共 {members.length} 位班員・長按可移除出班
            </p>
            <ul className="flex flex-col gap-3">
              {members.map(member => (
                <li key={member.id}>
                  <button
                    onClick={() => handleCardClick(member)}
                    onPointerDown={() => startPress(member)}
                    onPointerUp={endPress}
                    onPointerLeave={endPress}
                    onPointerCancel={endPress}
                    className="w-full text-left bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-4 hover:bg-amber-50 active:scale-[0.98] transition-all select-none"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-gray-800">{member.name}</span>
                      <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full shrink-0">
                        {member.initialAttendanceCount} 堂
                      </span>
                    </div>
                    {regionLabel(member) && (
                      <p className="text-xs text-gray-500 mt-1.5">{regionLabel(member)}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      {/* 新增表單 */}
      {showForm && user && (
        <MemberForm
          classId={user.classId}
          iccfClassCode={iccfClassCode}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load() }}
        />
      )}

      {/* 試算表匯入 */}
      {showImport && user?.classId && (
        <SheetsImportModal
          classId={user.classId}
          userId={user.uid}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load() }}
        />
      )}

      {/* 移除對話框 */}
      {removeTarget && user && (
        <RemoveDialog
          member={removeTarget}
          classId={user.classId}
          removedBy={user.uid}
          onCancel={() => setRemoveTarget(null)}
          onRemoved={() => { setRemoveTarget(null); load() }}
        />
      )}
    </div>
  )
}
