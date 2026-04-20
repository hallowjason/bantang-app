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
  dateLabel: string   // raw text shown on page, e.g. "115/04/20"
  rocDate: string     // normalized ROC date "YYY/MM/DD"
  formUrl: string     // URL to the attendance form for this session
}

export interface AttendanceMemberEntry {
  name: string
  presentFieldName?: string    // form input name for marking present
  presentFieldValue?: string   // value to submit when marking present
}

/**
 * Parse the session list on the class presence page.
 * Each session entry links to the actual attendance form.
 *
 * Note: This is a best-effort parser. Keywords and link patterns
 * may need adjustment after observing real iccf HTML.
 */
export function parseAttendanceSessions(html: string): AttendanceSessionEntry[] {
  const $ = cheerio.load(html)
  const results: AttendanceSessionEntry[] = []

  // iccf typically lists sessions as links containing ROC dates
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const text = $(el).text().replace(/\s+/g, ' ').trim()

    // Look for links that point to the attendance form
    if (!href.includes('class_pres') && !href.includes('pres5')) return

    // Try to extract a date pattern from the link text or URL
    // ROC date patterns: "115/04/20" or "115年04月20日"
    const dateMatch =
      text.match(/(\d{2,3})[\/年](\d{1,2})[\/月](\d{1,2})/) ??
      href.match(/(\d{2,3})[\/](\d{1,2})[\/](\d{1,2})/)

    if (!dateMatch) return

    const rocDate = `${dateMatch[1]}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3].padStart(2, '0')}`

    results.push({
      dateLabel: text || rocDate,
      rocDate,
      formUrl: href,
    })
  })

  return results
}

/**
 * Parse the attendance form page to extract member rows.
 * Each row should have the member's name and the form field to mark presence.
 *
 * Note: This is a best-effort parser. Field names and table structure
 * may need adjustment after observing real iccf HTML.
 */
export function parseAttendanceMemberList(html: string): AttendanceMemberEntry[] {
  const $ = cheerio.load(html)
  const results: AttendanceMemberEntry[] = []

  // Common pattern: table rows with member name + checkbox/radio
  $('tr').each((_, row) => {
    const $row = $(row)
    const nameCell = $row.find('td').first()
    const name = nameCell.text().replace(/\s+/g, '').trim()

    if (!name || name.length < 2 || name.length > 5) return // skip non-name cells

    // Look for a checkbox or radio that marks presence
    const checkbox = $row.find('input[type="checkbox"], input[type="radio"]')
    if (checkbox.length === 0) return

    const fieldName = checkbox.first().attr('name')
    const fieldValue = checkbox.first().attr('value') ?? '1'

    if (!fieldName) return

    results.push({
      name,
      presentFieldName: fieldName,
      presentFieldValue: fieldValue,
    })
  })

  return results
}
