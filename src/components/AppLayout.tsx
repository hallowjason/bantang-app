import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

/**
 * 所有需要登入的頁面共用 Layout：
 * - 渲染子路由內容（<Outlet />）
 * - 固定顯示底部導覽列
 */
export default function AppLayout() {
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  )
}
