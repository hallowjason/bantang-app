import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// ─── Portal 底部導覽 ──────────────────────────────────────

const PORTAL_TABS = [
  { to: '/portal/schedule', icon: '📅', label: '課表' },
  { to: '/portal/venues',   icon: '📍', label: '據點' },
  { to: '/portal/events',   icon: '🎉', label: '活動' },
]

function PortalNav() {
  const { pathname } = useLocation()
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-sky-100"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-screen-sm mx-auto flex h-16">
        {PORTAL_TABS.map(tab => {
          const active = pathname === tab.to || pathname.startsWith(tab.to + '/')
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors select-none
                ${active ? 'text-sky-600' : 'text-gray-400'}`}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className={`text-[11px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

// ─── Portal 頂部標題列 ────────────────────────────────────

function PortalHeader() {
  const { user, signOut } = useAuth()

  // 班員側使用者（member 或 junior_leader）
  const isMemberSide = user && (user.role === 'member' || user.role === 'junior_leader')
  // 領班側使用者（leader, head_leader, class_master）
  const isLeaderSide = user && !isMemberSide

  return (
    <header className="fixed top-0 left-0 right-0 z-10 bg-white border-b border-sky-100 shadow-sm">
      <div className="max-w-screen-sm mx-auto px-4 h-12 flex items-center justify-between">
        <span className="text-sm font-bold text-sky-700">🏛 班員入口</span>
        <div className="flex items-center gap-2">
          {isMemberSide ? (
            <>
              <span className="text-xs text-gray-500">
                Hi, {user!.name}
                {user!.role === 'junior_leader' && (
                  <span className="ml-1 text-sky-600">（小班長）</span>
                )}
              </span>
              {/* 小班長可快速跳轉到班員後台 */}
              {user!.role === 'junior_leader' && (
                <Link
                  to="/portal-admin"
                  className="text-xs text-sky-600 border border-sky-200 rounded-lg px-2 py-0.5 hover:bg-sky-50 transition-colors"
                >
                  後台
                </Link>
              )}
              <button
                onClick={() => signOut().catch(console.error)}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                登出
              </button>
            </>
          ) : isLeaderSide ? (
            // leader / head_leader / class_master 已登入：顯示返回領班系統連結
            <Link
              to="/attendance"
              className="text-xs text-amber-600 hover:text-amber-800 underline transition-colors"
            >
              ← 領班系統
            </Link>
          ) : (
            // 未登入：連結到班員登入頁
            <Link
              to="/portal/login"
              className="text-xs text-sky-600 hover:text-sky-800 border border-sky-200 rounded-lg px-2.5 py-1 transition-colors"
            >
              Google 登入
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}

// ─── Portal Layout ────────────────────────────────────────

export default function PortalLayout() {
  return (
    <div className="min-h-screen bg-sky-50">
      <PortalHeader />
      {/* 頂部留白 48px（header 高度） */}
      <div className="pt-12 pb-24">
        <Outlet />
      </div>
      <PortalNav />
    </div>
  )
}
