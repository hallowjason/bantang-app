import { Router, Response } from 'express'
import { ObjectId } from 'mongodb'
import { getDB } from '../db'
import { requireAuth, requirePortalAdmin, optionalAuth, AuthenticatedRequest } from '../middleware/auth'
import type { Venue, PortalEvent, EventResponse } from '../types'

const router = Router()

// ─── Venues ──────────────────────────────────────────────────────────────────

/** GET /api/venues — Public */
router.get('/venues', async (_req, res: Response): Promise<void> => {
  const db = getDB()
  const venues = await db.collection<Venue>('venues')
    .find()
    .sort({ order: 1 })
    .toArray()
  res.json({ success: true, data: venues.map(toVenueDto) })
})

/** POST /api/venues — PortalAdmin */
router.post('/venues', requireAuth, requirePortalAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const data = req.body as Omit<Venue, '_id'>
  const id = new ObjectId().toHexString()
  const db = getDB()
  await db.collection<Venue>('venues').insertOne({ _id: id, ...data })
  res.json({ success: true, data: { id } })
})

/** PUT /api/venues/:id — PortalAdmin */
router.put('/venues/:id', requireAuth, requirePortalAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const update = req.body as Partial<Omit<Venue, '_id'>>
  const db = getDB()
  await db.collection<Venue>('venues').updateOne({ _id: req.params.id }, { $set: update })
  res.json({ success: true })
})

/** DELETE /api/venues/:id — PortalAdmin */
router.delete('/venues/:id', requireAuth, requirePortalAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()
  await db.collection<Venue>('venues').deleteOne({ _id: req.params.id })
  res.json({ success: true })
})

// ─── Events ───────────────────────────────────────────────────────────────────

/** GET /api/events?published=true — Published events are public; all events require auth */
router.get('/events', optionalAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const published = req.query.published === 'true'
  const db = getDB()

  // Public can only see published events
  const filter = (!req.user || published) ? { isPublished: true } : {}

  const events = await db.collection<PortalEvent>('events')
    .find(filter)
    .sort(published ? { deadline: 1 } : { createdAt: -1 })
    .toArray()

  res.json({ success: true, data: events.map(toEventDto) })
})

/** GET /api/events/:id */
router.get('/events/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()
  const event = await db.collection<PortalEvent>('events').findOne({ _id: req.params.id })
  if (!event) {
    res.status(404).json({ success: false, error: 'Event not found' })
    return
  }
  // Non-admins can only see published events
  if (!event.isPublished && !req.user) {
    res.status(403).json({ success: false, error: 'Not authorized' })
    return
  }
  res.json({ success: true, data: toEventDto(event) })
})

/** POST /api/events — PortalAdmin */
router.post('/events', requireAuth, requirePortalAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const data = req.body as Omit<PortalEvent, '_id'>
  const id = new ObjectId().toHexString()
  const db = getDB()
  await db.collection<PortalEvent>('events').insertOne({ _id: id, ...data })
  res.json({ success: true, data: { id } })
})

/** PUT /api/events/:id — PortalAdmin */
router.put('/events/:id', requireAuth, requirePortalAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const update = req.body as Partial<Omit<PortalEvent, '_id'>>
  const db = getDB()
  await db.collection<PortalEvent>('events').updateOne({ _id: req.params.id }, { $set: update })
  res.json({ success: true })
})

/** DELETE /api/events/:id — PortalAdmin */
router.delete('/events/:id', requireAuth, requirePortalAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()
  await db.collection<PortalEvent>('events').deleteOne({ _id: req.params.id })
  res.json({ success: true })
})

// ─── Event Responses ──────────────────────────────────────────────────────────

/** GET /api/event-responses?eventId= — PortalAdmin */
router.get('/event-responses', requireAuth, requirePortalAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { eventId } = req.query as { eventId?: string }
  if (!eventId) {
    res.status(400).json({ success: false, error: 'eventId is required' })
    return
  }

  const db = getDB()
  const responses = await db.collection<EventResponse>('event_responses')
    .find({ eventId })
    .sort({ submittedAt: -1 })
    .toArray()

  res.json({ success: true, data: responses.map(toResponseDto) })
})

/** POST /api/event-responses — Public */
router.post('/event-responses', optionalAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const data = req.body as Omit<EventResponse, '_id'>
  const id = new ObjectId().toHexString()
  const db = getDB()

  const response: EventResponse = {
    _id: id,
    ...data,
    submitterUid: req.user?._id,
  }
  await db.collection<EventResponse>('event_responses').insertOne(response)

  // Update yes count in event document
  if (data.interest === 'yes') {
    await db.collection<PortalEvent>('events').updateOne(
      { _id: data.eventId },
      { $inc: { yesCount: 1 } as Record<string, number> },
    )
  }

  res.json({ success: true, data: { id } })
})

/** PUT /api/event-responses/:id — PortalAdmin */
router.put('/event-responses/:id', requireAuth, requirePortalAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const update = req.body as Partial<Pick<EventResponse, 'name' | 'phone' | 'email' | 'interest' | 'note'>>
  const db = getDB()
  await db.collection<EventResponse>('event_responses').updateOne(
    { _id: req.params.id },
    { $set: update },
  )
  res.json({ success: true })
})

/** DELETE /api/event-responses/:id — PortalAdmin */
router.delete('/event-responses/:id', requireAuth, requirePortalAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()
  await db.collection<EventResponse>('event_responses').deleteOne({ _id: req.params.id })
  res.json({ success: true })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toVenueDto(v: Venue) {
  return {
    id: v._id,
    name: v.name,
    city: v.city,
    address: v.address,
    mapUrl: v.mapUrl,
    lineGroupUrl: v.lineGroupUrl,
    description: v.description,
    members: v.members ?? [],
    order: v.order,
  }
}

function toEventDto(e: PortalEvent) {
  return {
    id: e._id,
    title: e.title,
    type: e.type,
    description: e.description,
    imageUrl: e.imageUrl,
    eventDates: e.eventDates,
    deadline: e.deadline,
    responsible: e.responsible,
    isPublished: e.isPublished,
    createdAt: e.createdAt,
    createdBy: e.createdBy,
    claimedBy: e.claimedBy,
  }
}

function toResponseDto(r: EventResponse) {
  return {
    id: r._id,
    eventId: r.eventId,
    name: r.name,
    phone: r.phone,
    email: r.email,
    interest: r.interest,
    note: r.note,
    submittedAt: r.submittedAt,
    submitterUid: r.submitterUid,
  }
}

export default router
