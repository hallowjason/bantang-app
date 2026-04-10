import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// ─── Tab 定義 ─────────────────────────────────────────────

interface Tab {
  to: string
  icon: string
  label: string
}

const TABS: Tab[] = [
  { to: '/attendance', icon: '📋', label: '點名' },
  { to: '/weekly',     icon: '📅', label: '本週' },
  { to: '/members',    icon: '👥', label: '班員' },
  { to: '/stats',      icon: '📊', label: '統計' },
]

const ADMIN_TAB: Tab = { to: '/admin', icon: '🏛', label: '總覽' }

// ─── 元件 ─────────────────────────────────────────────────

export default function BottomNav() {
  const { user } = useAuth()
  const { pathname } = useLocation()

  const tabs = user?.role === 'head_leader'
    ? [...TABS, ADMIN_TAB]
    : [...TABS]

  /** 使用 prefix 比對，讓 /members/:id 也會點亮「班員」Tab */
  function isActive(to: string): boolean {
    return pathname === to || pathname.startsWith(to + '/')
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-amber-100"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-screen-sm mx-auto flex h-16">
        {tabs.map(tab => {
          const active = isActive(tab.to)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors select-none
                ${active ? 'text-amber-700' : 'text-gray-400'}`}
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
