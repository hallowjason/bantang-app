/**
 * Read-only: export full documents of all users with role='head_leader'
 * to a timestamped JSON file. Run BEFORE the migration as a rollback plan.
 */
import 'dotenv/config'
import { MongoClient } from 'mongodb'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

async function main() {
  const uri = process.env['MONGODB_URI']
  if (!uri) { console.error('no MONGODB_URI'); process.exit(1) }

  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db()
  const users = await db.collection('users').find({ role: 'head_leader' }).toArray()

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const outDir = resolve(__dirname, '../backups')
  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = resolve(outDir, `head_leader-${stamp}.json`)
  writeFileSync(out, JSON.stringify(users, null, 2))

  console.log(`[backup] wrote ${users.length} user(s) to ${out}`)
  await client.close()
}

main().catch(e => { console.error(e); process.exit(1) })
