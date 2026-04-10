import { clearSheetsToken } from './sheetsAuth'
import type { EtiquetteItem, EtiquetteStatus } from '../../types'
import type { ParsedMemberRow, ParseError, ParseResult } from '../csvImport'

const SHEET_ID = import.meta.env.VITE_MEMBER_IMPORT_SHEET_ID as string

// ─── Sheets API 讀取 ──────────────────────────────────────

async function fetchTabValues(
  accessToken: string,
  tabName: string,
): Promise<string[][]> {
  const encoded = encodeURIComponent(tabName)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encoded}`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (res.status === 401) {
    clearSheetsToken()
    throw new Error('SHEETS_AUTH_EXPIRED')
  }

  if (res.status === 400 || res.status === 404) {
    throw new Error(`SHEET_TAB_NOT_FOUND:${tabName}`)
  }

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Sheets API 錯誤：${res.status} ${err}`)
  }

  const json = await res.json()
  return (json.values as string[][]) ?? []
}

// ─── 解析邏輯（與 csvImport.ts 相同核心） ────────────────

const FIXED_HEADERS = ['姓名', '生日', '引保師', '區域單位', '區域號碼', '既有堂數', '備註']

function mapEtiquetteValue(raw: string): EtiquetteStatus | null {
  const v = raw.trim()
  if (!v) return null
  if (v === '通過' || v === '✓') return 'passed'
  if (v === '準備中' || v === '準') return 'preparing'
  if (v === '未通過' || v === '✗') return 'failed'
  return null
}

function parseRows(
  rows: string[][],
  etiquetteItems: EtiquetteItem[],
): ParseResult {
  if (rows.length < 2) {
    return { rows: [], errors: [{ rowIndex: null, message: '試算表無資料列' }] }
  }

  // 第 1 列是標題，第 2 列是說明（略過），第 3 列起是資料
  const headers = rows[0].map(h => h.trim())

  if (!headers.includes('姓名')) {
    return { rows: [], errors: [{ rowIndex: null, message: '試算表缺少「姓名」欄位，請確認分頁格式' }] }
  }

  const etiquetteNameToId = new Map<string, string>(
    etiquetteItems.map(item => [item.name, item.id]),
  )

  const etiquetteHeaderIndices = new Map<number, string>()
  headers.forEach((h, idx) => {
    if (FIXED_HEADERS.includes(h)) return
    const itemId = etiquetteNameToId.get(h)
    if (itemId) etiquetteHeaderIndices.set(idx, itemId)
  })

  const parsedRows: ParsedMemberRow[] = []
  const errors: ParseError[] = []

  // 跳過第 2 列（說明列），從第 3 列開始（index 2）
  const dataRows = rows.length > 2 ? rows.slice(2) : rows.slice(1)

  dataRows.forEach((row, i) => {
    const rowIndex = i + 3  // 顯示給使用者看的列號（1-based + header + hint）
    const get = (col: string) => (row[headers.indexOf(col)] ?? '').trim()

    const name = get('姓名')
    if (!name) return  // 空列靜默略過

    // 生日 MM/DD → MM-DD
    let birthday = ''
    const rawBirthday = get('生日')
    if (rawBirthday) {
      const match = rawBirthday.match(/^(\d{1,2})\/(\d{1,2})$/)
      if (!match) {
        errors.push({ rowIndex, message: `第 ${rowIndex} 列生日格式錯誤（應為 MM/DD）：${rawBirthday}` })
      } else {
        const month = parseInt(match[1])
        const day = parseInt(match[2])
        if (month < 1 || month > 12) {
          errors.push({ rowIndex, message: `第 ${rowIndex} 列生日月份無效：${rawBirthday}` })
        } else {
          birthday = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        }
      }
    }

    const rawCount = get('既有堂數')
    const initialAttendanceCount = rawCount ? Math.max(0, parseInt(rawCount) || 0) : 0

    const etiquetteMap: Record<string, EtiquetteStatus> = {}
    etiquetteHeaderIndices.forEach((itemId, colIdx) => {
      const raw = row[colIdx] ?? ''
      const status = mapEtiquetteValue(raw)
      if (status) etiquetteMap[itemId] = status
    })

    parsedRows.push({
      name,
      birthday,
      mentor: get('引保師'),
      regionUnit: get('區域單位'),
      regionNumber: get('區域號碼'),
      initialAttendanceCount,
      notes: get('備註'),
      etiquetteItems: etiquetteMap,
      rowIndex,
    })
  })

  return { rows: parsedRows, errors }
}

// ─── 對外主函式 ───────────────────────────────────────────

export async function fetchAndParseMemberSheet(
  accessToken: string,
  tabName: string,
  etiquetteItems: EtiquetteItem[],
): Promise<ParseResult> {
  const rawRows = await fetchTabValues(accessToken, tabName)
  return parseRows(rawRows, etiquetteItems)
}

export { SHEET_ID as MEMBER_IMPORT_SHEET_ID }
