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
    <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8 flex flex-col items-center gap-6">
        {/* 標題 */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center text-3xl">
            🏮
          </div>
          <h1 className="text-2xl font-bold text-amber-800">佛堂進階班</h1>
          <p className="text-sm text-gray-500 text-center">
            出席管理平台
          </p>
        </div>

        {/* 錯誤訊息 */}
        {error && (
          <p className="w-full text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-center">
            {error}
          </p>
        )}

        {/* Google 登入按鈕 */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 rounded-lg px-4 py-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

        <p className="text-xs text-gray-400 text-center">
          僅限受邀領班使用
        </p>

        {/* 初始設定入口 */}
        <p className="text-xs text-gray-300 text-center">
          首次使用？
          <Link to="/setup" className="text-amber-600 hover:underline ml-1">
            點此進行初始設定
          </Link>
        </p>
      </div>
    </div>
  )
}
