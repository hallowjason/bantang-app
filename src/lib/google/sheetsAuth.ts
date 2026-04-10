import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { auth } from '../firebase/config'

const STORAGE_KEY = 'sheets_access_token'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

/**
 * 彈出 Google OAuth 視窗，申請 Sheets 唯讀存取授權。
 * 取得的 access token 存入 sessionStorage（關閉 tab 即失效）。
 */
export async function requestSheetsAccess(): Promise<string> {
  const provider = new GoogleAuthProvider()
  provider.addScope(SCOPE)

  const result = await signInWithPopup(auth, provider)
  const credential = GoogleAuthProvider.credentialFromResult(result)
  const token = credential?.accessToken

  if (!token) throw new Error('無法取得 Google access token')

  sessionStorage.setItem(STORAGE_KEY, token)
  return token
}

/**
 * 從 sessionStorage 取得已授權的 access token。
 * 若不存在（尚未授權或 session 結束）則返回 null。
 */
export function getSheetsToken(): string | null {
  return sessionStorage.getItem(STORAGE_KEY)
}

/**
 * 清除已存的 access token（token 過期時呼叫）。
 */
export function clearSheetsToken(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}
