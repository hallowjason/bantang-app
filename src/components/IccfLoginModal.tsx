import { useState } from 'react'
import { iccfLogin } from '../lib/api/iccfSession'
import type { IccfLoginResult } from '../lib/api/iccfSession'

interface Props {
  onSuccess: (result: IccfLoginResult) => void
  onCancel: () => void
}

export default function IccfLoginModal({ onSuccess, onCancel }: Props) {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!account.trim() || !password.trim()) {
      setError('帳號與密碼必填')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await iccfLogin(account.trim(), password)
      onSuccess(result)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">登入 iccf 道務系統</h2>
        <p className="text-xs text-gray-400 mb-5">
          密碼不會儲存，僅用於建立本次 session（30 分鐘閒置後自動失效）
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">iccf 帳號</label>
            <input
              type="text"
              value={account}
              onChange={e => setAccount(e.target.value)}
              autoFocus
              placeholder="例：A12345678"
              className="border border-amber-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">iccf 密碼</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="border border-amber-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 disabled:opacity-60"
            >
              {loading ? '登入中...' : '登入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
