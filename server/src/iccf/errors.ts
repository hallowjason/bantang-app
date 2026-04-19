export type IccfErrorCode =
  | 'invalid_credentials'
  | 'login_failed'
  | 'session_expired'
  | 'session_not_found'
  | 'network_error'
  | 'parse_error'
  | 'not_found'
  | 'name_mismatch'
  | 'duplicate'
  | 'forbidden'

export class IccfError extends Error {
  code: IccfErrorCode
  detail?: unknown

  constructor(code: IccfErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = 'IccfError'
    this.code = code
    this.detail = detail
  }
}

export function isIccfError(e: unknown): e is IccfError {
  return e instanceof IccfError
}
