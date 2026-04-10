import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface QuickLink {
  to: string
  icon: string
  label: string
  description: string
}

const quickLinks: QuickLink[] = [
  { to: '/attendance', icon: '✅', label: '本週點名', description: '記錄班員出席' },
  { to: '/weekly', icon: '📋', label: '每週任務', description: '講師邀請與主持輪值' },
  { to: '/members', icon: '👥', label: '班員管理', description: '查看與編輯班員資料' },
  { to: '/report', icon: '📊', label: '出席報表', description: '產生本週摘要並複製' },
]

export default function Dashboard() {
  const { user, signOut } = useAuth()

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <div className="min-h-screen bg-amber-50">
      {/* 頂部導覽列 */}
      <header className="bg-white border-b border-amber-100 sticky top-0 z-10">
        <div className="max-w-screen-sm mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-base font-bold text-amber-800">佛堂進階班</h1>
          <div className="flex items-center gap-3">
            {user?.photoURL && (
              <img
                src={user.photoURL}
                alt={user.name}
                className="w-8 h-8 rounded-full"
              />
            )}
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-sm mx-auto px-4 py-6 flex flex-col gap-5">
        {/* 歡迎卡片 */}
        <div className="bg-white rounded-2xl shadow-sm border border-amber-100 p-5">
          <p className="text-sm text-gray-500">歡迎回來</p>
          <h2 className="text-lg font-semibold text-gray-800 mt-0.5">
            {user?.name || user?.email || '使用者'} 👋
          </h2>
          {user?.role === 'head_leader' && (
            <span className="inline-block mt-2 text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              大領班
            </span>
          )}
        </div>

        {/* 快速入口 */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
            快速入口
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {quickLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="bg-white rounded-2xl shadow-sm border border-amber-100 p-4 flex flex-col gap-2 hover:bg-amber-50 active:scale-95 transition-all"
              >
                <span className="text-2xl">{link.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{link.label}</p>
                  <p className="text-xs text-gray-400">{link.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* 大領班專區 */}
        {user?.role === 'head_leader' && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
              管理員功能
            </h3>
            <Link
              to="/admin"
              className="block bg-amber-700 text-white rounded-2xl p-4 shadow-sm hover:bg-amber-800 active:scale-95 transition-all"
            >
              <p className="text-sm font-semibold">🏛 所有班級總覽</p>
              <p className="text-xs text-amber-200 mt-0.5">查看全部班別出席狀況</p>
            </Link>
          </section>
        )}
      </main>
    </div>
  )
}
