import { randomUUID } from 'crypto'
import { CookieJar } from 'tough-cookie'
import { getDB } from '../db'
import { IccfError } from './errors'
import type { IccfProfile, IccfClassEntry } from './client'

export interface IccfSessionRecord {
  sessionId: string
  leaderId: string
  iccfAccount: string
  profile: IccfProfile | null
  classes: IccfClassEntry[]
  cookieJar: CookieJar
  createdAt: Date
  lastUsedAt: Date
  expiresAt: Date
}

const TTL_MS = 30 * 60 * 1000 // 30 minutes idle
const COLLECTION = 'iccf_sessions'

/** In-memory primary store. Mongo is a restart backup. */
const memory = new Map<string, IccfSessionRecord>()

interface MongoDoc {
  _id: string
  leaderId: string
  iccfAccount: string
  profile: IccfProfile | null
  classes: IccfClassEntry[]
  cookieJarJson: string
  createdAt: Date
  lastUsedAt: Date
  expiresAt: Date
}

function nowPlusTtl(): Date {
  return new Date(Date.now() + TTL_MS)
}

export async function createSession(params: {
  leaderId: string
  iccfAccount: string
  profile: IccfProfile | null
  classes: IccfClassEntry[]
  cookieJar: CookieJar
}): Promise<IccfSessionRecord> {
  const now = new Date()
  const record: IccfSessionRecord = {
    sessionId: randomUUID(),
    leaderId: params.leaderId,
    iccfAccount: params.iccfAccount,
    profile: params.profile,
    classes: params.classes,
    cookieJar: params.cookieJar,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: nowPlusTtl(),
  }
  memory.set(record.sessionId, record)
  await persist(record)
  return record
}

export async function getSession(sessionId: string): Promise<IccfSessionRecord | null> {
  let record = memory.get(sessionId) ?? null

  if (!record) {
    record = await hydrateFromMongo(sessionId)
  }

  if (!record) return null

  if (record.expiresAt.getTime() < Date.now()) {
    await deleteSession(sessionId)
    return null
  }

  return record
}

/** Find any valid session for the given class (any leader with the classCode). */
export async function findSessionForClass(classCode: string): Promise<IccfSessionRecord | null> {
  const now = Date.now()
  for (const record of memory.values()) {
    if (record.expiresAt.getTime() <= now) continue
    if (record.classes.some((c) => c.classCode === classCode)) return record
  }
  return null
}

export async function listSessionsByLeader(leaderId: string): Promise<IccfSessionRecord[]> {
  const now = Date.now()
  return Array.from(memory.values()).filter(
    (r) => r.leaderId === leaderId && r.expiresAt.getTime() > now,
  )
}

export async function touchSession(sessionId: string): Promise<void> {
  const record = memory.get(sessionId)
  if (!record) return
  const now = new Date()
  record.lastUsedAt = now
  record.expiresAt = nowPlusTtl()
  await persist(record)
}

export async function deleteSession(sessionId: string): Promise<void> {
  memory.delete(sessionId)
  try {
    const db = getDB()
    await db.collection<MongoDoc>(COLLECTION).deleteOne({ _id: sessionId })
  } catch {
    // db not ready yet — ignore
  }
}

async function persist(record: IccfSessionRecord): Promise<void> {
  try {
    const db = getDB()
    const doc: MongoDoc = {
      _id: record.sessionId,
      leaderId: record.leaderId,
      iccfAccount: record.iccfAccount,
      profile: record.profile,
      classes: record.classes,
      cookieJarJson: JSON.stringify(record.cookieJar.toJSON()),
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      expiresAt: record.expiresAt,
    }
    await db
      .collection<MongoDoc>(COLLECTION)
      .updateOne({ _id: record.sessionId }, { $set: doc }, { upsert: true })
  } catch {
    // Mongo backup is non-critical; in-memory is authoritative.
  }
}

async function hydrateFromMongo(sessionId: string): Promise<IccfSessionRecord | null> {
  try {
    const db = getDB()
    const doc = await db.collection<MongoDoc>(COLLECTION).findOne({ _id: sessionId })
    if (!doc) return null

    const jar = CookieJar.fromJSON(doc.cookieJarJson as unknown as string)
    const record: IccfSessionRecord = {
      sessionId: doc._id,
      leaderId: doc.leaderId,
      iccfAccount: doc.iccfAccount,
      profile: doc.profile,
      classes: doc.classes,
      cookieJar: jar,
      createdAt: doc.createdAt,
      lastUsedAt: doc.lastUsedAt,
      expiresAt: doc.expiresAt,
    }
    memory.set(sessionId, record)
    return record
  } catch {
    return null
  }
}

/** Ensure Mongo has a TTL index that auto-purges expired rows. */
export async function ensureSessionIndexes(): Promise<void> {
  try {
    const db = getDB()
    await db
      .collection<MongoDoc>(COLLECTION)
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    await db.collection<MongoDoc>(COLLECTION).createIndex({ leaderId: 1 })
  } catch (err) {
    throw new IccfError('network_error', 'Failed to ensure iccf_sessions indexes', err)
  }
}

/** Sweep expired sessions from memory (Mongo TTL handles its own side). */
export function sweepExpiredMemory(): void {
  const now = Date.now()
  for (const [id, record] of memory.entries()) {
    if (record.expiresAt.getTime() <= now) {
      memory.delete(id)
    }
  }
}
