import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// ─── Tab 定義 ─────────────────────────────────────────────

interface Tab {
  to: string
  label: string
}

const TABS: Tab[] = [
  { to: '/attendance', label: '點名' },
  { to: '/weekly',     label: '本週' },
  { to: '/members',    label: '班員' },
  { to: '/stats',      label: '統計' },
]

const ADMIN_TAB: Tab = { to: '/admin', label: '總覽' }

// ─── 元件 ─────────────────────────────────────────────────

export default function BottomNav() {
  const { user } = useAuth()
  const { pathname } = useLocation()

  const tabs = (user?.role === 'head_leader' || user?.role === 'class_master')
    ? [...TABS, ADMIN_TAB]
    : [...TABS]

  /** 使用 prefix 比對，讓 /members/:id 也會點亮「班員」Tab */
  function isActive(to: string): boolean {
    return pathname === to || pathname.startsWith(to + '/')
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 bg-cream border-t border-hairline"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-screen-sm mx-auto flex h-14">
        {tabs.map(tab => {
          const active = isActive(tab.to)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`flex-1 flex items-center justify-center transition-colors select-none
                ${active ? 'text-ink font-semibold' : 'text-muted font-normal'}`}
            >
              <span className="text-sm">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
