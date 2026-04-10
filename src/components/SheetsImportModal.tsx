import { useState, useEffect } from 'react'
import { getEtiquetteItems } from '../lib/api/settings'
import { getMembers, addMember, updateMember } from '../lib/api/members'
import { getAllClasses } from '../lib/api/admin'
import { requestSheetsAccess, getSheetsToken } from '../lib/google/sheetsAuth'
import { fetchAndParseMemberSheet, MEMBER_IMPORT_SHEET_ID } from '../lib/google/memberImport'
import type { EtiquetteItem, Member } from '../types'

// ─── Props ────────────────────────────────────────────────

interface Props {
  classId: string
  userId: string
  onClose: () => void
  onImported: () => void
}

type Phase = 'loading' | 'auth' | 'ready' | 'preview' | 'importing' | 'done' | 'error'

// ─── 主元件 ───────────────────────────────────────────────

export default function SheetsImportModal({ classId, userId, onClose, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [className, setClassName] = useState('')
  const [etiquetteItems, setEtiquetteItems] = useState<EtiquetteItem[]>([])
  const [existingMembers, setExistingMembers] = useState<Member[]>([])
  const [loadError, setLoadError] = useState('')

  // preview state
  const [parseResult, setParseResult] = useState<Awaited<ReturnType<typeof fetchAndParseMemberSheet>> | null>(null)
  const [addCount, setAddCount] = useState(0)
  const [updateCount, setUpdateCount] = useState(0)

  // done state
  const [doneAdded, setDoneAdded] = useState(0)
  const [doneUpdated, setDoneUpdated] = useState(0)
  const [importError, setImportError] = useState('')

  const [authing, setAuthing] = useState(false)
  const [reading, setReading] = useState(false)

  // 預載：etiquette items + 現有班員 + 班級名稱
  useEffect(() => {
    Promise.all([
      getEtiquetteItems(),
      getMembers(classId),
      getAllClasses(),
    ]).then(([items, members, classes]) => {
      setEtiquetteItems(items)
      setExistingMembers(members)
      const cls = classes.find(c => c.id === classId)
      if (!cls) {
        setLoadError('找不到班級資料')
        setPhase('error')
        return
      }
      setClassName(cls.name)
      // 若已有 Sheets token 直接進入 ready
      setPhase(getSheetsToken() ? 'ready' : 'auth')
    }).catch(() => {
      setLoadError('載入資料失敗，請關閉後重試')
      setPhase('error')
    })
  }, [classId])

  // ── 授權 ──
  const handleAuth = async () => {
    setAuthing(true)
    try {
      await requestSheetsAccess()
      setPhase('ready')
    } catch {
      setLoadError('Google 授權失敗，請再試一次')
    } finally {
      setAuthing(false)
    }
  }

  // ── 讀取試算表 ──
  const handleRead = async () => {
    const token = getSheetsToken()
    if (!token) { setPhase('auth'); return }

    setReading(true)
    try {
      const result = await fetchAndParseMemberSheet(token, className, etiquetteItems)
      setParseResult(result)

      const existingNames = new Set(existingMembers.map(m => m.name))
      let willAdd = 0, willUpdate = 0
      result.rows.forEach(r => existingNames.has(r.name) ? willUpdate++ : willAdd++)
      setAddCount(willAdd)
      setUpdateCount(willUpdate)
      setPhase('preview')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'SHEETS_AUTH_EXPIRED') {
        setPhase('auth')
      } else if (msg.startsWith('SHEET_TAB_NOT_FOUND')) {
        setLoadError(`試算表中找不到分頁「${className}」，請確認班級名稱與分頁名稱一致`)
        setPhase('error')
      } else {
        setLoadError('讀取試算表失敗：' + msg)
        setPhase('error')
      }
    } finally {
      setReading(false)
    }
  }

  // ── 匯入 ──
  const handleImport = async () => {
    if (!parseResult) return
    setPhase('importing')
    setImportError('')

    const nameToMember = new Map(existingMembers.map(m => [m.name, m]))
    let added = 0, updated = 0
    const today = new Date().toISOString().slice(0, 10)

    try {
      await Promise.all(
        parseResult.rows.map(async row => {
          const existing = nameToMember.get(row.name)

          if (existing) {
            // 更新：只傳有填值的欄位，空白略過
            const patch: Record<string, unknown> = {}
            if (row.birthday)                          patch.birthday = row.birthday
            if (row.mentor)                            patch.mentor = row.mentor
            if (row.regionUnit)                        patch.regionUnit = row.regionUnit
            if (row.regionNumber)                      patch.regionNumber = row.regionNumber
            if (row.notes)                             patch.notes = row.notes
            if (row.initialAttendanceCount > 0)        patch.initialAttendanceCount = row.initialAttendanceCount
            if (Object.keys(row.etiquetteItems).length > 0) patch.etiquetteItems = row.etiquetteItems
            if (Object.keys(patch).length > 0) await updateMember(existing.id, patch)
            updated++
          } else {
            // 新增：完整建立，空白欄位用預設值
            await addMember({
              name: row.name,
              birthday: row.birthday,
              mentor: row.mentor,
              regionUnit: row.regionUnit,
              regionNumber: row.regionNumber,
              initialAttendanceCount: row.initialAttendanceCount,
              notes: row.notes,
              etiquetteItems: row.etiquetteItems,
              createdAt: today,
              createdBy: userId,
            }, classId, userId)
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

  const fatalErrors = parseResult?.errors.filter(e => e.rowIndex === null) ?? []
  const rowErrors   = parseResult?.errors.filter(e => e.rowIndex !== null) ?? []

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${MEMBER_IMPORT_SHEET_ID}/edit`

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl px-5 pt-4 pb-10 flex flex-col gap-5 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto shrink-0" />

        <div className="flex items-start justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-800">從試算表匯入</h2>
            {className && (
              <p className="text-xs text-gray-400 mt-0.5">讀取分頁：{className}</p>
            )}
          </div>
          <a
            href={sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-amber-700 border border-amber-300 px-2.5 py-1.5 rounded-lg hover:bg-amber-50 shrink-0"
          >
            開啟試算表 ↗
          </a>
        </div>

        {/* ── 載入中 ── */}
        {phase === 'loading' && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* ── 錯誤 ── */}
        {phase === 'error' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {loadError}
            </p>
            <button onClick={onClose}
              className="py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-600">
              關閉
            </button>
          </div>
        )}

        {/* ── 需要授權 ── */}
        {phase === 'auth' && (
          <div className="flex flex-col gap-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-sm font-medium text-amber-800">需要授權 Google 試算表</p>
              <p className="text-sm text-amber-700 mt-0.5">
                點擊下方按鈕，授權本應用程式讀取試算表資料。
              </p>
            </div>
            <button
              onClick={handleAuth}
              disabled={authing}
              className="py-3 rounded-xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 disabled:opacity-50"
            >
              {authing ? '授權中...' : '授權 Google'}
            </button>
            <button onClick={onClose}
              className="py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-600">
              取消
            </button>
          </div>
        )}

        {/* ── 已授權，可讀取 ── */}
        {phase === 'ready' && (
          <div className="flex flex-col gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <p className="text-sm text-green-700">
                將讀取試算表中的「{className}」分頁，比對同名班員並覆蓋更新。
              </p>
            </div>
            <p className="text-xs text-gray-400">
              請先在試算表「{className}」分頁填寫好班員資料，再點擊讀取。
            </p>
            <button
              onClick={handleRead}
              disabled={reading}
              className="py-3 rounded-xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 disabled:opacity-50"
            >
              {reading ? '讀取中...' : '讀取試算表'}
            </button>
            <button onClick={onClose}
              className="py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-600">
              取消
            </button>
          </div>
        )}

        {/* ── 預覽 ── */}
        {phase === 'preview' && parseResult && (
          <div className="flex flex-col gap-4">
            {fatalErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {fatalErrors.map((e, i) => (
                  <p key={i} className="text-sm text-red-600">{e.message}</p>
                ))}
              </div>
            )}

            {fatalErrors.length === 0 && (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-sm font-medium text-amber-800">
                    共 {parseResult.rows.length} 筆資料
                  </p>
                  <p className="text-sm text-amber-700 mt-0.5">
                    將新增 {addCount} 人・更新 {updateCount} 人
                  </p>
                </div>

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

                <div className="flex gap-3">
                  <button
                    onClick={() => setPhase('ready')}
                    className="flex-1 py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    重新讀取
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={parseResult.rows.length === 0}
                    className="flex-1 py-3 rounded-xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 disabled:opacity-50"
                  >
                    開始匯入
                  </button>
                </div>
              </>
            )}

            <button onClick={onClose}
              className="py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-600">
              取消
            </button>
          </div>
        )}

        {/* ── 匯入中 ── */}
        {phase === 'importing' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">匯入中，請稍候...</p>
          </div>
        )}

        {/* ── 完成 ── */}
        {phase === 'done' && (
          <div className="flex flex-col gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4">
              <p className="text-sm font-medium text-green-800">匯入完成！</p>
              <p className="text-sm text-green-700 mt-0.5">
                新增 {doneAdded} 人・更新 {doneUpdated} 人
              </p>
            </div>
            <button
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
