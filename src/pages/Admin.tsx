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
  updateClassIccfCode,
} from '../lib/api/admin'
import {
  iccfGetCurrentSessions,
  iccfLogout,
} from '../lib/api/iccfSession'
import type { IccfSessionInfo, IccfLoginResult } from '../lib/api/iccfSession'
import IccfLoginModal from '../components/IccfLoginModal'
import { isTopAdmin } from '../lib/auth/permissions'
import type { AppUser, Class, UserRole } from '../types'

// ─── Tab 定義 ─────────────────────────────────────────────

type Tab = 'classes' | 'users' | 'iccf'

// ─── 角色標籤 ────────────────────────────────────────────

const ROLE_LABEL: Record<UserRole, string> = {
  class_master:  '主班',
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
  const [editIccfCode, setEditIccfCode]     = useState('')
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
    setEditIccfCode(cls.iccfClassCode ?? '')
  }

  const handleSave = async (classId: string) => {
    const name = editName.trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      await updateClassName(classId, name)
      await updateClassSheetConfig(classId, editTabName, editClassLabel)
      await updateClassIccfCode(classId, editIccfCode)
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
      <div className="card-lovable flex flex-col gap-3">
        <p className="text-xs font-semibold text-muted uppercase tracking-wider">新增班級</p>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="班級名稱（例：光明禮行班）"
            className="input-lovable flex-1"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="btn-primary px-4 py-2.5 disabled:opacity-60"
          >
            {creating ? '...' : '建立'}
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {/* 班級列表 */}
      <div className="flex flex-col gap-2">
        {classes.length === 0 ? (
          <div className="card-lovable py-10 text-center">
            <p className="text-muted text-sm">尚無班級，請先建立</p>
          </div>
        ) : (
          classes.map(cls => (
            <div
              key={cls.id}
              className="card-lovable flex flex-col gap-3"
            >
              {editId === cls.id ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted">班級名稱</label>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      autoFocus
                      className="input-lovable"
                    />
                  </div>
                  <div className="card-lovable-compact flex flex-col gap-2.5">
                    <p className="text-xs font-medium text-ink">課表設定</p>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted">分頁名稱<span className="text-muted ml-1">（如：2026光明）</span></label>
                      <input
                        value={editTabName}
                        onChange={e => setEditTabName(e.target.value)}
                        placeholder="2026光明"
                        className="input-lovable text-sm px-2.5 py-1.5"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted">等級班標頭<span className="text-muted ml-1">（如：禮行、義理）</span></label>
                      <input
                        value={editClassLabel}
                        onChange={e => setEditClassLabel(e.target.value)}
                        placeholder="禮行"
                        className="input-lovable text-sm px-2.5 py-1.5"
                      />
                    </div>
                  </div>
                  <div className="card-lovable-compact flex flex-col gap-2.5">
                    <p className="text-xs font-medium text-ink">iccf 同步設定</p>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted">iccf 班別編號<span className="text-muted ml-1">（登入 iccf → 班期 → 班務，找班別編號欄，如：B3000549）</span></label>
                      <input
                        value={editIccfCode}
                        onChange={e => setEditIccfCode(e.target.value.toUpperCase())}
                        placeholder="B3000549"
                        className="input-lovable text-sm px-2.5 py-1.5 font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleSave(cls.id)} disabled={saving}
                      className="btn-primary flex-1 py-2 disabled:opacity-60">
                      {saving ? '儲存中...' : '儲存'}
                    </button>
                    <button onClick={() => setEditId(null)}
                      className="btn-ghost px-4 py-2">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink">{cls.name}</p>
                    {cls.sheetTabName ? (
                      <p className="text-xs text-muted mt-0.5">課表：{cls.sheetTabName}{cls.sheetClassLabel ? ` › ${cls.sheetClassLabel}` : ''}</p>
                    ) : (
                      <p className="text-xs text-amber-500 mt-0.5">尚未設定課表分頁</p>
                    )}
                    {cls.iccfClassCode ? (
                      <p className="text-xs text-muted mt-0.5 font-mono">iccf: {cls.iccfClassCode}</p>
                    ) : (
                      <p className="text-xs text-muted mt-0.5">iccf: 未設定</p>
                    )}
                    <p className="text-xs text-muted font-mono mt-0.5 select-all">{cls.id}</p>
                  </div>
                  <button onClick={() => openEdit(cls)}
                    className="btn-ghost text-xs px-3 py-1.5 shrink-0">
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
    if (role === 'class_master')  return 'text-red-700'
    if (role === 'leader')        return 'text-orange-700'
    if (role === 'junior_leader') return 'text-sky-700'
    return 'text-muted'
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card-lovable-compact">
        <p className="text-xs text-ink font-medium">第一次設定流程</p>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          1. 先在「班級管理」建立班別<br />
          2. 回到此頁，為每位領班選擇角色與班別<br />
          3. 領班下次登入即可正常使用點名功能
        </p>
      </div>

      {/* 角色篩選 */}
      <div className="flex gap-1.5 flex-wrap">
        {([['all', '全部'], ['class_master', '主班'], ['leader', '領班'], ['junior_leader', '小班長'], ['member', '班員']] as const).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setRoleFilter(val)}
            className={roleFilter === val
              ? 'btn-primary text-xs px-3 py-1 rounded-full'
              : 'btn-ghost text-xs px-3 py-1 rounded-full'}
          >
            {label}{val !== 'all' && ` (${users.filter(u => u.role === val).length})`}
          </button>
        ))}
      </div>

      {filteredUsers.length === 0 ? (
        <div className="card-lovable py-10 text-center">
          <p className="text-muted text-sm">{users.length === 0 ? '尚無使用者登入過' : '此角色無使用者'}</p>
        </div>
      ) : (
        filteredUsers.map(u => (
          <div key={u.uid}
            className={`card-lovable flex flex-col gap-3 transition-colors
              ${saved === u.uid ? 'ring-1 ring-green-300' : ''}`}>
            <div className="flex items-center gap-3">
              {u.photoURL && <img src={u.photoURL} alt={u.name} className="w-9 h-9 rounded-full shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{u.name || '（無姓名）'}</p>
                <p className="text-xs text-muted truncate">{u.email ?? '—'}</p>
              </div>
              {saved === u.uid && <span className="text-xs font-medium text-green-600 shrink-0">✓ 已儲存</span>}
              {savingId === u.uid && <span className="text-xs text-muted shrink-0">儲存中...</span>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted">角色</label>
                <select value={u.role} disabled={savingId === u.uid}
                  onChange={e => handleUpdate(u.uid, 'role', e.target.value)}
                  className="input-lovable text-sm px-2.5 py-2">
                  <option value="class_master">主班</option>
                  <option value="leader">領班</option>
                  <option value="junior_leader">小班長</option>
                  <option value="member">班員</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted">所屬班別</label>
                <select
                  value={u.classId}
                  disabled={savingId === u.uid || u.role === 'member'}
                  onChange={e => handleUpdate(u.uid, 'classId', e.target.value)}
                  className="input-lovable text-sm px-2.5 py-2 disabled:opacity-50">
                  <option value="">— 未分班 —</option>
                  {classes.map(cls => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <span className={`badge-lovable text-xs font-medium ${roleBadgeColor(u.role)}`}>
                {ROLE_LABEL[u.role]}
              </span>
              {u.role !== 'member' && (
                <span className={`badge-lovable text-xs font-medium ${u.classId ? 'text-green-600' : 'text-red-400'}`}>
                  <span className={`badge-dot ${u.classId ? 'bg-green-500' : 'bg-red-400'}`} />
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
      <div className="card-lovable-compact">
        <p className="text-xs font-semibold text-ink mb-1">關於 iccf 同步</p>
        <p className="text-xs text-muted leading-relaxed">
          登入後，伺服器保留 iccf cookie（30 分鐘閒置失效）。<br />
          密碼不會儲存。可同時存在多位領班的 session。
        </p>
      </div>

      <button
        onClick={() => setShowLogin(true)}
        className="btn-primary w-full py-3"
      >
        + 登入 iccf 帳號
      </button>

      {error && (
        <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {loading ? (
        <p className="text-center text-sm text-muted py-6">載入中...</p>
      ) : sessions.length === 0 ? (
        <div className="card-lovable py-10 text-center">
          <p className="text-muted text-sm">目前無有效 iccf session</p>
        </div>
      ) : (
        sessions.map(s => (
          <div key={s.sessionId} className="card-lovable flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">
                  {s.profile?.name ?? s.iccfAccount}
                </p>
                {s.profile?.area && (
                  <p className="text-xs text-muted">{s.profile.area}</p>
                )}
                <p className="text-xs text-muted mt-0.5">到期：{formatExpiry(s.expiresAt)}</p>
              </div>
              <button
                onClick={() => handleLogout(s.sessionId)}
                className="btn-ghost text-xs text-red-500 px-3 py-1.5 shrink-0"
              >
                登出
              </button>
            </div>
            {s.classes.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {s.classes.map(c => (
                  <span key={c.classCode} className="badge-lovable text-xs">
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

  // 只允許最高管理者（主班 / 管理員）進入
  if (user && !isTopAdmin(user)) {
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
    { key: 'classes', label: '班級' },
    { key: 'users',   label: '人員' },
    { key: 'iccf',    label: 'iccf' },
  ]

  return (
    <div className="min-h-screen bg-cream">
      <header className="bg-cream border-b border-hairline sticky top-0 z-10">
        <div className="max-w-screen-sm mx-auto px-4 py-3">
          <h1 className="text-base font-semibold text-ink tracking-tight">領班管理後台</h1>
          <p className="text-xs text-muted mt-0.5">主班 / 管理員專用</p>
        </div>
        <div className="max-w-screen-sm mx-auto px-4 pb-0 flex border-b border-hairline">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors
                ${tab === t.key
                  ? 'border-ink text-ink'
                  : 'border-transparent text-muted hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-screen-sm mx-auto px-4 pt-4 pb-20">
        {loading ? (
          <div className="flex justify-center py-16">
            <p className="text-muted text-sm">載入中...</p>
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
