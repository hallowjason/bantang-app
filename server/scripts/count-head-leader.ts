/**
 * Read-only dry-run: count how many users still have role='head_leader'.
 * Safe to run against production — no writes.
 */
import 'dotenv/config'
import { MongoClient } from 'mongodb'

async function main() {
  const uri = process.env['MONGODB_URI']
  if (!uri) { console.error('no MONGODB_URI'); process.exit(1) }

  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db()
  const col = db.collection('users')

  const total = await col.countDocuments()
  const count = await col.countDocuments({ role: 'head_leader' })
  const sample = await col
    .find({ role: 'head_leader' }, { projection: { name: 1, email: 1, classId: 1 } })
    .limit(20)
    .toArray()

  console.log(JSON.stringify({ total_users: total, head_leader_count: count, sample }, null, 2))
  await client.close()
}

main().catch(e => { console.error(e); process.exit(1) })
