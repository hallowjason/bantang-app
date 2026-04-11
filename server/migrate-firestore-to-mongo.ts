/**
 * migrate-firestore-to-mongo.ts
 * 將 Firestore 所有資料搬移到 MongoDB（upsert，可重複執行）
 *
 * 執行方式：
 *   cd server
 *   npx tsx migrate-firestore-to-mongo.ts
 */

import 'dotenv/config'
import * as admin from 'firebase-admin'
import { MongoClient, Db } from 'mongodb'
import * as fs from 'fs'
import * as path from 'path'

// ─── 初始化 Firebase Admin ─────────────────────────────────────────────────────

const saKeyPath = path.join(__dirname, 'serviceAccountKey.json')
const serviceAccount = JSON.parse(fs.readFileSync(saKeyPath, 'utf-8'))

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const firestore = admin.firestore()

// ─── 初始化 MongoDB ─────────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) throw new Error('MONGODB_URI not set in .env')

async function connectMongo(): Promise<Db> {
  const client = new MongoClient(MONGODB_URI!)
  await client.connect()
  return client.db()
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`[migrate] ${msg}`) }

async function upsertAll<T extends object>(db: Db, colName: string, docs: T[]) {
  if (docs.length === 0) { log(`${colName}: 無資料，略過`); return }
  const col = db.collection(colName)
  let count = 0
  for (const doc of docs) {
    const id = (doc as Record<string, unknown>)['_id']
    await col.updateOne({ _id: id }, { $set: doc }, { upsert: true })
    count++
  }
  log(`${colName}: upserted ${count} 筆`)
}

// ─── 遷移各集合 ───────────────────────────────────────────────────────────────

async function migrateUsers(db: Db) {
  const snap = await firestore.collection('users').get()
  const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
  await upsertAll(db, 'users', docs)
}

async function migrateClasses(db: Db) {
  const snap = await firestore.collection('classes').get()
  const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
  await upsertAll(db, 'classes', docs)
}

async function migrateEtiquetteItems(db: Db) {
  const snap = await firestore.collection('etiquette_items').get()
  const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
  await upsertAll(db, 'etiquette_items', docs)
}

async function migrateSettings(db: Db) {
  const docRef = await firestore.collection('settings').doc('main').get()
  if (!docRef.exists) { log('settings: 無資料，略過'); return }
  const doc = { _id: 'main', ...docRef.data() }
  await upsertAll(db, 'settings', [doc])
}

async function migrateMembers(db: Db) {
  const snap = await firestore.collection('members').get()
  const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
  await upsertAll(db, 'members', docs)
}

async function migrateClassMembers(db: Db) {
  // Firestore: /class_members/{classId}/members/{memberId}（純 subcollection，頂層無文件）
  // MongoDB: class_members collection, _id = "{classId}_{memberId}"
  // 必須用 collectionGroup 才能讀到所有 subcollection
  const snap = await firestore.collectionGroup('members').get()
  const docs: Record<string, unknown>[] = []

  for (const mDoc of snap.docs) {
    // path: class_members/{classId}/members/{memberId}
    const pathParts = mDoc.ref.path.split('/')
    if (pathParts[0] !== 'class_members' || pathParts[2] !== 'members') continue
    const classId  = pathParts[1]
    const memberId = pathParts[3]
    docs.push({
      _id: `${classId}_${memberId}`,
      ...mDoc.data(),
      memberId,
      classId,
    })
  }
  await upsertAll(db, 'class_members', docs)
}

async function migrateSessions(db: Db) {
  // Firestore: /sessions/{sessionId} 含 classId + date
  // MongoDB: sessions, _id = "{classId}_{date}"
  const snap = await firestore.collection('sessions').get()
  const docs = snap.docs.map(d => {
    const data = d.data() as { classId: string; date: string; [k: string]: unknown }
    return {
      _id: `${data.classId}_${data.date}`,
      ...data,
    }
  })
  await upsertAll(db, 'sessions', docs)
}

async function migrateAttendance(db: Db) {
  // Firestore: /attendance/{attendanceId} 含 classId + memberId + date
  // MongoDB: attendance, _id = "{classId}_{memberId}_{date}"
  const snap = await firestore.collection('attendance').get()
  const docs = snap.docs.map(d => {
    const data = d.data() as {
      classId: string; memberId: string; date: string
      status?: string; [k: string]: unknown
    }
    // 舊版可能用 present: boolean，這裡轉成 status
    let status = data.status as string | undefined
    if (!status) {
      const present = data['present'] as boolean | undefined
      status = present === true ? 'present' : present === false ? 'absent' : 'absent'
    }
    return {
      _id: `${data.classId}_${data.memberId}_${data.date}`,
      ...data,
      status,
    }
  })
  await upsertAll(db, 'attendance', docs)
}

async function migrateWeeklyTasks(db: Db) {
  // Firestore: /weekly_tasks/{classId}/weeks/{weekId}（純 subcollection）
  // MongoDB: weekly_tasks, _id = "{classId}_{weekStart}"
  const snap = await firestore.collectionGroup('weeks').get()
  const docs: Record<string, unknown>[] = []

  for (const weekDoc of snap.docs) {
    // path: weekly_tasks/{classId}/weeks/{weekId}
    const pathParts = weekDoc.ref.path.split('/')
    if (pathParts[0] !== 'weekly_tasks' || pathParts[2] !== 'weeks') continue
    const classId = pathParts[1]
    {
      const data = weekDoc.data() as Record<string, unknown>
      const weekStart = (data.weekStart as string | undefined) ?? weekDoc.id

      // 轉換舊版 speakerConfirmed (boolean) → speakerStatuses (Record<string, boolean>)
      // 舊版 hostThisWeek / hostNextWeek → 保留為備份欄位
      const speakerStatuses =
        (data.speakerStatuses as Record<string, boolean> | undefined) ?? {}
      const verifyStatuses =
        (data.verifyStatuses as Record<string, boolean> | undefined) ?? {}

      docs.push({
        _id: `${classId}_${weekStart}`,
        classId,
        weekStart,
        hostNotified: (data.hostNotified as boolean | undefined) ?? false,
        speakerStatuses,
        verifyStatuses,
        notes: (data.notes as string | undefined) ?? '',
        // 保留舊有欄位作參考
        ...(data.hostThisWeek !== undefined ? { legacyHostThisWeek: data.hostThisWeek } : {}),
      })
    }
  }
  await upsertAll(db, 'weekly_tasks', docs)
}

// ─── 主程式 ────────────────────────────────────────────────────────────────────

async function main() {
  log('開始連線 MongoDB...')
  const db = await connectMongo()
  log('MongoDB 連線成功')

  log('=== 開始遷移 Firestore → MongoDB ===')

  await migrateSettings(db)
  await migrateEtiquetteItems(db)
  await migrateClasses(db)
  await migrateUsers(db)
  await migrateMembers(db)
  await migrateClassMembers(db)
  await migrateSessions(db)
  await migrateAttendance(db)
  await migrateWeeklyTasks(db)

  log('=== 遷移完成 ===')
  process.exit(0)
}

main().catch(err => {
  console.error('[migrate] 失敗:', err)
  process.exit(1)
})
