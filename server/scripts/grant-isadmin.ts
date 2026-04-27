/**
 * grant-isadmin.ts
 *
 * One-off: set { isAdmin: true } on a user identified by email. Idempotent.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/grant-isadmin.ts <email>
 *
 * Example:
 *   npx tsx scripts/grant-isadmin.ts xzj071@gmail.com
 */

import 'dotenv/config'
import { MongoClient } from 'mongodb'

const MONGODB_URI = process.env['MONGODB_URI']
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in .env')
  process.exit(1)
}

const email = process.argv[2]?.trim()
if (!email) {
  console.error('Usage: npx tsx scripts/grant-isadmin.ts <email>')
  process.exit(1)
}

interface UserDoc {
  _id: string
  name?: string
  email?: string | null
  role?: string
  isAdmin?: boolean
}

async function main() {
  const client = new MongoClient(MONGODB_URI!)
  await client.connect()
  const db = client.db()
  const users = db.collection<UserDoc>('users')

  // Case-insensitive email match (Firebase emails are usually lowercase but
  // some providers preserve case; safer to compare case-insensitively).
  const found = await users.findOne({
    email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' },
  })

  if (!found) {
    console.error(`[grant-isadmin] no user found with email='${email}'`)
    console.error('  → 該使用者必須先用 Google 登入過一次，users collection 才有對應 doc')
    await client.close()
    process.exit(2)
  }

  console.log(`[grant-isadmin] target: ${found._id}  name='${found.name ?? '(unnamed)'}'  email='${found.email}'  role='${found.role ?? '?'}'  isAdmin=${found.isAdmin === true}`)

  if (found.isAdmin === true) {
    console.log('[grant-isadmin] already isAdmin=true — nothing to do')
    await client.close()
    return
  }

  const result = await users.updateOne(
    { _id: found._id },
    { $set: { isAdmin: true } },
  )
  console.log(`[grant-isadmin] modified=${result.modifiedCount}`)

  const after = await users.findOne({ _id: found._id })
  if (after?.isAdmin === true) {
    console.log('[grant-isadmin] verified: isAdmin=true')
  } else {
    console.error('[grant-isadmin] WARNING: write did not stick')
  }

  await client.close()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
