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
 *
 * iccf returns Big5-decoded HTML. We look for known success/error markers
 * in the page text. This parser is intentionally tolerant — unknown pages
 * fall through to 'error' rather than throwing.
 */
export function parseAddMemberResult(html: string): AddMemberResult {
  const $ = cheerio.load(html)
  const text = $('body').text().replace(/\s+/g, ' ').trim()

  // Success: page shows confirmation or a member ID was assigned
  if (
    text.includes('新增成功') ||
    text.includes('補入成功') ||
    text.includes('已新增') ||
    text.includes('新增完成')
  ) {
    // Try to extract iccf member id from hidden inputs or links
    const idMatch = html.match(/mbr_id=(\d+)/) ?? html.match(/class_mbr_id=(\d+)/)
    return { status: 'synced', iccfMemberId: idMatch?.[1] }
  }

  // Duplicate: member already in this class
  if (
    text.includes('已在班') ||
    text.includes('已加入') ||
    text.includes('重複') ||
    text.includes('已存在')
  ) {
    return { status: 'duplicate', message: '班員已在此班' }
  }

  // Not found: search returned 0 results
  if (
    text.includes('查無資料') ||
    text.includes('找不到') ||
    text.includes('無符合') ||
    text.includes('查無此人')
  ) {
    return { status: 'not_found', message: 'iccf 查無此姓名' }
  }

  // Name mismatch: results found but none match exactly
  // (Heuristic: result list exists but confirmation was not reached)
  if (text.includes('請選擇') || text.includes('搜尋結果') || text.includes('查詢結果')) {
    return { status: 'name_mismatch', message: 'iccf 找到多筆或姓名不完全符合，請手動確認' }
  }

  // Permission denied
  if (text.includes('無權限') || text.includes('權限不足') || text.includes('forbidden')) {
    return { status: 'forbidden', message: '您沒有操作此班的權限' }
  }

  return { status: 'error', message: `無法解析 iccf 回應（${text.slice(0, 80)}）` }
}

/**
 * Parse the class selection page to extract sec_class codes available to this leader.
 * Used during login or before addMember to confirm which class to target.
 */
export function parseClassList(html: string): Array<{ classCode: string; className: string }> {
  const $ = cheerio.load(html)
  const results: Array<{ classCode: string; className: string }> = []
  const seen = new Set<string>()

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const m = href.match(/sec_class=([A-Z]{2,3}\d+)/)
    if (m && !seen.has(m[1])) {
      seen.add(m[1])
      results.push({
        classCode: m[1],
        className: $(el).text().trim() || m[1],
      })
    }
  })

  return results
}

// ─── Attendance types ─────────────────────────────────────

export interface AttendanceSessionEntry {
  dateLabel: string   // raw text shown on page, e.g. "2026/04/01" or "第10堂"
  gregDate: string    // Gregorian date extracted from URL "YYYY-MM-DD"
  formUrl: string     // URL to the attendance form for this session
}

export interface AttendanceMemberEntry {
  name: string
  presentFieldName?: string    // form input name for marking present
  presentFieldValue?: string   // value to submit when marking present
}

/**
 * Parse the session list on the class presence page.
 * Each session entry links to show_present5.php with class_date=YYYY-MM-DD.
 *
 * Real iccf structure: links to show_present5.php?...&class_date=2026-04-01&seq=+10&...
 */
export function parseAttendanceSessions(html: string): AttendanceSessionEntry[] {
  const $ = cheerio.load(html)
  const results: AttendanceSessionEntry[] = []
  const seen = new Set<string>()

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const text = $(el).text().replace(/\s+/g, ' ').trim()

    // Match links to the attendance form page
    if (!href.includes('show_present5.php') && !href.includes('class_present')) return

    // Extract Gregorian date from URL param: class_date=YYYY-MM-DD
    const gregMatch = href.match(/class_date=(\d{4}-\d{2}-\d{2})/)
    if (!gregMatch) return

    const gregDate = gregMatch[1]
    if (seen.has(gregDate)) return
    seen.add(gregDate)

    results.push({
      dateLabel: text || gregDate,
      gregDate,
      formUrl: href,
    })
  })

  return results
}

/**
 * Parse the attendance form page (show_present5.php) to extract member rows.
 *
 * Real iccf structure:
 *   - Per-member name in hidden input: name[i] (e.g. name[0]="鍾旻翰")
 *   - Attendance checkboxes: present_o[i]=O (出席), present_x[i]=X (缺席), present_a[i]=A (請假)
 *   - Other hidden inputs: no_mem[i], class_no[i], section_name[i], present_org[i], etc.
 */
export function parseAttendanceMemberList(html: string): AttendanceMemberEntry[] {
  const $ = cheerio.load(html)
  const results: AttendanceMemberEntry[] = []

  // name[i] hidden inputs give us member names indexed by i
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
    })
  })

  return results
}
