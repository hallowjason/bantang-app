import { Router, Response } from 'express'
import { ObjectId } from 'mongodb'
import { getDB } from '../db'
import { requireAuth, requireTopAdmin, AuthenticatedRequest } from '../middleware/auth'
import type { AppUser, Class, UserRole } from '../types'

const router = Router()

// All admin routes require auth
router.use(requireAuth)

// ─── Users ───────────────────────────────────────────────────────────────────

/** GET /api/users/me — Current user profile */
router.get('/users/me', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  res.json({ success: true, data: toUserDto(req.user!) })
})

/** GET /api/admin/users — All users (TopAdmin only) */
router.get('/admin/users', requireTopAdmin, async (_req, res: Response): Promise<void> => {
  const db = getDB()
  const users = await db.collection<AppUser>('users').find().toArray()
  res.json({ success: true, data: users.map(toUserDto) })
})

/** PUT /api/admin/users/:uid — Update user role / classId / isAdmin (TopAdmin only) */
router.put('/admin/users/:uid', requireTopAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { uid } = req.params
  const { role, classId, isAdmin } = req.body as {
    role?: UserRole
    classId?: string
    isAdmin?: boolean
  }

  const update: Partial<AppUser> = {}
  if (role !== undefined) update.role = role
  if (classId !== undefined) update.classId = classId
  if (isAdmin !== undefined) update.isAdmin = isAdmin

  const db = getDB()
  await db.collection<AppUser>('users').updateOne({ _id: uid }, { $set: update })
  res.json({ success: true })
})

/** GET /api/admin/check-top-admin — Does any top admin (class_master or isAdmin) exist? */
router.get('/admin/check-top-admin', async (_req, res: Response): Promise<void> => {
  const db = getDB()
  const found = await db.collection<AppUser>('users').findOne({
    $or: [{ role: 'class_master' }, { isAdmin: true }],
  })
  res.json({ success: true, data: { exists: found !== null } })
})

// ─── Classes ─────────────────────────────────────────────────────────────────

/** GET /api/admin/classes — All classes */
router.get('/admin/classes', async (_req, res: Response): Promise<void> => {
  const db = getDB()
  const classes = await db.collection<Class>('classes').find().toArray()
  res.json({ success: true, data: classes.map(toClassDto) })
})

/** POST /api/admin/classes — Create class (TopAdmin only) */
router.post('/admin/classes', requireTopAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name } = req.body as { name: string }
  if (!name?.trim()) {
    res.status(400).json({ success: false, error: 'name is required' })
    return
  }

  const id = new ObjectId().toHexString()
  const newClass: Class = {
    _id: id,
    name: name.trim(),
    leaderIds: [],
  }
  const db = getDB()
  await db.collection<Class>('classes').insertOne(newClass)
  res.json({ success: true, data: toClassDto(newClass) })
})

/** GET /api/classes/:classId — Get class info (any authenticated user) */
router.get('/classes/:classId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId } = req.params
  const db = getDB()
  const cls = await db.collection<Class>('classes').findOne({ _id: classId })
  if (!cls) { res.status(404).json({ success: false, error: 'not found' }); return }
  res.json({ success: true, data: toClassDto(cls) })
})

/** PUT /api/admin/classes/:id — Update class (TopAdmin only) */
router.put('/admin/classes/:id', requireTopAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params
  const { name, sheetTabName, sheetClassLabel, iccfClassCode } = req.body as Partial<Class>

  const update: Partial<Class> = {}
  if (name !== undefined) update.name = name.trim()
  if (sheetTabName !== undefined) update.sheetTabName = sheetTabName.trim()
  if (sheetClassLabel !== undefined) update.sheetClassLabel = sheetClassLabel.trim()
  if (iccfClassCode !== undefined) update.iccfClassCode = iccfClassCode.trim()

  const db = getDB()
  await db.collection<Class>('classes').updateOne({ _id: id }, { $set: update })
  res.json({ success: true })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toUserDto(u: AppUser & { _id?: string }) {
  return {
    uid: u._id,
    name: u.name,
    email: u.email,
    photoURL: u.photoURL,
    role: u.role,
    classId: u.classId,
    isAdmin: u.isAdmin === true,
  }
}

function toClassDto(c: Class) {
  return {
    id: c._id,
    name: c.name,
    leaderIds: c.leaderIds ?? [],
    sheetTabName: c.sheetTabName ?? '',
    sheetClassLabel: c.sheetClassLabel ?? '',
    iccfClassCode: c.iccfClassCode ?? '',
    iccfClassCodeHistory: c.iccfClassCodeHistory ?? [],
  }
}

export default router
