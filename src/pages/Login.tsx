import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleGoogleSignIn = async () => {
    setError(null)
    setLoading(true)
    try {
      await signInWithGoogle()
      navigate('/attendance')
    } catch (err) {
      setError('登入失敗，請再試一次。')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm card-lovable flex flex-col items-center gap-6 py-10">
        {/* 標題 */}
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink tracking-tight">SJJB</h1>
          <p className="text-sm text-muted text-center">
            出席管理平台
          </p>
        </div>

        {/* 錯誤訊息 */}
        {error && (
          <p className="w-full text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-2 text-center">
            {error}
          </p>
        )}

        {/* Google 登入按鈕 */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="btn-ghost w-full py-3"
        >
          {/* Google SVG Icon */}
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96l3.007 2.332C4.672 5.163 6.656 3.58 9 3.58z"
            />
          </svg>
          {loading ? '登入中...' : '使用 Google 帳號登入'}
        </button>

        <p className="text-xs text-muted text-center">
          僅限受邀領班使用
        </p>

        {/* 初始設定入口 */}
        <p className="text-xs text-muted text-center">
          首次使用？
          <Link to="/setup" className="text-ink underline ml-1">
            點此進行初始設定
          </Link>
        </p>
      </div>
    </div>
  )
}
