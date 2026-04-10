import type { EtiquetteItem, EtiquetteStatus } from '../types'

// ─── 型別 ─────────────────────────────────────────────────

export interface ParsedMemberRow {
  name: string
  birthday: string
  mentor: string
  regionUnit: string
  regionNumber: string
  initialAttendanceCount: number
  notes: string
  etiquetteItems: Record<string, EtiquetteStatus>
  rowIndex: number
}

export interface ParseError {
  rowIndex: number | null   // null = 前置錯誤
  message: string
}

export interface ParseResult {
  rows: ParsedMemberRow[]
  errors: ParseError[]
}

// ─── 常數 ─────────────────────────────────────────────────

const FIXED_HEADERS = ['姓名', '生日', '引保師', '區域單位', '區域號碼', '既有堂數', '備註'] as const

const MAX_ROWS = 500

// ─── 解析輔助 ─────────────────────────────────────────────

/** 處理引號欄位（RFC 4180 style） */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = false
      } else {
        current += ch
      }
    } else {
      if (ch === '"') { inQuotes = true }
      else if (ch === ',') { result.push(current); current = '' }
      else { current += ch }
    }
  }
  result.push(current)
  return result
}

function mapEtiquetteValue(raw: string): EtiquetteStatus | null {
  const v = raw.trim()
  if (!v) return null
  if (v === '通過' || v === '✓') return 'passed'
  if (v === '準備中' || v === '準') return 'preparing'
  if (v === '未通過' || v === '✗') return 'failed'
  return null
}

// ─── 主解析函式 ───────────────────────────────────────────

export function parseMembers(raw: string, etiquetteItems: EtiquetteItem[]): ParseResult {
  // 移除 BOM、統一換行
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter(l => l.trim() !== '')

  if (lines.length < 2) {
    return { rows: [], errors: [{ rowIndex: null, message: 'CSV 格式錯誤：缺少標題列或資料列' }] }
  }

  const headers = parseCSVLine(lines[0]).map(h => h.trim())

  // 前置驗證：必須有「姓名」欄
  if (!headers.includes('姓名')) {
    return { rows: [], errors: [{ rowIndex: null, message: 'CSV 缺少「姓名」欄位，請確認格式是否正確' }] }
  }

  // 前置驗證：資料列數量上限
  const dataLines = lines.slice(1)
  if (dataLines.length > MAX_ROWS) {
    return { rows: [], errors: [{ rowIndex: null, message: `一次最多匯入 ${MAX_ROWS} 列，目前有 ${dataLines.length} 列` }] }
  }

  // 建立禮節 name → id Map
  const etiquetteNameToId = new Map<string, string>(
    etiquetteItems.map(item => [item.name, item.id]),
  )

  // 判斷哪些 header 是禮節欄位
  const etiquetteHeaderIndices = new Map<number, string>() // colIndex → itemId
  headers.forEach((h, idx) => {
    if (FIXED_HEADERS.includes(h as typeof FIXED_HEADERS[number])) return
    const itemId = etiquetteNameToId.get(h)
    if (itemId) etiquetteHeaderIndices.set(idx, itemId)
  })

  const rows: ParsedMemberRow[] = []
  const errors: ParseError[] = []

  dataLines.forEach((line, lineIdx) => {
    const rowIndex = lineIdx + 2  // 1-based, header is row 1
    const cells = parseCSVLine(line).map(c => c.trim())
    const get = (col: string) => cells[headers.indexOf(col)] ?? ''

    const name = get('姓名')
    if (!name) {
      errors.push({ rowIndex, message: '姓名為空，已跳過此列' })
      return
    }

    // 生日解析：MM/DD → MM-DD
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

    // 既有堂數
    const rawCount = get('既有堂數')
    const initialAttendanceCount = rawCount ? Math.max(0, parseInt(rawCount) || 0) : 0

    // 禮節欄位
    const etiquetteMap: Record<string, EtiquetteStatus> = {}
    etiquetteHeaderIndices.forEach((itemId, colIdx) => {
      const raw = cells[colIdx] ?? ''
      const status = mapEtiquetteValue(raw)
      if (status) etiquetteMap[itemId] = status
    })

    rows.push({
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

  return { rows, errors }
}

// ─── 範本下載 ─────────────────────────────────────────────

export function downloadTemplate(etiquetteItems: EtiquetteItem[]): void {
  const headers = [...FIXED_HEADERS, ...etiquetteItems.map(i => i.name)]
  const exampleRow = [
    '王小明', '03/15', '張引保', '精明', '1', '0', '備註範例',
    ...etiquetteItems.map((_, idx) => idx === 0 ? '通過' : idx === 1 ? '準備中' : ''),
  ]

  const rows = [headers, exampleRow]
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob(['\uFEFF' + rows], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '班員匯入範本.csv'
  a.click()
  URL.revokeObjectURL(url)
}
