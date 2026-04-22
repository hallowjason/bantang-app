import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { initializeDefaultData } from './lib/api/settings'
import AppLayout from './components/AppLayout'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Attendance from './pages/Attendance'
import Members from './pages/Members'
import MemberDetail from './pages/MemberDetail'
import Weekly from './pages/Weekly'
import Report from './pages/Report'
import Admin from './pages/Admin'
import Stats from './pages/Stats'
import PortalAdmin from './pages/PortalAdmin'
import PortalLayout from './pages/portal/PortalLayout'
import PortalLogin from './pages/portal/PortalLogin'
import PortalSchedule from './pages/portal/PortalSchedule'
import PortalVenues from './pages/portal/PortalVenues'
import PortalEvents from './pages/portal/PortalEvents'
import PortalEventDetail from './pages/portal/PortalEventDetail'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <p className="text-muted text-sm">載入中...</p>
      </div>
    )
  }

  // member / junior_leader：導向班員入口
  if (user?.role === 'member' || user?.role === 'junior_leader') {
    return <Navigate to="/portal/schedule" replace />
  }

  return user ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  const { user } = useAuth()

  // 登入後初始化 Firestore 預設資料（冪等，安全重複執行）
  useEffect(() => {
    if (user) initializeDefaultData().catch(console.error)
  }, [user?.uid])

  return (
    <Routes>
      {/* 公開路由 */}
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Setup />} />

      {/* 班員入口（公開，不需登入）*/}
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal" element={<PortalLayout />}>
        <Route index element={<Navigate to="/portal/schedule" replace />} />
        <Route path="schedule"    element={<PortalSchedule />} />
        <Route path="venues"      element={<PortalVenues />} />
        <Route path="events"      element={<PortalEvents />} />
        <Route path="events/:id"  element={<PortalEventDetail />} />
      </Route>

      {/* 班員後台（主班 / 大領班 / 小班長）*/}
      <Route path="/portal-admin" element={<PortalAdmin />} />

      {/* 需要登入的路由：共用 AppLayout（含 BottomNav） */}
      <Route element={<PrivateRoute><AppLayout /></PrivateRoute>}>
        <Route path="/attendance"  element={<Attendance />} />
        <Route path="/members"     element={<Members />} />
        <Route path="/members/:id" element={<MemberDetail />} />
        <Route path="/weekly"      element={<Weekly />} />
        <Route path="/report"      element={<Report />} />
        <Route path="/stats"       element={<Stats />} />
        <Route path="/admin"       element={<Admin />} />
      </Route>

      {/* 其他路徑一律導向點名頁 */}
      <Route path="*" element={<Navigate to="/attendance" replace />} />
    </Routes>
  )
}
