import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { checkHeadLeaderExists, updateUserProfile } from '../lib/api/admin'

// ─── 初始設定頁 ───────────────────────────────────────────
//
// 使用情境：
//   首次部署後，第一位使用者前往 /setup，
//   確認系統尚無大領班後，自行設定為大領班並前往 /admin。
//
// 安全說明：
//   • Firestore Rules 允許所有登入者讀 /users，因此可查詢是否有大領班。
//   • 使用者可 updateDoc 自己的 document（已由 rules 允許），
//     但前端在已有大領班時不顯示升級按鈕。
//   • 此頁面是「公開路由」，未登入者也可進入，並引導至 Google 登入。

export default function Setup() {
  const { user, loading, signInWithGoogle, refreshUser } = useAuth()
  const navigate = useNavigate()

  const [checking, setChecking]             = useState(true)
  const [headLeaderExists, setHeadLeaderExists] = useState(false)
  const [promoting, setPromoting]           = useState(false)
  const [done, setDone]                     = useState(false)
  const [loginLoading, setLoginLoading]     = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  // 如果已是大領班，直接跳 admin
  useEffect(() => {
    if (!loading && user?.role === 'head_leader') {
      navigate('/admin', { replace: true })
    }
  }, [loading, user?.role, navigate])

  // 檢查是否已有大領班
  useEffect(() => {
    if (loading) return
    checkHeadLeaderExists()
      .then(exists => {
        setHeadLeaderExists(exists)
        setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [loading])

  const handleGoogleSignIn = async () => {
    setLoginLoading(true)
    setError(null)
    try {
      await signInWithGoogle()
      // onAuthStateChanged 會自動建立 /users/{uid}，
      // useEffect 會重新檢查 head_leader 狀態
    } catch {
      setError('登入失敗，請再試一次')
    } finally {
      setLoginLoading(false)
    }
  }

  const handlePromote = async () => {
    if (!user) return
    setPromoting(true)
    setError(null)
    try {
      await updateUserProfile(user.uid, { role: 'head_leader' })
      await refreshUser?.()
      setDone(true)
      // refreshUser 後 useEffect 會偵測 role = head_leader 並自動跳轉
      // 給 500ms 讓使用者看到成功訊息
      setTimeout(() => navigate('/admin', { replace: true }), 1200)
    } catch {
      setError('操作失敗，請再試一次')
    } finally {
      setPromoting(false)
    }
  }

  // ── 全頁載入中 ──
  if (loading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <p className="text-muted text-sm">載入中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm card-lovable flex flex-col gap-6 py-8">

        {/* 標頭 */}
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-xl font-semibold text-ink tracking-tight">初始設定</h1>
          <p className="text-sm text-muted text-center">首次使用，請設定大領班帳號</p>
        </div>

        {/* 錯誤訊息 */}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-center">
            {error}
          </p>
        )}

        {/* ── 情境 A：系統已有大領班 ── */}
        {headLeaderExists ? (
          <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex flex-col gap-2 text-center">
            <p className="text-sm font-semibold text-green-700">✓ 系統已設定完成</p>
            <p className="text-xs text-green-600">
              大領班帳號已存在。<br />
              請聯絡大領班在後台為您分配班別與角色。
            </p>
            <button
              onClick={() => navigate('/attendance')}
              className="mt-2 text-xs text-ink underline"
            >
              返回點名頁
            </button>
          </div>

        /* ── 情境 B：設定完成動畫 ── */
        ) : done ? (
          <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex flex-col gap-1 text-center">
            <p className="text-sm font-semibold text-green-700">✓ 大領班設定完成！</p>
            <p className="text-xs text-green-600">正在前往管理後台...</p>
          </div>

        /* ── 情境 C：尚未登入 ── */
        ) : !user ? (
          <div className="flex flex-col gap-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-700 font-medium">說明</p>
              <p className="text-xs text-amber-600 mt-1">
                目前系統尚未設定大領班。<br />
                請先以 Google 帳號登入，再將此帳號設為大領班。
              </p>
            </div>
            <button
              onClick={handleGoogleSignIn}
              disabled={loginLoading}
              className="btn-ghost w-full py-3"
            >
              {/* Google SVG */}
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96l3.007 2.332C4.672 5.163 6.656 3.58 9 3.58z"/>
              </svg>
              {loginLoading ? '登入中...' : '使用 Google 帳號登入'}
            </button>
          </div>

        /* ── 情境 D：已登入，可自行升級 ── */
        ) : (
          <div className="flex flex-col gap-4">
            {/* 說明卡 */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-700 font-medium">說明</p>
              <p className="text-xs text-amber-600 mt-1">
                系統目前尚無大領班。點擊下方按鈕，可將您的帳號設為大領班，
                之後即可在管理後台建立班別、指派領班角色。
              </p>
            </div>

            {/* 目前登入帳號預覽 */}
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted">目前登入帳號</p>
              <div className="flex items-center gap-3 card-lovable-compact">
                {user.photoURL && (
                  <img
                    src={user.photoURL}
                    alt={user.name}
                    className="w-9 h-9 rounded-full shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">
                    {user.name || '（無姓名）'}
                  </p>
                  <p className="text-xs text-muted truncate">{user.email}</p>
                </div>
              </div>
            </div>

            {/* 升級按鈕 */}
            <button
              onClick={handlePromote}
              disabled={promoting}
              className="btn-primary w-full py-3"
            >
              {promoting ? '設定中...' : '將此帳號設為大領班'}
            </button>
          </div>
        )}

        {/* 底部：返回登入頁 */}
        <div className="text-center">
          <button
            onClick={() => navigate('/login')}
            className="text-xs text-muted hover:text-ink"
          >
            ← 返回登入頁
          </button>
        </div>
      </div>
    </div>
  )
}
