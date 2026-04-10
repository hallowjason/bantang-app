import { useState, useEffect, useRef } from 'react'
import { getEtiquetteItems } from '../lib/api/settings'
import { getMembers, addMember, updateMember } from '../lib/api/members'
import { parseMembers } from '../lib/csvImport'
import type { EtiquetteItem, Member } from '../types'

// ─── Props ────────────────────────────────────────────────

interface Props {
  classId: string
  userId: string
  onClose: () => void
  onImported: () => void
}

type Phase = 'idle' | 'preview' | 'importing' | 'done'

// ─── 主元件 ───────────────────────────────────────────────

export default function CsvImportModal({ classId, userId, onClose, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [etiquetteItems, setEtiquetteItems] = useState<EtiquetteItem[]>([])
  const [existingMembers, setExistingMembers] = useState<Member[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  // preview state
  const [parseResult, setParseResult] = useState<ReturnType<typeof parseMembers> | null>(null)
  const [addCount, setAddCount] = useState(0)
  const [updateCount, setUpdateCount] = useState(0)

  // done state
  const [doneAdded, setDoneAdded] = useState(0)
  const [doneUpdated, setDoneUpdated] = useState(0)
  const [importError, setImportError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 預載資料
  useEffect(() => {
    Promise.all([getEtiquetteItems(), getMembers(classId)])
      .then(([items, members]) => {
        setEtiquetteItems(items)
        setExistingMembers(members)
      })
      .catch(() => setLoadError('載入資料失敗，請關閉後重試'))
  }, [classId])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = ev => {
      const raw = ev.target?.result as string
      const result = parseMembers(raw, etiquetteItems)
      setParseResult(result)

      // 計算新增/更新數
      const existingNames = new Set(existingMembers.map(m => m.name))
      let willAdd = 0
      let willUpdate = 0
      result.rows.forEach(row => {
        if (existingNames.has(row.name)) willUpdate++
        else willAdd++
      })
      setAddCount(willAdd)
      setUpdateCount(willUpdate)
      setPhase('preview')
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleImport = async () => {
    if (!parseResult) return
    setPhase('importing')
    setImportError(null)

    const nameToMember = new Map(existingMembers.map(m => [m.name, m]))
    let added = 0
    let updated = 0

    try {
      await Promise.all(
        parseResult.rows.map(async row => {
          const memberData = {
            name: row.name,
            birthday: row.birthday,
            mentor: row.mentor,
            regionUnit: row.regionUnit,
            regionNumber: row.regionNumber,
            initialAttendanceCount: row.initialAttendanceCount,
            notes: row.notes,
            etiquetteItems: row.etiquetteItems,
            createdAt: new Date().toISOString().slice(0, 10),
            createdBy: userId,
          }

          const existing = nameToMember.get(row.name)
          if (existing) {
            await updateMember(existing.id, memberData)
            updated++
          } else {
            await addMember(memberData, classId, userId)
            added++
          }
        }),
      )
      setDoneAdded(added)
      setDoneUpdated(updated)
      setPhase('done')
    } catch {
      setImportError('匯入失敗，請稍後再試')
      setPhase('preview')
    }
  }

  // ─── 前置錯誤（無法繼續） ──
  const fatalErrors = parseResult?.errors.filter(e => e.rowIndex === null) ?? []
  const rowErrors = parseResult?.errors.filter(e => e.rowIndex !== null) ?? []

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl px-5 pt-4 pb-10 flex flex-col gap-5 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto shrink-0" />

        <h2 className="text-lg font-bold text-gray-800 shrink-0">CSV 批次匯入</h2>

        {/* 載入錯誤 */}
        {loadError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
            {loadError}
          </p>
        )}

        {/* ── idle：選擇檔案 ── */}
        {phase === 'idle' && !loadError && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-500">
              選擇符合範本格式的 CSV 檔案，同名班員將被覆蓋更新。
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100"
            />
            <button
              type="button"
              onClick={onClose}
              className="py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        )}

        {/* ── preview：解析結果 ── */}
        {phase === 'preview' && parseResult && (
          <div className="flex flex-col gap-4">
            {/* 前置錯誤（阻斷型） */}
            {fatalErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex flex-col gap-1">
                {fatalErrors.map((e, i) => (
                  <p key={i} className="text-sm text-red-600">{e.message}</p>
                ))}
              </div>
            )}

            {/* 解析摘要 */}
            {fatalErrors.length === 0 && (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-sm font-medium text-amber-800">
                    共 {parseResult.rows.length} 列資料
                  </p>
                  <p className="text-sm text-amber-700 mt-0.5">
                    將新增 {addCount} 人・更新 {updateCount} 人
                  </p>
                </div>

                {/* 列錯誤（非阻斷，僅提示） */}
                {rowErrors.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex flex-col gap-1">
                    <p className="text-xs font-medium text-yellow-700 mb-1">部分列有警告（仍可繼續匯入）</p>
                    {rowErrors.map((e, i) => (
                      <p key={i} className="text-xs text-yellow-600">{e.message}</p>
                    ))}
                  </div>
                )}

                {importError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
                    {importError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleImport}
                  disabled={parseResult.rows.length === 0}
                  className="py-3 rounded-xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 disabled:opacity-50"
                >
                  開始匯入
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        )}

        {/* ── importing：寫入中 ── */}
        {phase === 'importing' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">匯入中，請稍候...</p>
          </div>
        )}

        {/* ── done：完成 ── */}
        {phase === 'done' && (
          <div className="flex flex-col gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4 flex flex-col gap-1">
              <p className="text-sm font-medium text-green-800">匯入完成！</p>
              <p className="text-sm text-green-700">
                新增 {doneAdded} 人・更新 {doneUpdated} 人
              </p>
            </div>
            <button
              type="button"
              onClick={onImported}
              className="py-3 rounded-xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800"
            >
              完成
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
