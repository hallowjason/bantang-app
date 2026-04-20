import { getSession, deleteSession, touchSession } from './sessionStore'
import { ping } from './client'
import type { IccfSessionRecord } from './sessionStore'

export type EnsureAliveResult =
  | { ok: true; session: IccfSessionRecord }
  | { ok: false; reason: 'not_found' | 'expired'; message: string }

/**
 * Verify that an iccf session is still valid before using it.
 *
 * Steps:
 *  1. Look up session in store. If missing → not_found.
 *  2. Ping iccf (`header_all5.php`). If ping fails → session on iccf side has
 *     been invalidated (idle too long, kicked elsewhere, server restart).
 *     Delete the local session and report expired.
 *  3. Otherwise touch the TTL and return the live record.
 *
 * Callers should treat `ok: false` as "need re-login" and surface to the UI.
 */
export async function ensureAlive(sessionId: string): Promise<EnsureAliveResult> {
  const session = await getSession(sessionId)
  if (!session) {
    return { ok: false, reason: 'not_found', message: 'iccf session 不存在或已過期，請重新登入' }
  }

  const pingResult = await ping(session.cookieJar)
  if (pingResult === 'unreachable') {
    return { ok: false, reason: 'expired', message: 'iccf 伺服器暫時無法連線，請稍後再試' }
  }
  if (pingResult === 'expired') {
    await deleteSession(sessionId)
    return { ok: false, reason: 'expired', message: 'iccf session 已過期，請重新登入' }
  }

  await touchSession(sessionId)
  return { ok: true, session }
}
