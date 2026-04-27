import { Router, Response } from 'express'
import { ObjectId } from 'mongodb'
import { getDB } from '../db'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import type { Member, ClassMember, Attendance, Class } from '../types'
import { ensureAlive } from '../iccf/ensureAlive'
import type { IccfSessionRecord } from '../iccf/sessionStore'
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

  const db = getDB()

  // Pre-check iccf session BEFORE inserting the member. Previously the member
  // was created first, so if the session had expired the client's re-login retry
  // flow would re-submit and create a duplicate. Bail out early without any DB write.
  let aliveSession: IccfSessionRecord | null = null
  if (iccfSessionId && iccfClassCode) {
    const alive = await ensureAlive(iccfSessionId)
    if (!alive.ok) {
      res.json({
        success: true,
        data: {
          id: null,
          iccf: { status: 'session_expired', message: alive.message },
        },
      })
      return
    }
    aliveSession = alive.session
  }

  const memberId = new ObjectId().toHexString()
  const newMember: Member = { _id: memberId, ...memberData }

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

  if (aliveSession && iccfClassCode) {
    try {
      // iccfClassCode is the B-number ("B3000549"); iccfAddMember's form URL
      // needs the sec_code ("TWC") and addMemberHref. Look both up from the
      // live session entries.
      const classEntry = aliveSession.classes.find(c => c.iccfClassCode === iccfClassCode)
      const secCode = classEntry?.classCode ?? iccfClassCode

      const r = await iccfAddMember(
        aliveSession.cookieJar,
        newMember.name,
        newMember.regionUnit,
        newMember.regionNumber,
        secCode,
        iccfClassCode,
        classEntry?.addMemberHref,
      )
      iccfResult = r

      const iccfUpdate: Partial<Member> = {
        iccfStatus: r.status === 'synced' ? 'synced' : r.status as Member['iccfStatus'],
        iccfSyncedAt: new Date().toISOString(),
        iccfLastError: r.status !== 'synced' ? r.message : undefined,
      }
      if (r.iccfMemberId) iccfUpdate.iccfMemberId = r.iccfMemberId

      await db.collection<Member>('members').updateOne({ _id: memberId }, { $set: iccfUpdate })
    } catch (err) {
      iccfResult = { status: 'error', message: (err as Error).message }
      await db.collection<Member>('members').updateOne(
        { _id: memberId },
        { $set: { iccfStatus: 'error', iccfLastError: (err as Error).message } },
      )
    }
  }

  res.json({ success: true, data: { id: memberId, iccf: iccfResult } })
})

// ─── PUT /api/members/:id ────────────────────────────────────────────────────

const MEMBER_EDITABLE_FIELDS: (keyof Member)[] = [
  'name', 'birthday', 'mentor', 'regionUnit', 'regionNumber',
  'etiquetteItems', 'notes', 'initialAttendanceCount',
]

router.put('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const raw = req.body as Partial<Member>
  const update = Object.fromEntries(
    Object.entries(raw).filter(([k]) => MEMBER_EDITABLE_FIELDS.includes(k as keyof Member)),
  )
  const db = getDB()
  await db.collection<Member>('members').updateOne({ _id: req.params.id }, { $set: update })
  res.json({ success: true })
})

// ─── POST /api/members/:id/iccf-sync ─────────────────────────────────────────
//
// Re-run iccf 補入 for a member whose previous sync failed
// (iccfStatus in not_found / name_mismatch / duplicate / forbidden / error).
// Body: { iccfSessionId, iccfClassCode }
router.post('/:id/iccf-sync', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { iccfSessionId, iccfClassCode } = req.body as {
    iccfSessionId?: string
    iccfClassCode?: string
  }
  if (!iccfSessionId || !iccfClassCode) {
    res.status(400).json({ success: false, error: 'iccfSessionId 與 iccfClassCode 必填' })
    return
  }

  const db = getDB()
  const member = await db.collection<Member>('members').findOne({ _id: req.params.id })
  if (!member) {
    res.status(404).json({ success: false, error: 'Member not found' })
    return
  }

  const alive = await ensureAlive(iccfSessionId)
  if (!alive.ok) {
    res.status(401).json({ success: false, error: alive.message, code: alive.reason })
    return
  }

  try {
    // iccfClassCode is the B-number ("B3000549"); iccfAddMember's form URL
    // needs the sec_code ("TWC") and addMemberHref. Look both up from the
    // live session entries.
    const classEntry = alive.session.classes.find(c => c.iccfClassCode === iccfClassCode)
    const secCode = classEntry?.classCode ?? iccfClassCode

    const r = await iccfAddMember(
      alive.session.cookieJar,
      member.name,
      member.regionUnit,
      member.regionNumber,
      secCode,
      iccfClassCode,
      classEntry?.addMemberHref,
    )

    const iccfUpdate: Partial<Member> = {
      iccfStatus: r.status === 'synced' ? 'synced' : (r.status as Member['iccfStatus']),
      iccfSyncedAt: new Date().toISOString(),
      iccfLastError: r.status !== 'synced' ? r.message : undefined,
    }
    if (r.iccfMemberId) iccfUpdate.iccfMemberId = r.iccfMemberId

    await db.collection<Member>('members').updateOne({ _id: req.params.id }, { $set: iccfUpdate })
    res.json({ success: true, data: r })
  } catch (err) {
    const message = (err as Error).message
    await db.collection<Member>('members').updateOne(
      { _id: req.params.id },
      { $set: { iccfStatus: 'error', iccfLastError: message } },
    )
    res.json({ success: true, data: { status: 'error', message } })
  }
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
