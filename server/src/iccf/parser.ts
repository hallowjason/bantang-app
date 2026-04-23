import * as cheerio from 'cheerio'

export type IccfSyncStatus =
  | 'synced'
  | 'not_found'
  | 'name_mismatch'
  | 'duplicate'
  | 'forbidden'
  | 'error'

export interface AddMemberResult {
  status: IccfSyncStatus
  iccfMemberId?: string
  message?: string
}

/**
 * Parse the result page after a 補入 attempt.
 */
export function parseAddMemberResult(html: string): AddMemberResult {
  const $ = cheerio.load(html)
  const text = $('body').text().replace(/\s+/g, ' ').trim()

  if (
    text.includes('新增成功') ||
    text.includes('補入成功') ||
    text.includes('已新增') ||
    text.includes('新增完成')
  ) {
    const idMatch = html.match(/mbr_id=(\d+)/) ?? html.match(/class_mbr_id=(\d+)/)
    return { status: 'synced', iccfMemberId: idMatch?.[1] }
  }

  if (
    text.includes('已在班') ||
    text.includes('已加入') ||
    text.includes('重複') ||
    text.includes('已存在')
  ) {
    return { status: 'duplicate', message: '班員已在此班' }
  }

  if (
    text.includes('查無資料') ||
    text.includes('找不到') ||
    text.includes('無符合') ||
    text.includes('查無此人')
  ) {
    return { status: 'not_found', message: 'iccf 查無此姓名' }
  }

  if (text.includes('請選擇') || text.includes('搜尋結果') || text.includes('查詢結果')) {
    return { status: 'name_mismatch', message: 'iccf 找到多筆或姓名不完全符合，請手動確認' }
  }

  if (text.includes('無權限') || text.includes('權限不足') || text.includes('forbidden')) {
    return { status: 'forbidden', message: '您沒有操作此班的權限' }
  }

  return { status: 'error', message: `無法解析 iccf 回應（${text.slice(0, 80)}）` }
}

export type IccfClassStatus = 'active' | 'ended' | 'joint_ended'

export interface ParsedIccfClass {
  classCode: string
  className: string
  iccfClassCode: string
  status: IccfClassStatus
}

/**
 * Parse the 班務 page (select_class_service5.php) to extract class entries.
 * Returns entries with both the sec_code (e.g. "TWC") and B-number (e.g. "B3000549").
 *
 * Each entry carries a status parsed from the iccf row badge:
 *   - <b>上課中</b>   → 'active'
 *   - <b>聯班結業</b> → 'joint_ended'
 *   - <b>已結班</b>   → 'ended'
 *
 * Includes BOTH active and ended rows. Callers that only need current classes
 * must filter by status === 'active'.
 */
export function parseClassServiceList(html: string): ParsedIccfClass[] {
  const $ = cheerio.load(html)
  const results: ParsedIccfClass[] = []
  const seen = new Set<string>()

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const bMatch = href.match(/[?&]class_code=(B\d+)/)
    const secMatch = href.match(/[?&]class_sec_code=([A-Z][A-Z0-9]*)/)
    if (!bMatch || !secMatch) return

    const iccfClassCode = bMatch[1]
    const classCode = secMatch[1]
    if (seen.has(iccfClassCode)) return
    seen.add(iccfClassCode)

    const $row = $(el).closest('tr')
    const rowHtml = $.html($row) ?? ''

    // Status badges are rendered as <b>上課中</b> / <b>已結班</b> / <b>聯班結業</b>.
    // Match inside <b>…</b> so non-badge mentions (e.g. filter dropdown labels)
    // don't leak in when the parser is given a fuller page snapshot.
    let status: IccfClassStatus | null = null
    if (/<b>\s*上課中\s*<\/b>/.test(rowHtml)) status = 'active'
    else if (/<b>\s*聯班結業\s*<\/b>/.test(rowHtml)) status = 'joint_ended'
    else if (/<b>\s*已結班\s*<\/b>/.test(rowHtml)) status = 'ended'
    if (!status) return

    const nameLink = $row.find('a[href*="show_classmbr5"]').first()
    const className = nameLink.text().trim() || iccfClassCode

    results.push({ classCode, iccfClassCode, className, status })
  })

  return results
}

/**
 * @deprecated Use parseClassServiceList instead.
 * Parse the class selection nav page — kept for fallback only.
 */
export function parseClassList(
  html: string,
): Array<{ classCode: string; className: string; iccfClassCode?: string }> {
  const $ = cheerio.load(html)
  const results: Array<{ classCode: string; className: string; iccfClassCode?: string }> = []
  const seen = new Set<string>()

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const m = href.match(/[?&]?sec_class=([A-Z][A-Z0-9]*)/)
    if (!m || seen.has(m[1])) return
    seen.add(m[1])

    const codeMatch = href.match(/(?:^|[?&])class_code=([A-Z][A-Z0-9]+)/)

    results.push({
      classCode: m[1],
      iccfClassCode: codeMatch?.[1],
      className: $(el).text().trim() || m[1],
    })
  })

  return results
}

// ─── Course session list (show_course_pres5.php) ──────────

export interface CourseSessionEntry {
  seq: string           // session number, e.g. "10"
  gregDate: string      // YYYY-MM-DD
  status: string        // "上過" | "待上" | "停課" | ""
  attendanceUrl: string // relative URL to show_present5.php
  setupUrl: string      // relative URL to edit_course_single_adv5.php (from window.open)
}

/**
 * Parse the course/session list page (show_course_pres5.php).
 *
 * Each row has:
 *   - A link to show_present5.php?...&class_date=YYYY-MM-DD&seq=+N... (course name cell)
 *   - A window.open call to edit_course_single_adv5.php (status cell)
 *   - Status text: "上過" / "待上" / "停課"
 */
export function parseCourseSessionList(html: string): CourseSessionEntry[] {
  const $ = cheerio.load(html)
  const results: CourseSessionEntry[] = []
  const seen = new Set<string>()

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (!href.includes('show_present5.php')) return

    const dateMatch = href.match(/class_date=(\d{4}-\d{2}-\d{2})/)
    if (!dateMatch) return

    const gregDate = dateMatch[1]
    if (seen.has(gregDate)) return
    seen.add(gregDate)

    const seqMatch = href.match(/[?&]seq=([+\s\d]+)/)
    const seq = (seqMatch?.[1] ?? '').replace(/^\++\s*/, '').trim()

    const $row = $(el).closest('tr')
    const rowHtml = $.html($row) ?? ''
    const rowText = $row.text()

    const setupMatch = rowHtml.match(
      /window\.open\(['"]([^'"]*edit_course_single_adv5[^'"]*)['"]/i,
    )
    const setupUrl = setupMatch?.[1] ?? ''

    const status = rowText.includes('上過') ? '上過'
      : rowText.includes('停課') ? '停課'
      : '待上'

    results.push({ seq, gregDate, status, attendanceUrl: href, setupUrl })
  })

  return results
}

// ─── Attendance form (show_present5.php) ──────────────────

export interface AttendanceSessionEntry {
  dateLabel: string
  gregDate: string
  formUrl: string
}

export interface AttendanceMemberEntry {
  name: string
  presentFieldName?: string
  presentFieldValue?: string
  leaveFieldName?: string
  leaveFieldValue?: string
}

/**
 * Parse the session list on the class presence page.
 * Kept for backward-compat; primary path now uses parseCourseSessionList.
 */
export function parseAttendanceSessions(html: string): AttendanceSessionEntry[] {
  const $ = cheerio.load(html)
  const results: AttendanceSessionEntry[] = []
  const seen = new Set<string>()

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const text = $(el).text().replace(/\s+/g, ' ').trim()

    if (!href.includes('show_present5.php') && !href.includes('class_present')) return

    const gregMatch = href.match(/class_date=(\d{4}-\d{2}-\d{2})/)
    if (!gregMatch) return

    const gregDate = gregMatch[1]
    if (seen.has(gregDate)) return
    seen.add(gregDate)

    results.push({ dateLabel: text || gregDate, gregDate, formUrl: href })
  })

  return results
}

/**
 * Parse the attendance form page (show_present5.php).
 *
 * Real iccf structure:
 *   - name[i] hidden inputs hold member names
 *   - present_o[i]=O (出席), present_x[i]=X (缺席), present_a[i]=A (請假)
 */
export function parseAttendanceMemberList(html: string): AttendanceMemberEntry[] {
  const $ = cheerio.load(html)
  const results: AttendanceMemberEntry[] = []

  $('input').each((_, el) => {
    const fieldName = $(el).attr('name')?.trim() ?? ''
    const value = $(el).attr('value')?.trim() ?? ''
    const type = ($(el).attr('type') ?? '').toLowerCase()

    if (type !== 'hidden' && type !== '') return
    const m = fieldName.match(/^name\[(\d+)\]$/)
    if (!m || !value) return

    const i = parseInt(m[1])
    results.push({
      name: value,
      presentFieldName: `present_o[${i}]`,
      presentFieldValue: 'O',
      leaveFieldName: `present_a[${i}]`,
      leaveFieldValue: 'A',
    })
  })

  return results
}
