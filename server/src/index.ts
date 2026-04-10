import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { connectDB } from './db'

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

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }))

// ─── Start ────────────────────────────────────────────────────────────────────

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`bantang-server listening on port ${PORT}`)
  })
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err)
  process.exit(1)
})
