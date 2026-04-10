import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { requireAuth } from '../middleware/auth'

const router = Router()

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads')

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const ext = path.extname(file.originalname)
    cb(null, `${unique}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase())
    const mimeOk = allowed.test(file.mimetype)
    if (extOk && mimeOk) {
      cb(null, true)
    } else {
      cb(new Error('Only image files are allowed'))
    }
  },
})

/** POST /api/upload — Upload event image */
router.post('/', requireAuth, upload.single('file'), (req: Request, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'No file uploaded' })
    return
  }

  // Return the public URL (served by Express static middleware)
  const url = `/uploads/${req.file.filename}`
  res.json({ success: true, data: { url } })
})

export default router
