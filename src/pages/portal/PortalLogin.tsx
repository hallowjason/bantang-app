import { useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// ─── 班員 Google 登入頁 ───────────────────────────────────
//
// 在呼叫 signInWithGoogle() 之前先寫入 intentRole='member'，
// AuthContext 首次建立使用者文件時會讀取此值，將 role 設為 member。

export default function PortalLogin() {
  const { user, loading, signInWithGoogle } = useAuth()
  const navigate = useNavigate()

  // 已登入則自動導回
  useEffect(() => {
    if (!loading && user) {
      navigate('/portal/schedule', { replace: true })
    }
  }, [user, loading, navigate])

  const handleLogin = async () => {
    // 標記本次登入意圖為班員
    localStorage.setItem('intentRole', 'member')
    try {
      await signInWithGoogle()
      // 登入成功後 AuthContext 更新，useEffect 會自動導頁
    } catch (e) {
      console.error('[PortalLogin] 登入失敗：', e)
      localStorage.removeItem('intentRole')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-sky-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">載入中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-sky-50 flex flex-col items-center justify-center px-6">

      {/* Logo / 標題區 */}
      <div className="flex flex-col items-center gap-3 mb-8">
        <div className="text-5xl">🏛</div>
        <h1 className="text-xl font-bold text-sky-700">班員入口</h1>
        <p className="text-sm text-gray-500 text-center max-w-xs">
          以 Google 帳號登入，可在據點頁加入聯絡人、填寫意願時自動帶入姓名。
        </p>
        <p className="text-xs text-gray-400 text-center max-w-xs">
          未登入也可完整瀏覽課表、據點資訊，並填寫活動意願。
        </p>
      </div>

      {/* 登入卡片 */}
      <div className="bg-white rounded-2xl shadow-sm px-6 py-6 w-full max-w-xs flex flex-col gap-4">
        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-2.5 border border-gray-200 rounded-xl py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors font-medium"
        >
          {/* Google icon */}
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <g fill="none" fillRule="evenodd">
              <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </g>
          </svg>
          以 Google 帳號登入
        </button>

        <p className="text-[10px] text-gray-400 text-center leading-relaxed">
          登入即視為同意本系統收集您的 Google 帳號姓名，用於顯示聯絡人資訊。
        </p>
      </div>

      {/* 返回連結 */}
      <Link
        to="/portal/schedule"
        className="mt-6 text-xs text-sky-600 hover:underline"
      >
        ← 不登入，直接進入班員入口
      </Link>
    </div>
  )
}
