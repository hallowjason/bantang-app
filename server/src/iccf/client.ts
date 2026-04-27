import axios, { AxiosInstance } from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'
import { buildBig5FormBody, encodeBig5URIComponent, decodeBig5 } from './encoding'
import { IccfError } from './errors'
import {
  parseAddMemberResult,
  parseAddMemberSearchResult,
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
  /**
   * Relative href of the 補入 button on the 班務 page (entry to the
   * add_classmbr_sec5.php form). Required for {@link addMember} to drive the
   * real 4-step iccf 補入 flow. Sessions persisted before this field was
   * added will lack it; addMember returns a session_expired-style error in
   * that case so the leader is prompted to re-login.
   */
  addMemberHref?: string
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
 * Add a member to an iccf class via the real 4-step 補入 flow.
 *
 * Discovered via real HTML fixtures (2026-04, 寶光崇正 instance). The earlier
 * 2-step `add_classmbr_first5.php` flow was wrong — that endpoint redirects
 * to the 班務 list page when called directly, producing a useless
 * "0 班別資料" response. The real flow is:
 *
 *   Step 0 (pre-check, optional): GET show_classmbr5.php → already-in-class?
 *   Step 1: GET addMemberHref → the 補入 form page (add_classmbr_sec5.php)
 *   Step 2: Locate form_input1 (method=1, search by name) → harvest hidden inputs
 *   Step 3: POST add_classmbr_thrd5.php with select=name_both + input=<name>
 *   Step 4: Match candidates by (name||name_org) AND normalized section → exactly one
 *   Step 5: POST add_classmbr_four5.php with all rows' hidden + join[i]=T
 *
 * @param jar           - active session cookie jar
 * @param name          - member's name as typed in the app (matched against
 *                        iccf 求道名 / 本名)
 * @param regionUnit    - "賢德" / "精明" / "正宗" — combined with regionNumber
 * @param regionNumber  - "19" / "019" — zero-padded to 3 digits internally
 * @param classCode     - sec_code (e.g. "TWT") — used by pre-check fallback URL
 * @param iccfClassCode - B-number (e.g. "B7000170") — used by pre-check fallback URL
 * @param addMemberHref - relative href of the 補入 button on the 班務 page,
 *                        carrying real iccf params (name_create, tiov_geo_close,
 *                        short_name, etc.). REQUIRED. If a session is missing
 *                        this (persisted before this field existed), the
 *                        leader is asked to re-login.
 */
export async function addMember(
  jar: CookieJar,
  name: string,
  regionUnit: string,
  regionNumber: string,
  classCode: string,
  iccfClassCode: string,
  addMemberHref?: string,
): Promise<AddMemberResult> {
  if (!addMemberHref) {
    return {
      status: 'error',
      message: 'iccf 班別資訊不足（請登出 iccf 後重新登入以更新班別清單）',
    }
  }

  const http = makeHttp(jar)
  const targetName = name.trim()
  const targetRegion = normalizeRegionKey(regionUnit, regionNumber)

  try {
    // ── Step 0: Pre-check class member list for existing (name, region) ──
    // Cheap shortcut so we don't drive the full 4-step flow when the member
    // is already in this class. If pre-check page can't be parsed we just
    // continue — the real 補入 flow has its own duplicate handling.
    const listUrl =
      `/classmbr/show_classmbr5.php` +
      `?class_code=${encodeURIComponent(iccfClassCode)}` +
      `&class_sec_code=${encodeBig5URIComponent(classCode)}&first=T`
    try {
      const listRes = await http.get(listUrl)
      const listHtml = decodeBig5(listRes.data as Buffer)
      const existing = parseClassMemberList(listHtml)
      const dupe = existing.find((e) =>
        (e.name === targetName || e.alternateName === targetName) &&
        normalizeRegionKey(e.regionCell) === targetRegion,
      )
      if (dupe) {
        return {
          status: 'duplicate',
          iccfMemberId: dupe.iccfMemberId || undefined,
          message: '班員已在此班',
        }
      }
    } catch {
      // Pre-check is best-effort. Network blip, header mismatch — let the
      // real flow run and report its own error if the session is broken.
    }

    // ── Step 1: GET the 補入 form page ──
    // addMemberHref is a relative path like "../classmbr/add_classmbr_sec5.php?…"
    // captured from the 班務 list page (/class/select_class_service5.php).
    // Resolve it against that base.
    const formUrl = resolveUrl(
      `${BASE}/class/select_class_service5.php`,
      addMemberHref,
    )
    const formRes = await http.get(formUrl, {
      headers: { Referer: `${BASE}/class/select_class_service5.php` },
    })
    const formHtml = decodeBig5(formRes.data as Buffer)

    // ── Step 2: Find form_input1 (search-by-name, method=1) and harvest hidden inputs ──
    // The 補入 page has 3 forms all targeting add_classmbr_thrd5.php
    // (方式一/方式二/方式三). We want 方式二 — search by name. It is the
    // only form whose hidden input <input name=method value='1'> is set.
    const $f = cheerio.load(formHtml)
    let searchFormEl: ReturnType<typeof $f>[number] | null = null
    $f('form').each((_, el) => {
      const action = $f(el).attr('action') ?? ''
      if (!/add_classmbr_thrd5/.test(action)) return
      const methodVal = $f(el)
        .find('input')
        .filter((_i, inp) => $f(inp).attr('name') === 'method')
        .first()
        .attr('value')
      if (methodVal === '1') {
        searchFormEl = el
        return false
      }
    })

    if (!searchFormEl) {
      console.error('[iccf.addMember] form_input1 (method=1) missing on form page', {
        formUrl,
        htmlLength: formHtml.length,
        hasThrd5: /add_classmbr_thrd5/.test(formHtml),
      })
      return {
        status: 'error',
        message: 'iccf 補入表單結構異常（找不到方式二搜尋欄），請聯繫管理員',
      }
    }

    const $searchForm = $f(searchFormEl)
    const formHidden: Record<string, string> = {}
    $searchForm.find('input').each((_, inp) => {
      const type = ($f(inp).attr('type') ?? '').toLowerCase()
      if (type !== 'hidden') return
      const fieldName = $f(inp).attr('name')
      if (!fieldName) return
      formHidden[fieldName] = $f(inp).attr('value') ?? ''
    })
    formHidden.method = '1' // Force, in case multiple methods exist on form

    // ── Step 3: POST search to add_classmbr_thrd5.php ──
    const searchUrl = resolveUrl(formUrl, 'add_classmbr_thrd5.php')
    const searchBody = buildBig5FormBody({
      ...formHidden,
      select: 'name_both', // search both 求道名 and 本名
      input: targetName, // trimmed; raw `name` could carry whitespace from caller
      select_sort: 'sort_name',
      select_sort_order: 'order_asc',
    })
    const searchRes = await http.post(searchUrl, searchBody, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: formUrl,
      },
    })
    const searchHtml = decodeBig5(searchRes.data as Buffer)

    // ── Step 4: Parse search result ──
    const sr = parseAddMemberSearchResult(searchHtml)
    if (sr.status === 'not_found') {
      return { status: 'not_found', message: sr.message }
    }
    if (sr.status === 'unknown') {
      console.error('[iccf.addMember] thrd5 response unrecognized', {
        searchUrl,
        htmlLength: searchHtml.length,
        hasJoinCheckbox: /name=join\[/.test(searchHtml),
        hasFour5: /add_classmbr_four5/.test(searchHtml),
      })
      return { status: 'error', message: sr.message }
    }

    // ── Step 5: Match candidates by name + region ──
    const matches = sr.candidates.filter((c) => {
      const nameMatch = c.name === targetName || c.nameOrg === targetName
      const regionMatch = normalizeRegionKey(c.sectionName) === targetRegion
      return nameMatch && regionMatch
    })

    if (matches.length === 0) {
      const sample = sr.candidates[0]
      return {
        status: 'name_mismatch',
        message:
          `iccf 找到 ${sr.candidates.length} 筆同名但區域不符（您輸入「${targetRegion}」` +
          (sample ? `，iccf 顯示「${sample.sectionName || sample.sectionCode}」` : '') +
          `），請手動確認`,
      }
    }
    if (matches.length > 1) {
      return {
        status: 'name_mismatch',
        message: `iccf 找到 ${matches.length} 筆同名同區，請手動確認補入`,
      }
    }

    // ── Step 6: Submit selected candidate to add_classmbr_four5.php ──
    const matched = matches[0]
    const submitUrl = resolveUrl(searchUrl, sr.formAction)

    // Build body: form-level hidden + ALL row[i] hidden + join[matched.idx]=T.
    // We send every row's hidden fields (not just the matched row's) because
    // the iccf PHP reads by `count` and may iterate all indices server-side.
    const submitFields: Record<string, string> = { ...sr.formHidden }
    for (const cand of sr.candidates) {
      for (const [k, v] of Object.entries(cand.rowHidden)) {
        submitFields[`${k}[${cand.idx}]`] = v
      }
    }
    submitFields[`join[${matched.idx}]`] = 'T'

    const submitBody = buildBig5FormBody(submitFields)
    const submitRes = await http.post(submitUrl, submitBody, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: searchUrl,
      },
    })
    const submitHtml = decodeBig5(submitRes.data as Buffer)

    const result = parseAddMemberResult(submitHtml)
    if (result.status === 'error') {
      console.error('[iccf.addMember] four5 response unrecognized', {
        submitUrl,
        htmlLength: submitHtml.length,
        hasAlert: /alert\s*\(/.test(submitHtml),
      })
    }
    // Carry over the matched person's no_mem as iccfMemberId on success
    // (parseAddMemberResult only extracts mbr_id from a URL pattern, which
    // the four5 success page may or may not contain). Build a new object —
    // never mutate the parser's return value.
    if (result.status === 'synced' && !result.iccfMemberId) {
      const noMem = (matched.rowHidden.no_mem ?? '').replace(/\s+/g, '').trim()
      if (noMem) return { ...result, iccfMemberId: noMem }
    }
    return result
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
