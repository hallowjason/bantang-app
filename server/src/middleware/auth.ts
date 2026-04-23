import { Request, Response, NextFunction } from 'express'
import admin from 'firebase-admin'
import { getDB } from '../db'
import type { AppUser, UserRole } from '../types'
import { isTopAdmin, isPortalAdmin } from '../lib/permissions'

// Initialize Firebase Admin once
let adminInitialized = false

function ensureAdminInitialized() {
  if (adminInitialized) return

  // E2E/dev: Auth Emulator mode needs only projectId; no real credential required.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'bantang-e2e' })
    adminInitialized = true
    return
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON

  if (b64) {
    const json = Buffer.from(b64, 'base64').toString('utf-8')
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) })
  } else if (raw) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
  } else {
    throw new Error('Firebase Admin credentials not configured. Set FIREBASE_SERVICE_ACCOUNT_B64 or FIREBASE_SERVICE_ACCOUNT_JSON')
  }

  adminInitialized = true
}

export interface AuthenticatedRequest extends Request {
  user?: AppUser
}

/**
 * Verifies Firebase ID Token and attaches user from MongoDB to req.user.
 * Creates user document in MongoDB if first login.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ensureAdminInitialized()

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Missing auth token' })
      return
    }

    const token = authHeader.slice(7)
    const decoded = await admin.auth().verifyIdToken(token)
    const uid = decoded.uid

    const db = getDB()
    const usersCol = db.collection<AppUser>('users')
    let userDoc = await usersCol.findOne({ _id: uid })

    if (!userDoc) {
      // First login: create user with default role.
      // intentRole is self-declared by the client; only low-privilege roles
      // are accepted. Elevated privileges (class_master / isAdmin) must be
      // assigned by an existing admin via a separate endpoint — never on
      // first login — to prevent privilege escalation.
      const SELF_ASSIGNABLE_ROLES: readonly UserRole[] = ['leader', 'junior_leader', 'member']
      const rawIntent = (
        (req.headers['x-intent-role'] as string | undefined) ??
        (decoded['intentRole'] as string | undefined)
      )
      const intentRole: UserRole = (SELF_ASSIGNABLE_ROLES as readonly string[]).includes(rawIntent ?? '')
        ? (rawIntent as UserRole)
        : 'leader'
      const newUser: AppUser = {
        _id: uid,
        name: decoded.name ?? '',
        email: decoded.email ?? null,
        photoURL: decoded.picture ?? null,
        role: intentRole,
        classId: '',
      }
      await usersCol.insertOne(newUser)
      userDoc = newUser
    }

    req.user = {
      ...userDoc,
      uid: uid as unknown as string,
    } as unknown as AppUser & { uid: string }

    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' })
  }
}

/**
 * Optional auth: attaches user if token present, but doesn't reject unauthenticated requests.
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    next()
    return
  }
  return requireAuth(req, res, next)
}

/** Middleware to check if user is TopAdmin (class_master or isAdmin === true) */
export function requireTopAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!isTopAdmin(req.user)) {
    res.status(403).json({ success: false, error: 'Requires class_master or admin privileges' })
    return
  }
  next()
}

/** Middleware to check if user is PortalAdmin (TopAdmin or junior_leader) */
export function requirePortalAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!isPortalAdmin(req.user)) {
    res.status(403).json({ success: false, error: 'Requires portal admin role' })
    return
  }
  next()
}
