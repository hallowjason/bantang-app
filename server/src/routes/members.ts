import { Router, Response } from 'express'
import { ObjectId } from 'mongodb'
import { getDB } from '../db'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import type { Member, ClassMember, Attendance, Class } from '../types'
import { getSession, touchSession } from '../iccf/sessionStore'
import { addMember as iccfAddMember } from '../iccf/client'

interface ClassMemberWithName extends ClassMember {
  className: string
}

const router = Router()
router.use(requireAuth)

// ─── GET /api/members?classId= ───────────────────────────────────────────────

router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId } = req.query as { classId?: string }
  if (!classId) {
    res.status(400).json({ success: false, error: 'classId is required' })
    return
  }

  const db = getDB()
  // Find active class_members for this class
  const cms = await db.collection<ClassMember>('class_members')
    .find({ classId, isActive: true })
    .toArray()

  if (cms.length === 0) {
    res.json({ success: true, data: [] })
    return
  }

  const memberIds = cms.map(cm => cm.memberId)
  const members = await db.collection<Member>('members')
    .find({ _id: { $in: memberIds } })
    .toArray()

  res.json({ success: true, data: members.map(toMemberDto) })
})

// ─── GET /api/members/:id ────────────────────────────────────────────────────

router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()
  const member = await db.collection<Member>('members').findOne({ _id: req.params.id })
  if (!member) {
    res.status(404).json({ success: false, error: 'Member not found' })
    return
  }
  res.json({ success: true, data: toMemberDto(member) })
})

// ─── POST /api/members ───────────────────────────────────────────────────────

router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, iccfSessionId, iccfClassCode, ...memberData } = req.body as Omit<Member, '_id'> & {
    classId: string
    iccfSessionId?: string
    iccfClassCode?: string
  }
  if (!classId) {
    res.status(400).json({ success: false, error: 'classId is required' })
    return
  }

  const memberId = new ObjectId().toHexString()
  const newMember: Member = { _id: memberId, ...memberData }

  const db = getDB()
  await db.collection<Member>('members').insertOne(newMember)

  // Link to class
  const classMember: ClassMember = {
    _id: `${classId}_${memberId}`,
    memberId,
    classId,
    joinedAt: new Date().toISOString().slice(0, 10),
    addedBy: req.user!._id,
    isActive: true,
  }
  await db.collection<ClassMember>('class_members').insertOne(classMember)

  // iccf 補入（非同步，不阻斷建立流程）
  let iccfResult: { status: string; iccfMemberId?: string; message?: string } | null = null

  if (iccfSessionId && iccfClassCode) {
    const session = await getSession(iccfSessionId)
    if (!session) {
      iccfResult = { status: 'error', message: 'iccf session 不存在或已過期，請重新登入' }
    } else {
      try {
        const r = await iccfAddMember(
          session.cookieJar,
          newMember.name,
          newMember.regionUnit,
          iccfClassCode,
        )
        iccfResult = r

        const iccfUpdate: Partial<Member> = {
          iccfStatus: r.status === 'synced' ? 'synced' : r.status as Member['iccfStatus'],
          iccfSyncedAt: new Date().toISOString(),
          iccfLastError: r.status !== 'synced' ? r.message : undefined,
        }
        if (r.iccfMemberId) iccfUpdate.iccfMemberId = r.iccfMemberId

        await db.collection<Member>('members').updateOne({ _id: memberId }, { $set: iccfUpdate })
        await touchSession(iccfSessionId)
      } catch (err) {
        iccfResult = { status: 'error', message: (err as Error).message }
        await db.collection<Member>('members').updateOne(
          { _id: memberId },
          { $set: { iccfStatus: 'error', iccfLastError: (err as Error).message } },
        )
      }
    }
  }

  res.json({ success: true, data: { id: memberId, iccf: iccfResult } })
})

// ─── PUT /api/members/:id ────────────────────────────────────────────────────

router.put('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const update = req.body as Partial<Omit<Member, '_id'>>
  const db = getDB()
  await db.collection<Member>('members').updateOne({ _id: req.params.id }, { $set: update })
  res.json({ success: true })
})

// ─── POST /api/members/:id/remove-from-class ─────────────────────────────────

router.post('/:id/remove-from-class', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { classId, removeReason } = req.body as { classId: string; removeReason: string }
  if (!classId) {
    res.status(400).json({ success: false, error: 'classId is required' })
    return
  }

  const db = getDB()
  await db.collection<ClassMember>('class_members').updateOne(
    { _id: `${classId}_${req.params.id}` },
    {
      $set: {
        isActive: false,
        removedAt: new Date().toISOString().slice(0, 10),
        removedBy: req.user!._id,
        removeReason: removeReason ?? '',
      },
    },
  )
  res.json({ success: true })
})

// ─── GET /api/members/:id/attendance ─────────────────────────────────────────

router.get('/:id/attendance', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()

  const [attendanceRecords, member] = await Promise.all([
    db.collection<Attendance>('attendance')
      .find({ memberId: req.params.id })
      .sort({ date: -1 })
      .toArray(),
    db.collection<Member>('members').findOne({ _id: req.params.id }),
  ])

  const initialCount = member?.initialAttendanceCount ?? 0
  const presentCount = attendanceRecords.filter(r => r.status === 'present').length
  const totalCount = initialCount + presentCount

  res.json({
    success: true,
    data: {
      records: attendanceRecords.map(toAttendanceDto),
      totalCount,
    },
  })
})

// ─── GET /api/members/:id/active-classes ─────────────────────────────────────

router.get('/:id/active-classes', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()

  const cms = await db.collection<ClassMember>('class_members')
    .find({ memberId: req.params.id, isActive: true })
    .toArray()

  if (cms.length === 0) {
    res.json({ success: true, data: [] })
    return
  }

  const classIds = cms.map(cm => cm.classId)
  const classes = await db.collection<Class>('classes')
    .find({ _id: { $in: classIds } })
    .toArray()

  const classMap = new Map(classes.map(c => [c._id, c.name]))

  const result: ClassMemberWithName[] = cms.map(cm => ({
    ...cm,
    className: classMap.get(cm.classId) ?? cm.classId,
  }))

  res.json({ success: true, data: result.map(cm => ({
    memberId: cm.memberId,
    classId: cm.classId,
    className: cm.className,
    joinedAt: cm.joinedAt,
    addedBy: cm.addedBy,
    isActive: cm.isActive,
  }))})
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMemberDto(m: Member) {
  return {
    id: m._id,
    name: m.name,
    birthday: m.birthday,
    initialAttendanceCount: m.initialAttendanceCount,
    mentor: m.mentor,
    regionUnit: m.regionUnit,
    regionNumber: m.regionNumber,
    etiquetteItems: m.etiquetteItems ?? {},
    notes: m.notes,
    createdAt: m.createdAt,
    createdBy: m.createdBy,
    iccfStatus: m.iccfStatus,
    iccfMemberId: m.iccfMemberId,
    iccfSyncedAt: m.iccfSyncedAt,
    iccfLastError: m.iccfLastError,
  }
}

function toAttendanceDto(a: Attendance) {
  return {
    id: a._id,
    memberId: a.memberId,
    classId: a.classId,
    date: a.date,
    status: a.status,
    note: a.note,
    recordedBy: a.recordedBy,
    lastUpdatedBy: a.lastUpdatedBy,
    lastUpdatedAt: a.lastUpdatedAt,
  }
}

export default router
