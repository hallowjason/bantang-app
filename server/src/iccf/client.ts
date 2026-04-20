import axios, { AxiosInstance } from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'
import { buildBig5FormBody, encodeBig5URIComponent, decodeBig5 } from './encoding'
import { IccfError } from './errors'
import {
  parseAddMemberResult,
  parseClassList,
  parseAttendanceSessions,
  parseAttendanceMemberList,
  type AddMemberResult,
  type AttendanceSessionEntry,
  type AttendanceMemberEntry,
} from './parser'

export type { AddMemberResult }

export interface MarkAttendanceResult {
  /** Members successfully marked present in iccf */
  marked: string[]
  /** Members that appeared in presentNames but not found on iccf page */
  notFound: string[]
  /** General error message if the whole operation failed */
  error?: string
}

const BASE = 'https://iccf.ikd.org.tw'
const LOGIN_URL = `${BASE}/55index.php`
const LOGOUT_URL = `${BASE}/logout5.php`
const WARM_MARKER = 'online_warm5.php'
const LOGIN_PAGE_MARKER = 'warn_change_pass5.php'
const HEADER_CLASS_URL = `${BASE}/publicphp/header_class5.php`

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
  classCode: string
  className: string
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
    // Heuristic: topmenu shows e.g. "精明019 區 -- 蔡喬淞"
    const match = text.match(/([^\s]+\s*\d+\s*區)[^\u4e00-\u9fff]*([\u4e00-\u9fff]{2,4})/)
    if (match) {
      return { area: match[1].trim(), name: match[2].trim() }
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

/** Ping: lightweight check that the session is still valid. */
export async function ping(jar: CookieJar): Promise<boolean> {
  const http = makeHttp(jar)
  try {
    const res = await http.get('/publicphp/header_all5.php')
    const html = decodeBig5(res.data as Buffer)
    // If session expired, iccf usually redirects to login page
    return !html.includes('f_login') && !html.includes('name=zant')
  } catch {
    return false
  }
}

/**
 * Fetch the list of classes the logged-in leader can operate on.
 */
export async function listClasses(jar: CookieJar): Promise<IccfClassEntry[]> {
  const http = makeHttp(jar)
  const res = await http.get('/publicphp/header_class5.php?title3=' + encodeURIComponent('班期'))
  const html = decodeBig5(res.data as Buffer)
  return parseClassList(html)
}

/**
 * Add a member to an iccf class via the 補入 flow.
 *
 * The iccf add-member form is a two-step process:
 *  1. POST search form with name + area → get result list
 *  2. If exactly one match, POST confirmation → get success page
 *
 * We attempt to auto-select when exactly one result is returned.
 * If multiple or zero results, we map to the appropriate IccfSyncStatus.
 *
 * @param jar       - active session cookie jar
 * @param name      - member's full name (UTF-8, encoded to Big5 internally)
 * @param area      - member's region/area string (e.g. "精明019 區")
 * @param classCode - sec_class code (e.g. "TWT019")
 */
export async function addMember(
  jar: CookieJar,
  name: string,
  area: string,
  classCode: string,
): Promise<AddMemberResult> {
  const http = makeHttp(jar)

  try {
    // Step 1: Load the add-member search form for this class
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
 * Flow:
 * 1. Load the class presence selection page for the given classCode
 * 2. Find the session (班期) matching the given date
 * 3. Navigate to that session's attendance form (show_present5.php)
 * 4. Submit form_roll with present_o[i] checked for present members
 *
 * @param jar                - active session cookie jar
 * @param classCode          - sec_class code (e.g. "TWC")
 * @param date               - YYYY-MM-DD format
 * @param presentMemberNames - names of members who are present
 */
export async function markAttendance(
  jar: CookieJar,
  classCode: string,
  date: string,
  presentMemberNames: string[],
): Promise<MarkAttendanceResult> {
  const http = makeHttp(jar)

  try {
    // Step 1: Load the class presence selection page
    const presUrl =
      `/class_present/select_class_pres5.php?sec_class=${encodeBig5URIComponent(classCode)}`
    const presRes = await http.get(presUrl)
    const presHtml = decodeBig5(presRes.data as Buffer)

    // Step 2: Find the session entry matching our date (YYYY-MM-DD)
    const sessions = parseAttendanceSessions(presHtml)
    const targetSession = sessions.find(
      s => s.gregDate === date || s.dateLabel.includes(date),
    )

    if (!targetSession) {
      return {
        marked: [],
        notFound: presentMemberNames,
        error: `iccf 找不到日期 ${date} 的班期（共 ${sessions.length} 筆）`,
      }
    }

    // Step 3: Navigate to the attendance form for that session
    const formUrl = targetSession.formUrl.startsWith('http')
      ? targetSession.formUrl
      : `${BASE}/${targetSession.formUrl.replace(/^\//, '')}`

    const formRes = await http.get(formUrl)
    const formHtml = decodeBig5(formRes.data as Buffer)

    // Step 4: Parse member list from the attendance form
    const members: AttendanceMemberEntry[] = parseAttendanceMemberList(formHtml)

    const presentSet = new Set(presentMemberNames)
    const marked: string[] = []
    const notFound: string[] = [...presentMemberNames]

    // Extract form action from form_roll (not the first form which is form_chang_mbrtype)
    const $form = cheerio.load(formHtml)
    const rollFormAction =
      $form('form[name="form_roll"]').attr('action') ??
      $form('form').last().attr('action') ??
      'roll_call5.php'
    const submitUrl = rollFormAction.startsWith('http')
      ? rollFormAction
      : `${BASE}/class_present/${rollFormAction.replace(/^\//, '')}`

    // Collect all hidden inputs (includes class_no[i], no_mem[i], name[i], class_code, etc.)
    const hidden: Record<string, string> = {}
    $form('input[type="hidden"]').each((_, el) => {
      const n = $form(el).attr('name')
      const v = $form(el).attr('value') ?? ''
      if (n) hidden[n] = v
    })

    // Build the form body: start with all hidden fields, then add present_o[i] for present members
    const formFields: Record<string, string> = { ...hidden }

    for (const member of members) {
      if (presentSet.has(member.name) && member.presentFieldName) {
        formFields[member.presentFieldName] = member.presentFieldValue ?? 'O'
        marked.push(member.name)
        const idx = notFound.indexOf(member.name)
        if (idx !== -1) notFound.splice(idx, 1)
      }
    }

    // Step 5: Submit the attendance form (roll_call5.php)
    const submitBody = buildBig5FormBody(formFields)
    await http.post(submitUrl, submitBody, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: formUrl,
      },
    })

    return { marked, notFound }
  } catch (e) {
    if (e instanceof IccfError) throw e
    const msg = `iccf 點名失敗: ${(e as Error).message}`
    return { marked: [], notFound: presentMemberNames, error: msg }
  }
}
