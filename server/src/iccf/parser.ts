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
 * iccf is an old PHP system that often returns alert+redirect pages, and
 * inlines `<style>` blocks inside `<body>`. cheerio's `.text()` includes
 * `<style>` and `<script>` content, so we strip those first — otherwise the
 * keyword-matching is competing with CSS rules and the error fallthrough
 * message ends up looking like `A:link {color: blue}...`.
 *
 * We also harvest any `alert('…')` payloads from the raw HTML, since iccf
 * often shows status messages that way. Alert text takes priority over
 * body text when both are present.
 */
export function parseAddMemberResult(html: string): AddMemberResult {
  // Strip style/script/noscript from the cheerio DOM only; the raw `html`
  // string is preserved so we can run alert-regex extraction below. Removing
  // these tags from the DOM prevents `$('body').text()` from pulling CSS
  // content (e.g. `A:link {color: blue}`) into our keyword matcher.
  const $ = cheerio.load(html)
  $('style, script, noscript').remove()
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()

  // Pull alert messages out of the raw HTML string. Known limitations:
  //  - Backslash-escaped quotes inside the alert payload (e.g. `alert('a\'b')`)
  //    are not captured; the regex truncates at the first inner quote.
  //  - Alerts split across newlines are not captured ([^'"] also rejects \n).
  // Both cases degrade gracefully: the parser falls through to the `error`
  // branch with an empty/short snippet — never to a wrong status.
  const alertMatches = [...html.matchAll(/alert\s*\(\s*['"]([^'"]{1,500})['"]\s*\)/g)]
  const alertText = alertMatches.map((m) => m[1]).join(' ').trim()

  // Keyword priority order (intentional — DO NOT reorder without re-checking
  // every iccf template): synced → duplicate → not_found → name_mismatch →
  // forbidden. `synced` runs first because a successful 補入 page is the
  // strongest signal; the duplicate keywords (`已加入`, `已在班`) are weaker
  // and could appear as flavor text on confirmation pages.
  const text = `${alertText} ${bodyText}`.trim()

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

  // Keep these keywords specific to "no records found" contexts. Bare
  // `無資料` was rejected as too broad — it appears in unrelated form
  // validation messages (e.g. "輸入無資料格式錯誤").
  if (
    text.includes('查無資料') ||
    text.includes('找不到') ||
    text.includes('無符合') ||
    text.includes('查無此人') ||
    text.includes('無此資料') ||
    text.includes('沒有資料') ||
    text.includes('未找到')
  ) {
    return { status: 'not_found', message: 'iccf 查無此姓名' }
  }

  if (text.includes('請選擇') || text.includes('搜尋結果') || text.includes('查詢結果')) {
    return { status: 'name_mismatch', message: 'iccf 找到多筆或姓名不完全符合，請手動確認' }
  }

  if (text.includes('無權限') || text.includes('權限不足') || text.includes('forbidden')) {
    return { status: 'forbidden', message: '您沒有操作此班的權限' }
  }

  // Truly unrecognized — surface the cleanest snippet we have.
  // Prefer alert text (usually the actionable message), then visible body
  // text. If both are empty (page is style-only / blank), say so explicitly.
  const snippet = (alertText || bodyText).slice(0, 80)
  return {
    status: 'error',
    message: snippet
      ? `無法解析 iccf 回應（${snippet}）`
      : '無法解析 iccf 回應（空白頁面）',
  }
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

// ─── Class member list (show_classmbr5.php) ───────────────

export interface ClassMemberEntry {
  /** 求道名 — primary registration name on iccf */
  name: string
  /** 本名 — legal name; sometimes differs from 求道名 */
  alternateName: string
  /** 區別 cell text, e.g. "精明001" */
  regionCell: string
  /** iccf class membership id (no_mem param), e.g. "30273" */
  iccfMemberId: string
}

/**
 * Parse the class member list page (show_classmbr5.php).
 *
 * Used by the 補入 pre-check: before submitting a 補入 request, the caller
 * fetches this page and looks for an existing (name, region) match — if found,
 * we return `duplicate` immediately without going through the search/add form.
 *
 * Header row contains 「求道名 / 本名 / 區別」 among other columns. Returns
 * an empty array if the table or required headers are missing — callers
 * should treat empty as "page did not look like a class member list" and
 * fail-fast rather than assume the class is empty.
 */
export function parseClassMemberList(html: string): ClassMemberEntry[] {
  const $ = cheerio.load(html)

  let targetEl: ReturnType<typeof $>[number] | null = null
  $('table').each((_, t) => {
    const headerText = $(t).find('tr').first().text()
    if (headerText.includes('求道名') && headerText.includes('區別')) {
      targetEl = t
      return false
    }
  })
  if (!targetEl) return []

  const rows = $(targetEl).find('tr')
  if (rows.length < 2) return []

  // Map header → index so the parser stays robust if iccf reorders columns.
  let nameIdx = -1
  let altIdx = -1
  let regionIdx = -1
  $(rows[0]).find('td,th').each((i, c) => {
    const t = $(c).text().replace(/\s+/g, '').trim()
    if (t === '求道名') nameIdx = i
    else if (t === '本名') altIdx = i
    else if (t === '區別') regionIdx = i
  })
  if (nameIdx < 0 || regionIdx < 0) return []

  const results: ClassMemberEntry[] = []
  const required = Math.max(nameIdx, altIdx, regionIdx) + 1

  rows.slice(1).each((_, row) => {
    const cells = $(row).find('td')
    if (cells.length < required) return

    const name = $(cells[nameIdx]).text().replace(/\s+/g, '').trim()
    const alternateName = altIdx >= 0
      ? $(cells[altIdx]).text().replace(/\s+/g, '').trim()
      : name
    const regionCell = $(cells[regionIdx]).text().replace(/\s+/g, '').trim()
    if (!name || !regionCell) return

    // no_mem is form-encoded with '+' as spaces (e.g. "+++30273" → "30273").
    const editHref = $(row).find('a[href*="edit_classmbr5"]').first().attr('href') ?? ''
    const m = editHref.match(/no_mem=([^&]+)/)
    const iccfMemberId = m
      ? decodeURIComponent(m[1].replace(/\+/g, ' ')).replace(/\s+/g, '').trim()
      : ''

    results.push({ name, alternateName, regionCell, iccfMemberId })
  })

  return results
}

/**
 * Normalize a region key for comparison between app input and iccf display.
 *
 * App side: regionUnit ("賢德") + regionNumber ("19" or "019").
 * iccf side: 區別 cell text ("精明001").
 *
 * Rules:
 * - strip all whitespace
 * - strip trailing "區" if present
 * - zero-pad numeric tail to 3 digits
 *
 * Examples:
 *   normalizeRegionKey("賢德", "19")    → "賢德019"
 *   normalizeRegionKey("賢德", "019")   → "賢德019"
 *   normalizeRegionKey("精明 001 區")   → "精明001"
 *   normalizeRegionKey("精明001")       → "精明001"
 */
export function normalizeRegionKey(unit: string, number?: string): string {
  if (number !== undefined) {
    const u = unit.replace(/\s+/g, '').replace(/區$/, '').trim()
    const n = number.replace(/[^\d]/g, '')
    return n ? u + n.padStart(3, '0') : u
  }
  const cleaned = unit.replace(/\s+/g, '').replace(/區$/, '').trim()
  const tail = cleaned.match(/(\d+)$/)
  if (!tail) return cleaned
  const prefix = cleaned.slice(0, cleaned.length - tail[1].length)
  return prefix + tail[1].padStart(3, '0')
}
