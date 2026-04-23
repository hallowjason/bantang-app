/**
 * migrate-head-leader-to-isadmin.ts
 *
 * One-off migration: convert legacy `role: 'head_leader'` users into
 * `{ role: 'leader', isAdmin: true }`. After this migration `head_leader` is
 * no longer a valid UserRole value and should not appear in the collection.
 *
 * Run:
 *   cd server
 *   npx tsx scripts/migrate-head-leader-to-isadmin.ts
 *
 * **Take a backup of the users collection before running.**
 */

import 'dotenv/config'
import { MongoClient } from 'mongodb'

const MONGODB_URI = process.env['MONGODB_URI']
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in .env')
  process.exit(1)
}

async function main() {
  const client = new MongoClient(MONGODB_URI!)
  await client.connect()
  const db = client.db()
  const users = db.collection<{
    _id: string
    name?: string
    role: string
    isAdmin?: boolean
  }>('users')

  const affected = await users.find({ role: 'head_leader' }).toArray()
  console.log(`[migrate] found ${affected.length} user(s) with role='head_leader'`)
  for (const u of affected) {
    console.log(`  - ${u._id} (${u.name ?? 'unnamed'})`)
  }

  if (affected.length === 0) {
    console.log('[migrate] nothing to do')
    await client.close()
    return
  }

  const result = await users.updateMany(
    { role: 'head_leader' },
    { $set: { role: 'leader', isAdmin: true } },
  )
  console.log(`[migrate] updated ${result.modifiedCount} user(s) → { role: 'leader', isAdmin: true }`)

  const leftover = await users.countDocuments({ role: 'head_leader' })
  if (leftover > 0) {
    console.error(`[migrate] WARNING: ${leftover} user(s) still have role='head_leader'`)
  } else {
    console.log('[migrate] verified: no user has role=head_leader anymore')
  }

  await client.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
