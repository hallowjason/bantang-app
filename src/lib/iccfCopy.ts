import type { IccfSyncStatus } from '../types'

// ─── iccf 同步狀態 → UI 友善文案 ─────────────────────────────
//
// 與 OpenClaw專用版/ROLLCALL.md 的「建議回覆」話術保持一致，
// 讓領班能直接複製貼給老師 / 壇主。

export interface IccfStatusCopy {
  /** 卡片上的小標籤文字 */
  badge: string
  /** 色系：amber = 警告（可能需手動）/ red = 失敗 / blue = 待重登 / green = 成功 */
  tone: 'green' | 'amber' | 'red' | 'blue' | 'gray'
  /** 1 行事實陳述（本地話） */
  summary: string
  /** 建議回覆模板（可直接轉發給老師） */
  suggestedReply?: (memberName: string, serverName?: string) => string
}

const COPY: Record<IccfSyncStatus, IccfStatusCopy> = {
  synced: {
    badge: '已同步',
    tone: 'green',
    summary: 'iccf 補入成功',
  },
  pending: {
    badge: '處理中',
    tone: 'blue',
    summary: 'iccf 同步處理中',
  },
  not_found: {
    badge: '查無此人',
    tone: 'amber',
    summary: 'iccf 找不到這位前賢',
    suggestedReply: (name) =>
      `老師慈悲，後學找不到「${name}」前賢，如果是第一次報班，` +
      `需要先在下一期報名才能補入，感恩慈悲。`,
  },
  name_mismatch: {
    badge: '字形不符',
    tone: 'amber',
    summary: '系統中的姓名字形與輸入的不同，需人工確認',
    suggestedReply: (name, serverName) =>
      `老師慈悲，後學查到的姓名字形是「${serverName ?? '（請查看 iccf）'}」，` +
      `與您提供的「${name}」不同，為避免補錯，` +
      `請協助確認正確姓名或提供更多資訊，感恩慈悲。`,
  },
  duplicate: {
    badge: '已在此班',
    tone: 'green',
    summary: 'iccf 已有此班員，無需重複補入',
  },
  forbidden: {
    badge: '權限限制',
    tone: 'red',
    summary: '因區權限限制，無法補入',
  },
  session_expired: {
    badge: '需重登',
    tone: 'blue',
    summary: 'iccf 登入已過期，請重新登入後再試',
  },
  error: {
    badge: '同步失敗',
    tone: 'red',
    summary: 'iccf 同步失敗（網路或系統錯誤）',
  },
}

export function getIccfCopy(status: IccfSyncStatus | undefined): IccfStatusCopy | null {
  if (!status) return null
  return COPY[status] ?? null
}

/** 表示此狀態是領班可以按「重試」的（排除已同步 / 處理中 / 已在此班）。 */
export function isRetryableStatus(status: IccfSyncStatus | undefined): boolean {
  if (!status) return false
  return status !== 'synced' && status !== 'pending' && status !== 'duplicate'
}

/** 表示此狀態必須請領班先重登 iccf 才能處理。 */
export function isSessionExpired(status: IccfSyncStatus | undefined): boolean {
  return status === 'session_expired'
}
