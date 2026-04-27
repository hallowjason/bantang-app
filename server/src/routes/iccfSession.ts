import { Router, Response } from 'express'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import { login, logout, listClasses } from '../iccf/client'
import {
  createSession,
  deleteSession,
  getSession,
  listSessionsByLeader,
  touchSession,
} from '../iccf/sessionStore'
import { isIccfError } from '../iccf/errors'
import { getDB } from '../db'
import type { AppUser, Class, IccfClassCodeHistoryEntry } from '../types'
import type { IccfClassEntry } from '../iccf/client'
import { pickByNameSubsequence } from '../iccf/matchClassName'

const router = Router()

router.use(requireAuth)

interface LoginBody {
  account?: string
  password?: string
}

/**
 * POST /api/iccf/session
 * Body: { account, password }
 * Logs into iccf, creates server-side session. Never stores password.
 */
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { account, password } = (req.body ?? {}) as LoginBody
  const leaderUid = (req.user as { uid?: string } | undefined)?.uid ?? req.user?._id

  if (!leaderUid) {
    res.status(401).json({ success: false, error: 'Unauthenticated' })
    return
  }
  if (!account?.trim() || !password?.trim()) {
    res.status(400).json({ success: false, error: '帳號與密碼必填' })
    return
  }

  try {
    const { cookieJar, profile, forceKicked } = await login(account.trim(), password)

    // Discover classes from the 班期 menu; parser now returns BOTH active and
    // ended rows with a status field (best-effort — errors leave list empty).
    let discovered: Awaited<ReturnType<typeof listClasses>> = []
    try {
      discovered = await listClasses(cookieJar)
    } catch {
      // Non-fatal
    }

    // Auto-populate iccfClassCode into the leader's class document so sync works
    // on first login without manual admin setup — and also detect annual
    // renewal when the existing code maps to a discovered 已結班 entry.
    const discoveredWithCode = discovered.filter(
      (c): c is IccfClassEntry & { iccfClassCode: string } => !!c.iccfClassCode,
    )
    if (discoveredWithCode.length > 0) {
      await backfillIccfClassCode(leaderUid, discoveredWithCode).catch(() => {
        // Non-fatal: sync will still fail clearly if class doc is missing the code
      })
    }

    // Session should expose only ACTIVE classes to the UI / sync worker so
    // 已結班 entries don't surface as selectable targets.
    const activeClasses = discovered.filter((c) => c.status === 'active')

    const record = await createSession({
      leaderId: leaderUid,
      iccfAccount: account.trim(),
      profile,
      classes: activeClasses,
      cookieJar,
    })

    res.json({
      success: true,
      data: {
        sessionId: record.sessionId,
        profile: record.profile,
        classes: record.classes,
        forceKicked,
        expiresAt: record.expiresAt,
      },
    })
  } catch (err) {
    if (isIccfError(err)) {
      res.status(err.code === 'invalid_credentials' ? 401 : 502).json({
        success: false,
        error: err.message,
        code: err.code,
      })
      return
    }
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

/**
 * GET /api/iccf/session/current
 * Returns the caller's active sessions (usually 0 or 1).
 */
router.get('/current', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const leaderUid = (req.user as { uid?: string } | undefined)?.uid ?? req.user?._id
  if (!leaderUid) {
    res.status(401).json({ success: false, error: 'Unauthenticated' })
    return
  }

  const sessions = await listSessionsByLeader(leaderUid)
  res.json({
    success: true,
    data: sessions.map((s) => ({
      sessionId: s.sessionId,
      iccfAccount: s.iccfAccount,
      profile: s.profile,
      classes: s.classes,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
    })),
  })
})

/**
 * DELETE /api/iccf/session/:sessionId
 * Logs out of iccf and removes session.
 */
router.delete('/:sessionId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sessionId = req.params['sessionId'] as string
  const leaderUid = (req.user as { uid?: string } | undefined)?.uid ?? req.user?._id

  const session = await getSession(sessionId)
  if (!session) {
    res.json({ success: true })
    return
  }
  if (session.leaderId !== leaderUid) {
    res.status(403).json({ success: false, error: 'Not your session' })
    return
  }

  await logout(session.cookieJar)
  await deleteSession(sessionId)
  res.json({ success: true })
})

/** POST /api/iccf/session/:sessionId/touch — extend TTL (heartbeat). */
router.post('/:sessionId/touch', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sessionId = req.params['sessionId'] as string
  const leaderUid = (req.user as { uid?: string } | undefined)?.uid ?? req.user?._id

  const session = await getSession(sessionId)
  if (!session) {
    res.status(404).json({ success: false, error: 'Session not found' })
    return
  }
  if (session.leaderId !== leaderUid) {
    res.status(403).json({ success: false, error: 'Not your session' })
    return
  }

  await touchSession(sessionId)
  res.json({ success: true, data: { expiresAt: session.expiresAt } })
})

/**
 * After a successful iccf login, write the discovered B-number back to the
 * leader's class document.
 *
 * Write policy (preserves the admin-only 編輯 iccfClassCode rule AND enables
 * annual renewal auto-swap, AND supports leaders managing multiple iccf
 * active classes):
 *
 *  1. Existing iccfClassCode is empty:
 *     a. iccf 恰好 1 個 active → 寫入 (reason: 'backfill')
 *     b. iccf 多個 active → 用 app class.name 字元 subsequence 比對每個 active
 *        的 className，命中恰好 1 個 → 寫入 (reason: 'backfill_name_match')。
 *        命中 0 或 ≥2 個 → no-op (避免誤寫)。
 *
 *  2. Existing iccfClassCode is NON-empty AND matches a discovered 已結班 /
 *     聯班結業 entry (annual renewal):
 *     a. iccf 恰好 1 個 active 且 B-number 不同 → 換班 (reason: 'annual_renewal')
 *     b. iccf 多個 active → name subsequence 篩到唯一一個 active 才換
 *        (reason: 'annual_renewal_name_match')
 *
 *     Safety: 已結班 / 聯班結業 labels are server-side controlled by iccf —
 *     a malicious leader cannot forge them. Even when name match picks a
 *     replacement, the precondition (current maps to an ended entry from
 *     the same iccf account) prevents arbitrary overwrites of an
 *     unrelated active class.
 *
 *  3. Otherwise → no-op. Admin manual edits via /admin remain the only path.
 *
 * All automatic writes append an audit entry to `iccfClassCodeHistory`.
 * `*_name_match` entries also snapshot the matched iccf className.
 */
export async function backfillIccfClassCode(
  leaderUid: string,
  discovered: Array<IccfClassEntry & { iccfClassCode: string }>,
): Promise<void> {
  const db = getDB()

  const user = await db.collection<AppUser>('users').findOne({ _id: leaderUid })
  if (!user?.classId) return

  const existing = await db.collection<Class>('classes').findOne({ _id: user.classId })
  if (!existing) return

  const current = (existing.iccfClassCode ?? '').trim()
  const appName = (existing.name ?? '').trim()
  const active = discovered.filter((d) => d.status === 'active')
  const ended = discovered.filter(
    (d) => d.status === 'ended' || d.status === 'joint_ended',
  )

  // Case 1: empty.
  if (!current) {
    if (active.length === 1) {
      await writeIccfClassCode(
        db, existing._id, '', active[0].iccfClassCode, leaderUid, 'backfill',
      )
      return
    }
    if (active.length > 1 && appName) {
      const matched = pickByNameSubsequence(appName, active)
      if (matched.length === 1) {
        await writeIccfClassCode(
          db, existing._id, '', matched[0].iccfClassCode, leaderUid,
          'backfill_name_match', matched[0].className,
        )
      }
    }
    return
  }

  // Case 2: renewal — current maps to an ended entry.
  const currentIsEnded = ended.some((e) => e.iccfClassCode === current)
  if (!currentIsEnded) return

  if (active.length === 1 && active[0].iccfClassCode !== current) {
    await writeIccfClassCode(
      db, existing._id, current, active[0].iccfClassCode, leaderUid, 'annual_renewal',
    )
    return
  }
  if (active.length > 1 && appName) {
    const matched = pickByNameSubsequence(appName, active)
    if (matched.length === 1 && matched[0].iccfClassCode !== current) {
      await writeIccfClassCode(
        db, existing._id, current, matched[0].iccfClassCode, leaderUid,
        'annual_renewal_name_match', matched[0].className,
      )
    }
  }
}

async function writeIccfClassCode(
  db: ReturnType<typeof getDB>,
  classId: string,
  from: string,
  to: string,
  byLeaderUid: string,
  reason: IccfClassCodeHistoryEntry['reason'],
  matchedClassName?: string,
): Promise<void> {
  const entry: IccfClassCodeHistoryEntry = {
    from,
    to,
    at: new Date().toISOString(),
    byLeaderUid,
    reason,
    ...(matchedClassName ? { matchedClassName } : {}),
  }
  await db.collection<Class>('classes').updateOne(
    { _id: classId },
    {
      $set: { iccfClassCode: to },
      $push: { iccfClassCodeHistory: entry },
    },
  )
}

export default router
