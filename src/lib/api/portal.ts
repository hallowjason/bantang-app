import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from './client'
import type { Venue, PortalEvent, EventResponse } from '../../types'

// ─── Venues ──────────────────────────────────────────────────────────────────

export async function getAllVenues(): Promise<Venue[]> {
  return apiGet<Venue[]>('/api/venues')
}

export async function createVenue(data: Omit<Venue, 'id'>): Promise<string> {
  const result = await apiPost<{ id: string }>('/api/venues', data)
  return result.id
}

export async function updateVenue(
  id: string,
  data: Partial<Omit<Venue, 'id'>>,
): Promise<void> {
  await apiPut(`/api/venues/${id}`, data)
}

export async function deleteVenue(id: string): Promise<void> {
  await apiDelete(`/api/venues/${id}`)
}

// ─── Events ───────────────────────────────────────────────────────────────────

export async function getPublishedEvents(): Promise<PortalEvent[]> {
  return apiGet<PortalEvent[]>('/api/events?published=true')
}

export async function getAllEvents(): Promise<PortalEvent[]> {
  return apiGet<PortalEvent[]>('/api/events')
}

export async function getEvent(id: string): Promise<PortalEvent | null> {
  try {
    return await apiGet<PortalEvent>(`/api/events/${id}`)
  } catch {
    return null
  }
}

export async function createEvent(data: Omit<PortalEvent, 'id'>): Promise<string> {
  const result = await apiPost<{ id: string }>('/api/events', data)
  return result.id
}

export async function updateEvent(
  id: string,
  data: Partial<Omit<PortalEvent, 'id'>>,
): Promise<void> {
  await apiPut(`/api/events/${id}`, data)
}

export async function deleteEvent(id: string): Promise<void> {
  await apiDelete(`/api/events/${id}`)
}

export async function toggleEventPublished(id: string, published: boolean): Promise<void> {
  await apiPut(`/api/events/${id}`, { isPublished: published })
}

export async function claimEvent(id: string, uid: string, name: string): Promise<void> {
  await apiPut(`/api/events/${id}`, {
    claimedBy: { uid, name, claimedAt: new Date().toISOString() },
  })
}

export async function unclaimEvent(id: string): Promise<void> {
  await apiPut(`/api/events/${id}`, { claimedBy: null })
}

// ─── Event Responses ──────────────────────────────────────────────────────────

export async function submitEventResponse(
  data: Omit<EventResponse, 'id'>,
): Promise<string> {
  const result = await apiPost<{ id: string }>('/api/event-responses', data)
  return result.id
}

export async function getEventResponses(eventId: string): Promise<EventResponse[]> {
  return apiGet<EventResponse[]>(`/api/event-responses?eventId=${eventId}`)
}

export async function deleteEventResponse(id: string): Promise<void> {
  await apiDelete(`/api/event-responses/${id}`)
}

export async function updateEventResponse(
  id: string,
  data: Partial<Pick<EventResponse, 'name' | 'phone' | 'email' | 'interest' | 'note'>>,
): Promise<void> {
  await apiPut(`/api/event-responses/${id}`, data)
}

/**
 * Poll-based substitute for onSnapshot.
 */
export function subscribeToEventResponses(
  eventId: string,
  onData: (responses: EventResponse[]) => void,
): () => void {
  const doFetch = () =>
    getEventResponses(eventId).then(onData).catch(console.error)

  doFetch()
  const id = setInterval(doFetch, 4000)
  return () => clearInterval(id)
}

// ─── Image upload (replaces Firebase Storage) ────────────────────────────────

export async function uploadEventImage(file: File): Promise<string> {
  return apiUpload('/api/upload', file)
}
