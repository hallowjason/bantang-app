import { Router, Response } from 'express'
import { getDB } from '../db'
import { requireAuth, requireTopAdmin, AuthenticatedRequest } from '../middleware/auth'
import type { Settings, EtiquetteItem } from '../types'

const DEFAULT_REGION_UNITS = ['精明', '中和', '通化', '正宗', '賢德']

const DEFAULT_ETIQUETTE_NAMES = [
  '問好禮', '奉茶禮', '獻香禮', '叩首禮', '合同禮',
  '鞠躬禮', '奉經禮', '請示禮', '送別禮', '迎賓禮',
  '拜師禮', '謝師禮', '開光禮', '祭祖禮', '點道禮',
  '過關禮', '還願禮', '超薦禮', '佛規禮節', '進階禮節',
]

const router = Router()
router.use(requireAuth)

// ─── GET /api/settings — Settings + etiquette items ──────────────────────────

router.get('/', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const db = getDB()

  const [settings, etiquetteItems] = await Promise.all([
    db.collection<Settings>('settings').findOne({ _id: 'main' }),
    db.collection<EtiquetteItem>('etiquette_items')
      .find({ isActive: true })
      .sort({ order: 1 })
      .toArray(),
  ])

  res.json({
    success: true,
    data: {
      regionUnits: settings?.regionUnits ?? DEFAULT_REGION_UNITS,
      etiquetteItems: etiquetteItems.map(e => ({
        id: e._id,
        name: e.name,
        order: e.order,
        isActive: e.isActive,
      })),
    },
  })
})

// ─── POST /api/settings/region-units — Add region unit (TopAdmin) ─────────────

router.post('/region-units', requireTopAdmin, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { unit } = req.body as { unit: string }
  if (!unit?.trim()) {
    res.status(400).json({ success: false, error: 'unit is required' })
    return
  }

  const db = getDB()
  await db.collection<Settings>('settings').updateOne(
    { _id: 'main' },
    { $addToSet: { regionUnits: unit.trim() } },
    { upsert: true },
  )
  res.json({ success: true })
})

// ─── POST /api/settings/init — Initialize defaults (idempotent) ───────────────

router.post('/init', requireTopAdmin, async (_req, res: Response): Promise<void> => {
  const db = getDB()

  // Settings
  await db.collection<Settings>('settings').updateOne(
    { _id: 'main' },
    { $setOnInsert: { _id: 'main', regionUnits: DEFAULT_REGION_UNITS } },
    { upsert: true },
  )

  // Etiquette items: upsert each so concurrent init calls don't race on insertMany.
  const items: EtiquetteItem[] = DEFAULT_ETIQUETTE_NAMES.map((name, i) => ({
    _id: `item_${String(i + 1).padStart(2, '0')}`,
    name,
    order: i + 1,
    isActive: true,
  }))
  await db.collection<EtiquetteItem>('etiquette_items').bulkWrite(
    items.map(item => ({
      updateOne: {
        filter: { _id: item._id },
        update: { $setOnInsert: item },
        upsert: true,
      },
    })),
  )

  res.json({ success: true })
})

export default router
