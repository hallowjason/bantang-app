import emailjs from '@emailjs/browser'
import type { PortalEvent, EventResponse } from '../types'

const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID  as string | undefined
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID as string | undefined
const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY  as string | undefined

const INTEREST_LABEL: Record<string, string> = {
  yes:   '我要參加',
  maybe: '考慮中',
  no:    '這次無法',
}

/**
 * 當班員送出意願調查後，自動發 Email 給活動負責人。
 *
 * 需要在 .env 設定三個變數：
 *   VITE_EMAILJS_SERVICE_ID
 *   VITE_EMAILJS_TEMPLATE_ID
 *   VITE_EMAILJS_PUBLIC_KEY
 *
 * EmailJS Template 建議使用以下變數：
 *   {{to_name}}          - 收件人（負責人）姓名
 *   {{event_title}}      - 活動名稱
 *   {{respondent_name}}  - 回覆者姓名
 *   {{respondent_phone}} - 回覆者電話
 *   {{respondent_email}} - 回覆者 email
 *   {{interest}}         - 意願（參加 / 考慮中 / 無法參加）
 *   {{note}}             - 備註
 */
export async function sendEventNotification(
  event: PortalEvent,
  response: EventResponse,
): Promise<void> {
  // 若未設定 EmailJS，靜默跳過（不影響主流程）
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    console.warn('[EmailJS] 尚未設定 EmailJS 環境變數，跳過發信。')
    return
  }

  // 使用第一位負責人（若無則跳過）
  const firstResponsible = event.responsible?.[0]
  if (!firstResponsible) return

  await emailjs.send(
    SERVICE_ID,
    TEMPLATE_ID,
    {
      to_name:          firstResponsible.name || '活動負責人',
      event_title:      event.title,
      respondent_name:  response.name,
      respondent_phone: response.phone,
      respondent_email: response.email || '',
      interest:         INTEREST_LABEL[response.interest] ?? response.interest,
      note:             response.note || '（無）',
    },
    PUBLIC_KEY,
  )
}
