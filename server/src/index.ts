import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { connectDB, getDB } from './db'

import adminRouter from './routes/admin'
import membersRouter from './routes/members'
import attendanceRouter from './routes/attendance'
import sessionsRouter from './routes/sessions'
import settingsRouter from './routes/settings'
import weeklyRouter from './routes/weekly'
import statsRouter from './routes/stats'
import portalRouter from './routes/portal'
import uploadRouter from './routes/upload'
import scheduleCacheRouter from './routes/scheduleCache'
import iccfSessionRouter from './routes/iccfSession'
import iccfSyncRouter from './routes/iccfSync'
import { ensureSessionIndexes, sweepExpiredMemory } from './iccf/sessionStore'
import { sweepOldJobs } from './jobs/iccfSyncWorker'

// ─── Env validation (fail-fast) ───────────────────────────────────────────────

const REQUIRED_ENV = ['MONGODB_URI'] as const
const FIREBASE_CRED_ENV = ['FIREBASE_SERVICE_ACCOUNT_B64', 'FIREBASE_SERVICE_ACCOUNT_JSON'] as const

function validateEnv(): void {
  const missing = REQUIRED_ENV.filter(key => !process.env[key])
  const hasFirebaseCred = FIREBASE_CRED_ENV.some(key => process.env[key])

  const errors: string[] = []
  if (missing.length) errors.push(`Missing required env: ${missing.join(', ')}`)
  if (!hasFirebaseCred) errors.push(`Missing Firebase credentials: set one of ${FIREBASE_CRED_ENV.join(' or ')}`)

  if (errors.length) {
    console.error('Startup env validation failed:')
    errors.forEach(e => console.error(`  - ${e}`))
    process.exit(1)
  }
}

validateEnv()

const app = express()
const PORT = process.env.PORT ?? 3000
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads')
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173'

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
  origin: [FRONTEND_URL, /\.zeabur\.app$/],
  credentials: true,
}))
app.use(express.json())

// Serve uploaded images as static files
app.use('/uploads', express.static(UPLOADS_DIR))

// ─── Routes ───────────────────────────────────────────────────────────────────

// Users (GET /api/users/me) + Admin routes (GET/PUT /api/admin/*)
app.use('/api', adminRouter)

app.use('/api/members', membersRouter)
app.use('/api/attendance', attendanceRouter)
app.use('/api/sessions', sessionsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/weekly-tasks', weeklyRouter)
app.use('/api/stats', statsRouter)
app.use('/api', portalRouter)       // venues, events, event-responses
app.use('/api/upload', uploadRouter)
app.use('/api/schedule-cache', scheduleCacheRouter)
app.use('/api/iccf/session', iccfSessionRouter)
app.use('/api/iccf/sync', iccfSyncRouter)

// ─── Health checks ────────────────────────────────────────────────────────────

// Liveness: process is running. Cheap, no external deps.
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() })
})

// Readiness: all downstream deps healthy. Used by Zeabur / load balancers.
app.get('/ready', async (_req, res) => {
  const checks: Record<string, boolean> = {
    db: false,
    firebaseCreds: Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_B64 || process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    ),
  }

  try {
    await getDB().command({ ping: 1 })
    checks.db = true
  } catch {
    // db check failed
  }

  const ok = Object.values(checks).every(Boolean)
  res.status(ok ? 200 : 503).json({ ok, uptime: process.uptime(), checks })
})

// ─── Start ────────────────────────────────────────────────────────────────────

connectDB().then(async () => {
  await ensureSessionIndexes()
  setInterval(sweepExpiredMemory, 5 * 60 * 1000)
  setInterval(sweepOldJobs, 30 * 60 * 1000)
  app.listen(PORT, () => {
    console.log(`bantang-server listening on port ${PORT}`)
  })
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err)
  process.exit(1)
})
