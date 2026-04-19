import { Router, Response } from 'express'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import { login, logout } from '../iccf/client'
import {
  createSession,
  deleteSession,
  getSession,
  listSessionsByLeader,
  touchSession,
} from '../iccf/sessionStore'
import { IccfError, isIccfError } from '../iccf/errors'

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

    // Phase 1: defer full class discovery to the client after navigating.
    // For now we attach an empty list; Phase 2 will populate from 班期 menu.
    const record = await createSession({
      leaderId: leaderUid,
      iccfAccount: account.trim(),
      profile,
      classes: [],
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

export default router
