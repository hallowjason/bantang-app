import axios, { AxiosInstance } from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'
import { buildBig5FormBody, encodeBig5URIComponent, decodeBig5 } from './encoding'
import { IccfError } from './errors'
import {
  parseAddMemberResult,
  parseClassServiceList,
  parseClassMemberList,
  parseCourseSessionList,
  parseAttendanceMemberList,
  normalizeRegionKey,
  type AddMemberResult,
  type AttendanceMemberEntry,
  type IccfClassStatus,
} from './parser'

export type { AddMemberResult, IccfClassStatus }

export interface MarkAttendanceResult {
  /** Members successfully marked present in iccf */
  marked: string[]
  /** Members that appeared in presentNames but not found on iccf page */
  notFound: string[]
  /** General error message if the whole operation failed */
  error?: string
}

const BASE = 'https://iccf.ikd.org.tw'
const WARM_MARKER = 'online_warm5.php'
const LOGIN_PAGE_MARKER = 'warn_change_pass5.php'

export interface IccfProfile {
  /** Display name (e.g. 蔡喬淞) */
  name: string
  /** Area / 區 (e.g. 精明019 區) */
  area: string
}

export interface IccfLoginResult {
  cookieJar: CookieJar
  profile: IccfProfile | null
  /** True if we had to force-kick a stale session during login. */
  forceKicked: boolean
}

export interface IccfClassEntry {
  classCode: string       // class_sec_code, e.g. "TWC"
  className: string
  iccfClassCode?: string  // class_code, e.g. "B3000549" — needed for course list URL
  /**
   * Row status parsed from the 班務 page.
   * Old session docs persisted before this field was added may lack it;
   * treat `undefined` as 'active' for backward-compat.
   */
  status?: IccfClassStatus
}

/**
 * Build a fresh axios instance with its own cookie jar.
 * Responses are returned as Buffer so we can Big5-decode them.
 */
function makeHttp(jar: CookieJar): AxiosInstance {
  const instance = axios.create({
    jar,
    baseURL: BASE,
    responseType: 'arraybuffer',
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  })
  return wrapper(instance)
}

async function postLogin(http: AxiosInstance, account: string, password: string): Promise<string> {
  const body = buildBig5FormBody({
    zant: account,
    zpsd: password,
    action: 'login',
    B1: '登入',
  })

  const res = await http.post('/55index.php', body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${BASE}/login5.php`,
    },
  })
  return decodeBig5(res.data as Buffer)
}

function parseLoadCall(html: string): { warm: boolean; authenticated: boolean } {
  const warm = html.includes(WARM_MARKER)
  const authenticated = html.includes(LOGIN_PAGE_MARKER) || html.includes('header_all5.php')
  return { warm, authenticated }
}

/** Fetch the topmenu after login and extract user profile (name + area). */
async function fetchProfile(http: AxiosInstance): Promise<IccfProfile | null> {
  try {
    const res = await http.get('/publicphp/header_all5.php')
    const html = decodeBig5(res.data as Buffer)
    const $ = cheerio.load(html)
    const text = $('body').text().replace(/\s+/g, ' ').trim()

    // iccf header format: "[ 中和015區 ] 登出 | ... | 改密碼 [ 簡以淳 ]"
    // Extract area from first bracket containing 區, name from last bracket of CJK chars
    const areaMatch = text.match(/\[\s*([^\]]+\d+\s*區)\s*\]/)
    const nameMatches = [...text.matchAll(/\[\s*([\u4e00-\u9fff]{2,5})\s*\]/g)]
    const name = nameMatches.at(-1)?.[1]?.trim()
    if (areaMatch && name) {
      return { area: areaMatch[1].trim(), name }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Log into iccf. Automatically force-kicks a stale session if `online_warm5`
 * appears (per user instruction #1).
 */
export async function login(account: string, password: string): Promise<IccfLoginResult> {
  if (!account?.trim() || !password?.trim()) {
    throw new IccfError('invalid_credentials', '帳號或密碼不可為空')
  }

  const jar = new CookieJar()
  const http = makeHttp(jar)

  try {
    // Step 1: hit homepage to seed PHPSESSID
    await http.get('/')

    // Step 2: first login attempt
    let html = await postLogin(http, account, password)
    let parsed = parseLoadCall(html)
    let forceKicked = false

    // Step 3: stale session? force-kick & retry
    if (parsed.warm) {
      forceKicked = true
      await http.get('/logout5.php')
      html = await postLogin(http, account, password)
      parsed = parseLoadCall(html)
      if (parsed.warm) {
        throw new IccfError('login_failed', '登入後仍被要求清除舊 session，請稍後再試')
      }
    }

    if (!parsed.authenticated) {
      throw new IccfError('invalid_credentials', '帳號或密碼錯誤')
    }

    const profile = await fetchProfile(http)

    return { cookieJar: jar, profile, forceKicked }
  } catch (e) {
    if (e instanceof IccfError) throw e
    throw new IccfError('network_error', `iccf 連線失敗: ${(e as Error).message}`, e)
  }
}

/** Logout — best effort; swallow errors so session cleanup always proceeds. */
export async function logout(jar: CookieJar): Promise<void> {
  const http = makeHttp(jar)
  try {
    await http.get('/logout5.php')
  } catch {
    // ignore
  }
}

/**
 * Ping: lightweight check that the session is still valid.
 * 'alive'       — session confirmed valid
 * 'expired'     — iccf positively rejected the session (redirect to login page)
 * 'unreachable' — network/server error; do NOT treat as expired
 */
export async function ping(jar: CookieJar): Promise<'alive' | 'expired' | 'unreachable'> {
  const http = makeHttp(jar)
  try {
    const res = await http.get('/publicphp/header_all5.php')
    const html = decodeBig5(res.data as Buffer)
    const loggedOut = html.includes('f_login') || html.includes('name=zant')
    return loggedOut ? 'expired' : 'alive'
  } catch {
    return 'unreachable'
  }
}

/**
 * Fetch the list of active classes the logged-in leader can manage.
 * Uses the 班務 page (select_class_service5.php) which contains both
 * the sec_code (e.g. "TWC") and the B-number (e.g. "B3000549").
 */
export async function listClasses(jar: CookieJar): Promise<IccfClassEntry[]> {
  const http = makeHttp(jar)
  const res = await http.get('/class/select_class_service5.php?first=T')
  const html = decodeBig5(res.data as Buffer)
  return parseClassServiceList(html)
}

/**
 * Add a member to an iccf class via the 補入 flow.
 *
 * Steps:
 *  0. Pre-check: fetch show_classmbr5.php and look for an existing
 *     (name, region) match. If found → return `duplicate` immediately
 *     without mutating iccf state.
 *  1. POST search form with name + area → get result list
 *  2. If exactly one match, follow confirmation link → get success page
 *
 * @param jar           - active session cookie jar
 * @param name          - member's name as typed in the app (matched against
 *                        iccf 求道名 / 本名)
 * @param regionUnit    - "賢德" / "精明" — combined with regionNumber for matching
 * @param regionNumber  - "19" / "019" — zero-padded to 3 digits internally
 * @param classCode     - sec_class code (e.g. "TWT")
 * @param iccfClassCode - B-number (e.g. "B7000170") — needed for show_classmbr5 URL
 */
export async function addMember(
  jar: CookieJar,
  name: string,
  regionUnit: string,
  regionNumber: string,
  classCode: string,
  iccfClassCode: string,
): Promise<AddMemberResult> {
  const http = makeHttp(jar)

  try {
    // ── Step 0: Pre-check class member list for existing (name, region) ──
    const listUrl =
      `/classmbr/show_classmbr5.php` +
      `?class_code=${encodeURIComponent(iccfClassCode)}` +
      `&class_sec_code=${encodeBig5URIComponent(classCode)}&first=T`
    const listRes = await http.get(listUrl)
    const listHtml = decodeBig5(listRes.data as Buffer)
    const existing = parseClassMemberList(listHtml)

    // Empty result + no recognizable header = page didn't render correctly
    // (session expired mid-fetch, permission issue, etc). Fail-fast.
    if (existing.length === 0 && !/求道名[\s\S]{0,200}區別/.test(listHtml)) {
      return {
        status: 'error',
        message: 'iccf 班員列表頁無法解析（可能登入過期或網路錯誤），請重試',
      }
    }

    const targetName = name.trim()
    const targetRegion = normalizeRegionKey(regionUnit, regionNumber)
    const match = existing.find(e =>
      (e.name === targetName || e.alternateName === targetName) &&
      normalizeRegionKey(e.regionCell) === targetRegion,
    )
    if (match) {
      return {
        status: 'duplicate',
        iccfMemberId: match.iccfMemberId || undefined,
        message: '班員已在此班',
      }
    }

    // ── Step 1: Load the add-member search form for this class ──
    const area = regionUnit
    const formUrl =
      `/classmbr/add_classmbr_first5.php` +
      `?label=add&class_code_head=&class_close=1&first=T&sec_class=${encodeBig5URIComponent(classCode)}`

    const formRes = await http.get(formUrl)
    const formHtml = decodeBig5(formRes.data as Buffer)

    // Extract hidden inputs from the search form
    const $form = cheerio.load(formHtml)
    const hidden: Record<string, string> = {}
    $form('input[type="hidden"]').each((_, el) => {
      const n = $form(el).attr('name')
      const v = $form(el).attr('value') ?? ''
      if (n) hidden[n] = v
    })

    // Determine the search action URL
    const actionRaw = $form('form').first().attr('action') ?? formUrl
    const actionUrl = actionRaw.startsWith('http') ? actionRaw : `${BASE}/${actionRaw.replace(/^\//, '')}`

    // Step 2: Submit search with member name and area
    const searchBody = buildBig5FormBody({
      ...hidden,
      mbr_name: name,
      area_unit: area,
      label: 'search',
      sec_class: classCode,
      B1: '查詢',
    })

    const searchRes = await http.post(actionUrl, searchBody, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${BASE}${formUrl}`,
      },
    })
    const searchHtml = decodeBig5(searchRes.data as Buffer)

    // Parse preliminary result
    const preliminary = parseAddMemberResult(searchHtml)

    // If already synced, duplicate, not_found, forbidden, error — return immediately
    if (preliminary.status !== 'name_mismatch') {
      return preliminary
    }

    // name_mismatch means search result list was shown.
    // Attempt to auto-select if exactly one row matches the name.
    const $search = cheerio.load(searchHtml)
    const confirmLinks: string[] = []
    $search('a[href]').each((_, el) => {
      const href = $search(el).attr('href') ?? ''
      if (href.includes('add_classmbr') && href.includes('mbr_id=')) {
        confirmLinks.push(href)
      }
    })

    if (confirmLinks.length === 0) {
      return { status: 'not_found', message: 'iccf 查無符合班員' }
    }

    if (confirmLinks.length > 1) {
      return {
        status: 'name_mismatch',
        message: `iccf 找到 ${confirmLinks.length} 筆符合，請手動確認補入`,
      }
    }

    // Exactly one match — follow the confirm link
    const confirmHref = confirmLinks[0]
    const confirmUrl = confirmHref.startsWith('http')
      ? confirmHref
      : `${BASE}/${confirmHref.replace(/^\//, '')}`

    const confirmRes = await http.get(confirmUrl)
    const confirmHtml = decodeBig5(confirmRes.data as Buffer)

    return parseAddMemberResult(confirmHtml)
  } catch (e) {
    if (e instanceof IccfError) throw e
    throw new IccfError('network_error', `iccf 補入失敗: ${(e as Error).message}`, e)
  }
}

/**
 * Mark attendance for a set of present members on iccf.
 *
 * Full flow (3 steps before attendance):
 *  1. Load show_course_pres5.php → find session by date → get seq + setup URL
 *  2. GET edit_course_single_adv5.php → POST setup (remark/topic, study=T, close=T)
 *  3. Load show_present5.php → submit roll_call5.php with present members
 *
 * @param jar                - active session cookie jar
 * @param classCode          - class_sec_code (e.g. "TWC")
 * @param iccfClassCode      - class_code (e.g. "B3000549"), needed to load course list
 * @param date               - YYYY-MM-DD
 * @param topicName          - course name to fill in 設定課程 (remark field)
 * @param presentMemberNames - names of members who are present (marked O)
 * @param leaveMemberNames   - names of members on leave (marked A 請假)
 */
export async function markAttendance(
  jar: CookieJar,
  classCode: string,
  iccfClassCode: string | undefined,
  date: string,
  topicName: string,
  presentMemberNames: string[],
  leaveMemberNames: string[] = [],
): Promise<MarkAttendanceResult> {
  const http = makeHttp(jar)

  try {
    // ── Step 1: Load course list, find session by date ────────────────────
    let courseListUrl: string
    if (iccfClassCode) {
      courseListUrl =
        `/class_present/show_course_pres5.php?label=edit` +
        `&class_code=${encodeURIComponent(iccfClassCode)}` +
        `&class_sec_code=${encodeBig5URIComponent(classCode)}&class_close=2`
    } else {
      // Fallback: try without class_code; iccf may still resolve via session cookie
      courseListUrl =
        `/class_present/show_course_pres5.php?label=edit` +
        `&class_sec_code=${encodeBig5URIComponent(classCode)}&class_close=2`
    }

    const listRes = await http.get(courseListUrl)
    const listHtml = decodeBig5(listRes.data as Buffer)

    const courseSessions = parseCourseSessionList(listHtml)
    const target = courseSessions.find(s => s.gregDate === date)

    if (!target) {
      const available = courseSessions.map(s => s.gregDate).filter(Boolean)
      const suffix = available.length > 0
        ? `；iccf 可用日期：${available.slice(0, 5).join(', ')}${available.length > 5 ? ' …' : ''}`
        : '；iccf 回傳 0 筆班期，請確認此班在 iccf 已排課'
      return {
        marked: [],
        notFound: [...presentMemberNames, ...leaveMemberNames],
        error: `iccf 找不到日期 ${date} 的班期${suffix}`,
      }
    }

    // ── Step 2: Setup course (set topic name, mark as 上過, 必修) ────────
    if (target.setupUrl) {
      const setupPageUrl = resolveUrl(courseListUrl, target.setupUrl)
      const setupRes = await http.get(setupPageUrl)
      const setupHtml = decodeBig5(setupRes.data as Buffer)

      // Extract all hidden inputs from the setup form
      const $setup = cheerio.load(setupHtml)
      const setupHidden: Record<string, string> = {}
      $setup('input[type="hidden"], input[type=hidden]').each((_, el) => {
        const n = $setup(el).attr('name')
        const v = $setup(el).attr('value') ?? ''
        if (n) setupHidden[n] = v
      })

      const setupFormAction =
        $setup('form').first().attr('action') ?? 'edit_course_single_adv_save5.php'
      const setupSubmitUrl = resolveUrl(setupPageUrl, setupFormAction)

      const setupBody = buildBig5FormBody({
        ...setupHidden,
        remark: topicName,
        study: 'T',   // 必修
        close: 'T',   // 上過
      })

      await http.post(setupSubmitUrl, setupBody, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: setupPageUrl,
        },
      })
    }

    // ── Step 3: Load attendance form and submit ───────────────────────────
    const attendanceUrl = resolveUrl(courseListUrl, target.attendanceUrl)
    const formRes = await http.get(attendanceUrl)
    const formHtml = decodeBig5(formRes.data as Buffer)

    const members: AttendanceMemberEntry[] = parseAttendanceMemberList(formHtml)

    const presentSet = new Set(presentMemberNames)
    const leaveSet = new Set(leaveMemberNames)
    const marked: string[] = []
    const notFound: string[] = [...presentMemberNames, ...leaveMemberNames]

    const $form = cheerio.load(formHtml)
    const rollFormAction =
      $form('form[name="form_roll"]').attr('action') ??
      $form('form').last().attr('action') ??
      'roll_call5.php'
    const submitUrl = resolveUrl(attendanceUrl, rollFormAction)

    const hidden: Record<string, string> = {}
    $form('input[type="hidden"]').each((_, el) => {
      const n = $form(el).attr('name')
      const v = $form(el).attr('value') ?? ''
      if (n) hidden[n] = v
    })

    const formFields: Record<string, string> = { ...hidden }
    for (const member of members) {
      if (presentSet.has(member.name) && member.presentFieldName) {
        formFields[member.presentFieldName] = member.presentFieldValue ?? 'O'
        marked.push(member.name)
        const idx = notFound.indexOf(member.name)
        if (idx !== -1) notFound.splice(idx, 1)
      } else if (leaveSet.has(member.name) && member.leaveFieldName) {
        formFields[member.leaveFieldName] = member.leaveFieldValue ?? 'A'
        marked.push(member.name)
        const idx = notFound.indexOf(member.name)
        if (idx !== -1) notFound.splice(idx, 1)
      }
    }

    const submitBody = buildBig5FormBody(formFields)
    const submitRes = await http.post(submitUrl, submitBody, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: attendanceUrl,
      },
    })

    // Parse response for iccf error indicators. On success, iccf typically
    // redirects or returns a confirmation page. On error, it renders an alert
    // or a login page (session died mid-request).
    const submitHtml = decodeBig5(submitRes.data as Buffer)
    const responseError = detectRollCallError(submitHtml)
    if (responseError) {
      return { marked, notFound, error: responseError }
    }

    return { marked, notFound }
  } catch (e) {
    if (e instanceof IccfError) throw e
    const msg = `iccf 點名失敗: ${(e as Error).message}`
    return { marked: [], notFound: [...presentMemberNames, ...leaveMemberNames], error: msg }
  }
}

/**
 * Detect error messages in the roll_call5.php response HTML.
 * Returns a user-facing error string, or null if no error detected.
 */
function detectRollCallError(html: string): string | null {
  // Session died mid-request → redirected to login page
  if (html.includes('f_login') || html.includes('name=zant')) {
    return 'iccf session 在送出前過期，點名未寫入，請重新登入後重試'
  }

  // iccf sometimes uses JS alert() for errors. Only flag if the alert message
  // looks like an error (contains 錯誤/失敗/無法 — navigation labels don't).
  const alertMatch = html.match(/alert\s*\(\s*['"]([^'"]{2,200})['"]\s*\)/)
  if (alertMatch) {
    const msg = alertMatch[1].trim()
    if (/錯誤|失敗|無法|請|重新/.test(msg)) {
      return `iccf 回應錯誤：${msg}`
    }
  }

  return null
}

/** Resolve a possibly-relative URL against a base URL. */
function resolveUrl(base: string, href: string): string {
  if (href.startsWith('http')) return href
  if (href.startsWith('/')) return `${BASE}${href}`
  // relative: strip base filename, append href
  const baseDir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : base + '/'
  // handle ../
  const url = new URL(href, baseDir.startsWith('http') ? baseDir : `${BASE}/${baseDir.replace(/^\//, '')}`)
  return url.href
}
