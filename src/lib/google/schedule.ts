import { clearSheetsToken } from './sheetsAuth'
import { getAllClasses } from '../api/admin'
import { apiFetch } from '../api/client'
import type { ScheduleData, UpcomingSpeaker } from '../../types'

const SHEET_ID = import.meta.env.VITE_SHEET_ID as string

// ─── Sheets API 呼叫 ──────────────────────────────────────

async function fetchSheetValues(
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

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Sheets API 錯誤：${res.status} ${err}`)
  }

  const json = await res.json()
  return (json.values as string[][]) ?? []
}

// ─── 欄位發現（兩段式掃描） ──────────────────────────────

interface ColumnGroup {
  classLabelCol: number  // 等級班標頭所在欄（如 "禮行"）；資料列中也是講題欄
  dateCol: number        // 日期欄
  hostCol: number        // 操持欄
  speakerCol: number     // 講師欄（-1 代表未找到）
  topicCol: number       // 講題欄（-1 代表未找到；通常 = classLabelCol）
  verifyCol: number      // 驗收欄（-1 代表未找到）
}

/**
 * 掃描 Sheet 的前幾列，找出等級班標頭列、日期欄、操持欄、講師欄。
 *
 * 假設結構：
 *   Row 0: 各等級班的大標頭（如 "禮行" 橫跨幾欄，"義理" 在右側）
 *   Row 1+: 子標頭（"日期"、"課程"、"操持"、"講師"…）從對應欄位群起始
 */
function detectColumns(rows: string[][], classLabel: string): ColumnGroup {
  // --- 第一段：找等級班標頭所在欄 ---
  //
  // 課表標頭通常以「班別+講題」格式呈現（如「智勇講題」），
  // 優先搜尋同時包含 classLabel 與「講題」的格，精確定位講題欄；
  // 找不到時再退而求其次，搜尋僅包含 classLabel 的格。
  let classLabelCol = -1

  // 優先：找「班別+講題」格（如「智勇講題」）
  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const row = rows[r]
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]?.toString() ?? ''
      if (cell.includes(classLabel) && cell.includes('講題')) {
        classLabelCol = c
        break
      }
    }
    if (classLabelCol !== -1) break
  }

  // 備援：找任意包含 classLabel 的格（舊格式 / 無講題標頭）
  if (classLabelCol === -1) {
    for (let r = 0; r < Math.min(5, rows.length); r++) {
      const row = rows[r]
      for (let c = 0; c < row.length; c++) {
        if (row[c]?.toString().includes(classLabel)) {
          classLabelCol = c
          break
        }
      }
      if (classLabelCol !== -1) break
    }
  }

  if (classLabelCol === -1) {
    throw new Error(`找不到等級班標頭「${classLabel}」`)
  }

  // --- 第二段：掃描前幾列找 "日期"、"操持"、"講師" ---
  //
  // ‣ 「操持」是全分頁共用欄（位於所有班群之外），故全列掃描。
  // ‣ 「講師」屬班別欄群內（如「智勇講師」），限在 classLabelCol 附近搜尋，
  //   避免誤抓到其他班的「仁德講師」等。
  // ‣ 「日期」通常在最左側（Column A），標頭可能為空，需多重備援策略。
  let dateCol    = -1
  let hostCol    = -1
  let speakerCol = -1
  let topicCol   = -1
  let verifyCol  = -1

  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r]

    // 全列掃描：操持（全域欄）
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]?.toString().trim() ?? ''
      if (cell.includes('操持') && hostCol === -1) hostCol = c
    }

    // 班群範圍掃描：日期、講師、講題、驗收（班別專屬欄）
    for (let c = classLabelCol; c < Math.min(classLabelCol + 20, row.length); c++) {
      const cell = row[c]?.toString().trim() ?? ''
      if (cell.includes('日期') && dateCol === -1)                          dateCol = c
      if (cell.includes('講師') && speakerCol === -1)                       speakerCol = c
      if (cell.includes('講題') && topicCol === -1)                         topicCol = c
      if ((cell === '驗' || cell.includes('驗收')) && verifyCol === -1)    verifyCol = c
    }
  }

  // 若班群內找不到「日期」，改為全列掃描標頭文字
  if (dateCol === -1) {
    outer1: for (let r = 0; r < Math.min(10, rows.length); r++) {
      const row = rows[r]
      for (let c = 0; c < row.length; c++) {
        if (row[c]?.toString().trim().includes('日期')) { dateCol = c; break outer1 }
      }
    }
  }

  // 若標頭中完全沒有「日期」文字，偵測資料列中看起來像日期的欄位（如 "2/25"、"3月4日"）
  if (dateCol === -1) {
    const dateLike = /^\d{1,2}[/\-.]\d{1,2}$|^\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}$|^\d{1,2}月\d{1,2}日?$/
    outer2: for (let r = 1; r < Math.min(6, rows.length); r++) {
      const row = rows[r]
      for (let c = 0; c < Math.min(5, row.length); c++) {
        if (dateLike.test(row[c]?.toString().trim() ?? '')) { dateCol = c; break outer2 }
      }
    }
  }

  // 最後備援：Column A（index 0）幾乎一定是日期欄
  if (dateCol === -1) dateCol = 0

  if (hostCol === -1) {
    throw new Error(`在整份課表中找不到「操持」欄，請確認分頁名稱與標頭文字`)
  }

  return { classLabelCol, dateCol, hostCol, speakerCol, topicCol, verifyCol }
}

// ─── 日期比對輔助 ─────────────────────────────────────────

/**
 * 嘗試解析各種日期格式，返回 "YYYY-MM-DD" 或 null。
 * 支援：YYYY/MM/DD、YYYY-MM-DD、M/D、M月D日 等。
 */
function parseDate(raw: string, refYear: number): string | null {
  if (!raw) return null
  const s = raw.trim()

  // YYYY/MM/DD 或 YYYY-MM-DD
  const full = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
  if (full) return `${full[1]}-${full[2].padStart(2,'0')}-${full[3].padStart(2,'0')}`

  // M/D 或 MM/DD（不帶年份）
  const md = s.match(/^(\d{1,2})[/.-](\d{1,2})$/)
  if (md) return `${refYear}-${md[1].padStart(2,'0')}-${md[2].padStart(2,'0')}`

  // M月D日
  const chi = s.match(/^(\d{1,2})月(\d{1,2})日?/)
  if (chi) return `${refYear}-${chi[1].padStart(2,'0')}-${chi[2].padStart(2,'0')}`

  return null
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}


// ─── 主要解析函式 ─────────────────────────────────────────

/**
 * 從 Sheet 解析指定週次的操持人與未來 4 週講師清單。
 */
export async function fetchScheduleData(
  accessToken: string,
  tabName: string,
  classLabel: string,
  weekStart: string,  // YYYY-MM-DD（週一）
): Promise<ScheduleData> {
  const rows = await fetchSheetValues(accessToken, tabName)
  const cols = detectColumns(rows, classLabel)
  const year = parseInt(weekStart.slice(0, 4))

  // 需要的日期：本週一（weekStart）、下週一（weekStart+7）
  const thisWeekDate = weekStart
  const nextWeekDate = addDays(weekStart, 7)

  // 未來 4 週的週一日期
  const futureWeeks = [0, 1, 2, 3].map(n => addDays(weekStart, n * 7))

  // 預先計算每週的結束日（週日），避免在迴圈內重複呼叫 addDays
  const thisWeekEnd    = addDays(thisWeekDate, 6)
  const nextWeekEnd    = addDays(nextWeekDate, 6)
  const futureWeekEnds = futureWeeks.map(w => addDays(w, 6))

  // ─── 掃描習勞（打掃輪值班級）────────────────────────────
  let cleaningDuty = ''
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]?.toString().trim() ?? ''
      if (!cell.includes('習勞')) continue
      // 值可能在同一格「習勞：義理班」，或在右側格
      const sepIdx = cell.indexOf('：') !== -1 ? cell.indexOf('：') : cell.indexOf(':')
      if (sepIdx !== -1 && sepIdx < cell.length - 1) {
        cleaningDuty = cell.slice(sepIdx + 1).trim()
      } else if (c + 1 < row.length) {
        cleaningDuty = row[c + 1]?.toString().trim() ?? ''
      }
      break
    }
    if (cleaningDuty) break
  }

  let hostThisWeek = ''
  let hostNextWeek = ''
  const speakerMap: Record<string, { name: string; topic: string; verifyNeeded: boolean }> = {}

  for (const row of rows) {
    const rawDate = row[cols.dateCol] ?? ''
    const parsed  = parseDate(rawDate, year)
    if (!parsed) continue

    const host        = row[cols.hostCol]?.toString().trim() ?? ''
    const speaker     = cols.speakerCol >= 0 ? (row[cols.speakerCol]?.toString().trim() ?? '') : ''
    const topic       = cols.topicCol  >= 0 ? (row[cols.topicCol]?.toString().trim()   ?? '') : ''
    const verifyRaw   = cols.verifyCol >= 0 ? (row[cols.verifyCol]?.toString().trim()  ?? '') : ''
    const verifyNeeded = verifyRaw === 'TRUE'  // Google Sheets checkbox returns "TRUE"/"FALSE"

    // 課表上課日可能是週三/週四等任意一天；
    // 用「是否落在該週 [weekStart, weekStart+6] 範圍內」比對，避免時區偏移問題。
    if (host && parsed >= thisWeekDate && parsed <= thisWeekEnd) hostThisWeek = host
    if (host && parsed >= nextWeekDate && parsed <= nextWeekEnd) hostNextWeek = host

    if (speaker) {
      for (let i = 0; i < futureWeeks.length; i++) {
        if (parsed >= futureWeeks[i] && parsed <= futureWeekEnds[i]) {
          // 以「實際上課日」(parsed) 為 key，保留真實日期（週三班不應顯示在週一）
          if (!speakerMap[parsed]) speakerMap[parsed] = { name: speaker, topic, verifyNeeded }
          break
        }
      }
    }
  }

  const weekLabels = ['本週', '下週', '第2週', '第3週']
  // 以實際上課日排序，建立 upcomingSpeakers；date 為真實日期而非週一
  const upcomingSpeakers: UpcomingSpeaker[] = Object.entries(speakerMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([actualDate, sp]) => {
      const weekIdx = futureWeeks.findIndex(
        (wStart, i) => actualDate >= wStart && actualDate <= futureWeekEnds[i],
      )
      return {
        date:         actualDate,
        weekLabel:    weekLabels[weekIdx] ?? '其他',
        name:         sp.name,
        topic:        sp.topic,
        verifyNeeded: sp.verifyNeeded,
      }
    })

  return {
    hostThisWeek,
    hostNextWeek,
    upcomingSpeakers,
    cleaningDuty,
    syncedAt: new Date().toISOString(),
  }
}

// ─── API 快取 ─────────────────────────────────────────────

export async function getScheduleCache(
  classId: string,
  weekStart: string,
): Promise<ScheduleData | null> {
  try {
    const res = await apiFetch(`/api/schedule-cache?classId=${classId}&weekStart=${weekStart}`)
    const body = await res.json()
    return body.success ? (body.data as ScheduleData | null) : null
  } catch {
    return null
  }
}

export async function saveScheduleCache(
  classId: string,
  weekStart: string,
  data: ScheduleData,
): Promise<void> {
  await apiFetch('/api/schedule-cache', {
    method: 'POST',
    body: JSON.stringify({ classId, weekStart, data }),
  })
}

// ─── 組合：快取優先，需要時重新抓取 ─────────────────────────

/**
 * 主要對外介面：
 * 1. 若 Firestore 快取有效（< 2h）則直接返回
 * 2. 否則讀取 /classes/{classId} 取得 tabName + classLabel
 * 3. 呼叫 Sheets API 解析
 * 4. 存入快取後返回
 */
export async function getOrFetchSchedule(
  classId: string,
  accessToken: string,
  weekStart: string,
): Promise<ScheduleData> {
  // 快取命中
  const cached = await getScheduleCache(classId, weekStart)
  if (cached) return cached

  // 讀取班級的 Sheet 設定
  const classes = await getAllClasses()
  const cls = classes.find(c => c.id === classId)

  if (!cls?.sheetTabName || !cls?.sheetClassLabel) {
    throw new Error('此班別尚未設定課表分頁名稱（請在管理後台設定）')
  }

  const data = await fetchScheduleData(
    accessToken,
    cls.sheetTabName,
    cls.sheetClassLabel,
    weekStart,
  )

  await saveScheduleCache(classId, weekStart, data)
  return data
}
