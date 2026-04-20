import { useState } from 'react'

interface Props {
  defaultTopic: string
  date: string
  onConfirm: (topicName: string) => void
  onCancel: () => void
}

export default function IccfTopicConfirmModal({ defaultTopic, date, onConfirm, onCancel }: Props) {
  const [topic, setTopic] = useState(defaultTopic)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
        <h2 className="text-base font-bold text-gray-800">確認課程名稱</h2>
        <p className="text-xs text-gray-400">{date} 的 iccf 課程設定</p>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">課程名稱（備註）</label>
          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="例：第十堂・月懺"
            className="border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            autoFocus
          />
          <p className="text-xs text-gray-400">將填入 iccf 設定課程的「備註」欄位</p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 active:scale-[0.98] transition-all"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(topic.trim())}
            className="flex-1 py-2.5 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 active:scale-[0.98] transition-all shadow-sm"
          >
            確認同步
          </button>
        </div>
      </div>
    </div>
  )
}
