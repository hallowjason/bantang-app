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
import type { AppUser, Class } from '../types'

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

    // Discover classes from the 班期 menu; extract both sec_class and class_code (best-effort)
    let classes: Awaited<ReturnType<typeof listClasses>> = []
    try {
      classes = await listClasses(cookieJar)
    } catch {
      // Non-fatal
    }

    // Auto-populate iccfClassCode into the leader's class document so sync works
    // on first login without manual admin setup.
    const classesWithCode = classes.filter(
      (c): c is typeof c & { iccfClassCode: string } => !!c.iccfClassCode,
    )
    if (classesWithCode.length > 0) {
      await backfillIccfClassCode(leaderUid, classesWithCode).catch(() => {
        // Non-fatal: sync will still fail clearly if class doc is missing the code
      })
    }

    const record = await createSession({
      leaderId: leaderUid,
      iccfAccount: account.trim(),
      profile,
      classes,
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
 * After a successful iccf login, write the discovered B-number(s) back to the
 * `classes` collection so sync works without manual admin setup.
 *
 * Strategy:
 *  - Look up the leader's classId from the users collection.
 *  - If exactly one iccf class was discovered → write its iccfClassCode to the
 *    leader's app class (only when not already set or when the value changed).
 *  - If multiple iccf classes were discovered → match each by iccfClassCode
 *    against existing class documents and update any that are missing the code.
 */
async function backfillIccfClassCode(
  leaderUid: string,
  discovered: Array<{ classCode: string; iccfClassCode: string; className: string }>,
): Promise<void> {
  const db = getDB()

  if (discovered.length === 1) {
    // Single class: write to the leader's own app class
    const user = await db.collection<AppUser>('users').findOne({ _id: leaderUid })
    if (!user?.classId) return

    const existing = await db.collection<Class>('classes').findOne({ _id: user.classId })
    if (!existing) return

    if (existing.iccfClassCode === discovered[0].iccfClassCode) return

    await db.collection<Class>('classes').updateOne(
      { _id: user.classId },
      { $set: { iccfClassCode: discovered[0].iccfClassCode } },
    )
    return
  }

  // Multiple classes: update any class doc that has a matching iccfClassCode already
  // set (keep it fresh) OR that has no iccfClassCode but name matches.
  for (const entry of discovered) {
    const existing = await db.collection<Class>('classes').findOne({
      iccfClassCode: entry.iccfClassCode,
    })
    if (existing) continue // already correct, nothing to do

    // Try name-based match as a best-effort fallback
    const byName = await db.collection<Class>('classes').findOne({
      name: entry.className,
      iccfClassCode: { $exists: false },
    })
    if (byName) {
      await db.collection<Class>('classes').updateOne(
        { _id: byName._id },
        { $set: { iccfClassCode: entry.iccfClassCode } },
      )
    }
  }
}

export default router
