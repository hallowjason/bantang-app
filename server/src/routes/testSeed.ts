import { Router } from 'express'
import { getDB } from '../db'
import type { AppUser, UserRole } from '../types'

/**
 * Test-only user seeding router. Registered on the main app ONLY when
 * FIREBASE_AUTH_EMULATOR_HOST is set (E2E / dev). Never mounted in production.
 *
 * Allows E2E tests to pre-create users with elevated roles that the normal
 * first-login flow intentionally refuses to self-assign.
 */
const router = Router()

const ALL_ROLES: readonly UserRole[] = [
  'class_master',
  'head_leader',
  'leader',
  'junior_leader',
  'member',
]

router.post('/seed-user', async (req, res) => {
  const { uid, email, name, role, classId } = req.body ?? {}

  if (typeof uid !== 'string' || !uid) {
    res.status(400).json({ success: false, error: 'uid required' })
    return
  }
  if (!(ALL_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({ success: false, error: `role must be one of ${ALL_ROLES.join(', ')}` })
    return
  }

  const user = {
    _id: uid,
    name: typeof name === 'string' ? name : '',
    email: typeof email === 'string' ? email : null,
    photoURL: null,
    role: role as UserRole,
    classId: typeof classId === 'string' ? classId : '',
  }

  await getDB().collection<AppUser>('users').updateOne(
    { _id: uid },
    { $set: user },
    { upsert: true },
  )

  res.json({ success: true, data: user })
})

router.get('/user/:uid', async (req, res) => {
  const user = await getDB().collection<AppUser>('users').findOne({ _id: req.params.uid })
  if (!user) {
    res.status(404).json({ success: false, error: 'not found' })
    return
  }
  res.json({ success: true, data: user })
})

export default router
