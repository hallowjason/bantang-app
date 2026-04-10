import { MongoClient, Db } from 'mongodb'

let client: MongoClient | null = null
let db: Db | null = null

export async function connectDB(): Promise<Db> {
  if (db) return db

  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')

  client = new MongoClient(uri)
  await client.connect()
  db = client.db() // uses the db name from the URI
  console.log('MongoDB connected')
  return db
}

export function getDB(): Db {
  if (!db) throw new Error('Database not initialized. Call connectDB() first.')
  return db
}
