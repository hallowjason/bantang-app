import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getAllUsers,
  getAllClasses,
  createClass,
  updateUserProfile,
  updateClassName,
  updateClassSheetConfig,
} from '../lib/api/admin'
import {
  iccfGetCurrentSessions,
  iccfLogout,
} from '../lib/api/iccfSession'
import type { IccfSessionInfo, IccfLoginResult } from '../lib/api/iccfSession'
import IccfLoginModal from '../components/IccfLoginModal'
import type { AppUser, Class, UserRole } from '../types'

// ─── Tab 定義 ─────────────────────────────────────────────

type Tab = 'classes' | 'users' | 'iccf'

// ─── 角色標籤 ────────────────────────────────────────────

const ROLE_LABEL: Record<UserRole, string> = {
  class_master:  '主班',
  head_leader:   '大領班',
  leader:        '領班',
  junior_leader: '小班長',
  member:        '班員',
}

// ─── 班級管理 Tab ─────────────────────────────────────────

function ClassesTab({ classes, onRefresh }: { classes: Class[]; onRefresh: () => void }) {
  const [newName, setNewName]   = useState('')
  const [creating, setCreating] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTabName, setEditTabName]       = useState('')
  const [editClassLabel, setEditClassLabel] = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) { setError('請輸入班級名稱'); return }
    setCreating(true); setError(null)
    try {
      await createClass(name)
      setNewName('')
      onRefresh()
    } catch {
      setError('建立失敗，請再試一次')
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (cls: Class) => {
    setEditId(cls.id)
    setEditName(cls.name)
    setEditTabName(cls.sheetTabName ?? '')
    setEditClassLabel(cls.sheetClassLabel ?? '')
  }

  const handleSave = async (classId: string) => {
    const name = editName.trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      await updateClassName(classId, name)
      await updateClassSheetConfig(classId, editTabName, editClassLabel)
      setEditId(null)
      onRefresh()
    } catch {
      setError('儲存失敗，請再試一次')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 新增班級 */}
      <div className="bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-4 flex flex-col gap-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">新增班級</p>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="班級名稱（例：光明禮行班）"
            className="flex-1 border border-amber-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2.5 rounded-xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 disabled:opacity-60"
          >
            {creating ? '...' : '建立'}
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {/* 班級列表 */}
      <div className="flex flex-col gap-2">
        {classes.length === 0 ? (
          <div className="bg-white rounded-2xl border border-amber-100 py-10 text-center">
            <p className="text-gray-400 text-sm">尚無班級，請先建立</p>
          </div>
        ) : (
          classes.map(cls => (
            <div
              key={cls.id}
              className="bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-4 flex flex-col gap-3"
            >
              {editId === cls.id ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400">班級名稱</label>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      autoFocus
                      className="border border-amber-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex flex-col gap-2.5">
                    <p className="text-xs font-medium text-amber-700">📊 課表設定</p>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-gray-500">分頁名稱<span className="text-gray-400 ml-1">（如：2026光明）</span></label>
                      <input
                        value={editTabName}
                        onChange={e => setEditTabName(e.target.value)}
                        placeholder="2026光明"
                        className="border border-amber-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-gray-500">等級班標頭<span className="text-gray-400 ml-1">（如：禮行、義理）</span></label>
                      <input
                        value={editClassLabel}
                        onChange={e => setEditClassLabel(e.target.value)}
                        placeholder="禮行"
                        className="border border-amber-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleSave(cls.id)} disabled={saving}
                      className="flex-1 py-2 rounded-xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 disabled:opacity-60">
                      {saving ? '儲存中...' : '儲存'}
                    </button>
                    <button onClick={() => setEditId(null)}
                      className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{cls.name}</p>
                    {cls.sheetTabName ? (
                      <p className="text-xs text-gray-400 mt-0.5">課表：{cls.sheetTabName}{cls.sheetClassLabel ? ` › ${cls.sheetClassLabel}` : ''}</p>
                    ) : (
                      <p className="text-xs text-amber-500 mt-0.5">⚠ 尚未設定課表分頁</p>
                    )}
                    <p className="text-xs text-gray-300 font-mono mt-0.5 select-all">{cls.id}</p>
                  </div>
                  <button onClick={() => openEdit(cls)}
                    className="text-xs text-amber-700 border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-50 shrink-0">
                    編輯
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── 人員管理 Tab ─────────────────────────────────────────

function UsersTab({ users, classes, onRefresh }: { users: AppUser[]; classes: Class[]; onRefresh: () => void }) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saved, setSaved]       = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')

  const filteredUsers = roleFilter === 'all'
    ? users
    : users.filter(u => u.role === roleFilter)

  const handleUpdate = async (userId: string, field: 'role' | 'classId', value: string) => {
    setSavingId(userId)
    try {
      await updateUserProfile(userId, { [field]: value })
      setSaved(userId)
      setTimeout(() => setSaved(null), 1500)
      onRefresh()
    } finally {
      setSavingId(null)
    }
  }

  const roleBadgeColor = (role: UserRole) => {
    if (role === 'class_master')  return 'bg-red-100 text-red-700'
    if (role === 'head_leader')   return 'bg-amber-100 text-amber-700'
    if (role === 'leader')        return 'bg-orange-100 text-orange-700'
    if (role === 'junior_leader') return 'bg-sky-100 text-sky-700'
    return 'bg-gray-100 text-gray-500'
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3">
        <p className="text-xs text-amber-700 font-medium">💡 第一次設定流程</p>
        <p className="text-xs text-amber-600 mt-1">
          1. 先在「班級管理」建立班別<br />
          2. 回到此頁，為每位領班選擇角色與班別<br />
          3. 領班下次登入即可正常使用點名功能
        </p>
      </div>

      {/* 角色篩選 */}
      <div className="flex gap-1.5 flex-wrap">
        {([['all', '全部'], ['class_master', '主班'], ['head_leader', '大領班'], ['leader', '領班'], ['junior_leader', '小班長'], ['member', '班員']] as const).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setRoleFilter(val)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors
              ${roleFilter === val
                ? 'bg-amber-700 text-white border-amber-700'
                : 'bg-white text-gray-600 border-amber-200 hover:bg-amber-50'}`}
          >
            {label}{val !== 'all' && ` (${users.filter(u => u.role === val).length})`}
          </button>
        ))}
      </div>

      {filteredUsers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-amber-100 py-10 text-center">
          <p className="text-gray-400 text-sm">{users.length === 0 ? '尚無使用者登入過' : '此角色無使用者'}</p>
        </div>
      ) : (
        filteredUsers.map(u => (
          <div key={u.uid}
            className={`bg-white rounded-2xl shadow-sm border px-5 py-4 flex flex-col gap-3 transition-colors
              ${saved === u.uid ? 'border-green-300' : 'border-amber-100'}`}>
            <div className="flex items-center gap-3">
              {u.photoURL && <img src={u.photoURL} alt={u.name} className="w-9 h-9 rounded-full shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{u.name || '（無姓名）'}</p>
                <p className="text-xs text-gray-400 truncate">{u.email ?? '—'}</p>
              </div>
              {saved === u.uid && <span className="text-xs font-medium text-green-600 shrink-0">✓ 已儲存</span>}
              {savingId === u.uid && <span className="text-xs text-gray-400 shrink-0">儲存中...</span>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">角色</label>
                <select value={u.role} disabled={savingId === u.uid}
                  onChange={e => handleUpdate(u.uid, 'role', e.target.value)}
                  className="border border-amber-200 rounded-xl px-2.5 py-2 text-sm text-gray-800 bg-amber-50 focus:outline-none">
                  <option value="class_master">主班</option>
                  <option value="head_leader">大領班</option>
                  <option value="leader">領班</option>
                  <option value="junior_leader">小班長</option>
                  <option value="member">班員</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">所屬班別</label>
                <select
                  value={u.classId}
                  disabled={savingId === u.uid || u.role === 'member'}
                  onChange={e => handleUpdate(u.uid, 'classId', e.target.value)}
                  className="border border-amber-200 rounded-xl px-2.5 py-2 text-sm text-gray-800 bg-amber-50 focus:outline-none disabled:opacity-50">
                  <option value="">— 未分班 —</option>
                  {classes.map(cls => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleBadgeColor(u.role)}`}>
                {ROLE_LABEL[u.role]}
              </span>
              {u.role !== 'member' && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                  ${u.classId ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-400'}`}>
                  {u.classId ? (classes.find(c => c.id === u.classId)?.name ?? u.classId) : '未分班'}
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ─── iccf Session Tab ─────────────────────────────────────

function IccfTab() {
  const [sessions, setSessions] = useState<IccfSessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showLogin, setShowLogin] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await iccfGetCurrentSessions()
      setSessions(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleLoginSuccess = (result: IccfLoginResult) => {
    setShowLogin(false)
    setSessions(prev => [
      ...prev.filter(s => s.iccfAccount !== result.sessionId),
      {
        sessionId: result.sessionId,
        iccfAccount: '（剛登入）',
        profile: result.profile,
        classes: result.classes,
        lastUsedAt: new Date().toISOString(),
        expiresAt: result.expiresAt,
      },
    ])
    load()
  }

  const handleLogout = async (sessionId: string) => {
    try {
      await iccfLogout(sessionId)
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const formatExpiry = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4">
        <p className="text-xs font-semibold text-blue-700 mb-1">關於 iccf 同步</p>
        <p className="text-xs text-blue-600 leading-relaxed">
          登入後，伺服器保留 iccf cookie（30 分鐘閒置失效）。<br />
          密碼不會儲存。可同時存在多位領班的 session。
        </p>
      </div>

      <button
        onClick={() => setShowLogin(true)}
        className="w-full py-3 rounded-2xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800"
      >
        + 登入 iccf 帳號
      </button>

      {error && (
        <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-6">載入中...</p>
      ) : sessions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-amber-100 py-10 text-center">
          <p className="text-gray-400 text-sm">目前無有效 iccf session</p>
        </div>
      ) : (
        sessions.map(s => (
          <div key={s.sessionId} className="bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {s.profile?.name ?? s.iccfAccount}
                </p>
                {s.profile?.area && (
                  <p className="text-xs text-gray-400">{s.profile.area}</p>
                )}
                <p className="text-xs text-gray-300 mt-0.5">到期：{formatExpiry(s.expiresAt)}</p>
              </div>
              <button
                onClick={() => handleLogout(s.sessionId)}
                className="text-xs text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 shrink-0"
              >
                登出
              </button>
            </div>
            {s.classes.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {s.classes.map(c => (
                  <span key={c.classCode} className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full">
                    {c.classCode}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))
      )}

      {showLogin && (
        <IccfLoginModal
          onSuccess={handleLoginSuccess}
          onCancel={() => setShowLogin(false)}
        />
      )}
    </div>
  )
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function Admin() {
  const { user } = useAuth()

  const [tab, setTab]         = useState<Tab>('classes')
  const [users, setUsers]     = useState<AppUser[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)

  // 只允許最高管理者（主班 / 大領班）進入
  if (user && user.role !== 'head_leader' && user.role !== 'class_master') {
    return <Navigate to="/attendance" replace />
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [u, c] = await Promise.all([getAllUsers(), getAllClasses()])
      setUsers(u)
      setClasses(c)
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => { loadAll() }, [loadAll])

  const TABS: { key: Tab; label: string }[] = [
    { key: 'classes', label: '🏫 班級' },
    { key: 'users',   label: '👤 人員' },
    { key: 'iccf',    label: '🔗 iccf' },
  ]

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-white border-b border-amber-100 sticky top-0 z-10">
        <div className="max-w-screen-sm mx-auto px-4 py-3">
          <h1 className="text-base font-bold text-gray-800">領班管理後台</h1>
          <p className="text-xs text-gray-400 mt-0.5">主班 / 大領班專用</p>
        </div>
        <div className="max-w-screen-sm mx-auto px-4 pb-0 flex border-b border-amber-100">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors
                ${tab === t.key
                  ? 'border-amber-700 text-amber-700'
                  : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-screen-sm mx-auto px-4 pt-4 pb-20">
        {loading ? (
          <div className="flex justify-center py-16">
            <p className="text-gray-400 text-sm">載入中...</p>
          </div>
        ) : tab === 'classes' ? (
          <ClassesTab classes={classes} onRefresh={loadAll} />
        ) : tab === 'users' ? (
          <UsersTab users={users} classes={classes} onRefresh={loadAll} />
        ) : (
          <IccfTab />
        )}
      </main>
    </div>
  )
}
