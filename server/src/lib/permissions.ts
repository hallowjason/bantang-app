import type { AppUser } from '../types'

/**
 * Top admin = 主班 or 任何帶有 isAdmin 標籤的領班。
 * 可操作所有班級、編輯全域設定、管理角色指派。
 */
export function isTopAdmin(user: Pick<AppUser, 'role' | 'isAdmin'> | null | undefined): boolean {
  if (!user) return false
  return user.role === 'class_master' || user.isAdmin === true
}

/**
 * Portal admin = 主班 / 管理員 / 小班長。
 * 可進入班員入口後台。
 */
export function isPortalAdmin(user: Pick<AppUser, 'role' | 'isAdmin'> | null | undefined): boolean {
  if (!user) return false
  return isTopAdmin(user) || user.role === 'junior_leader'
}
