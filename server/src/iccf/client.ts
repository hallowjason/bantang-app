import axios, { AxiosInstance } from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'
import { buildBig5FormBody, decodeBig5 } from './encoding'
import { IccfError } from './errors'

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
 * NOTE: Phase 1 returns raw menu links; Phase 2 will refine parsing once
 * we understand the actual class list endpoint for this user.
 */
export async function listClasses(jar: CookieJar): Promise<IccfClassEntry[]> {
  const http = makeHttp(jar)
  const res = await http.get('/publicphp/header_class5.php?title3=' + encodeURIComponent('班期'))
  const html = decodeBig5(res.data as Buffer)

  // Extract sec_class param from menu links — leader's operable class codes
  const classCodes = new Set<string>()
  const regex = /sec_class=([A-Z0-9]+)/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(html)) !== null) {
    classCodes.add(m[1])
  }

  return Array.from(classCodes).map((code) => ({
    classCode: code,
    className: code, // Phase 2 will resolve the human-readable name
  }))
}
