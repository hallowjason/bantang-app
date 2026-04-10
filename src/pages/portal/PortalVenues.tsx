import { useState, useEffect } from 'react'
import { getAllVenues } from '../../lib/api/portal'
import type { Venue } from '../../types'

// ─── 據點地圖頁（簡化版）─────────────────────────────────
//
// 依城市分組列表；「查看成員」顯示手動維護的名單；
// 若有 lineGroupUrl 顯示「加入 LINE 群」按鈕。

const CITY_ORDER = ['台北', '新北', '桃園']

const CITY_COLOR: Record<string, string> = {
  '台北': 'bg-sky-100 text-sky-700',
  '新北': 'bg-teal-100 text-teal-700',
  '桃園': 'bg-violet-100 text-violet-700',
}

// ─── 成員名單 Modal ───────────────────────────────────────

interface MembersModalProps {
  venue: Venue
  onClose: () => void
}

function MembersModal({ venue, onClose }: MembersModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm px-5 py-5 flex flex-col gap-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">{venue.name} 成員</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        {!venue.members || venue.members.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">目前沒有成員資料</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {venue.members.map((name, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <span className="text-base">👤</span>
                <span className="text-sm text-gray-700">{name}</span>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={onClose}
          className="mt-1 w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
        >
          關閉
        </button>
      </div>
    </div>
  )
}

// ─── 主元件 ───────────────────────────────────────────────

export default function PortalVenues() {
  const [venues, setVenues]         = useState<Venue[]>([])
  const [loading, setLoading]       = useState(true)
  const [membersModal, setMembersModal] = useState<Venue | null>(null)

  useEffect(() => {
    getAllVenues()
      .then(setVenues)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // 依城市分組
  const grouped: Record<string, Venue[]> = {}
  for (const v of venues) {
    if (!grouped[v.city]) grouped[v.city] = []
    grouped[v.city].push(v)
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-5 flex flex-col gap-4 pb-6">

      <h2 className="text-sm font-bold text-sky-700 px-1">北部各據點</h2>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-8">讀取中...</p>
      ) : venues.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">目前尚未新增據點資訊</p>
      ) : (
        <>
          {CITY_ORDER.map(city => {
            const cityVenues = grouped[city]
            if (!cityVenues || cityVenues.length === 0) return null
            return (
              <div key={city} className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold text-gray-500 px-1">{city}</h3>
                {cityVenues.map(venue => (
                  <div key={venue.id} className="bg-white rounded-2xl shadow-sm px-5 py-4 flex flex-col gap-3">

                    {/* 標頭 */}
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-gray-800 flex-1">{venue.name}</h4>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CITY_COLOR[venue.city] ?? 'bg-gray-100 text-gray-500'}`}>
                        {venue.city}
                      </span>
                    </div>

                    {/* 說明 */}
                    {venue.description && (
                      <p className="text-xs text-gray-500">{venue.description}</p>
                    )}

                    {/* 地址 */}
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 shrink-0 pt-0.5">📍</span>
                      <span className="text-xs text-gray-700 flex-1">{venue.address}</span>
                    </div>

                    {/* 按鈕列 */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {venue.mapUrl && (
                        <a
                          href={venue.mapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs bg-sky-600 text-white px-3 py-1.5 rounded-xl hover:bg-sky-700 transition-colors"
                        >
                          查看地圖
                        </a>
                      )}

                      {/* 查看成員 */}
                      <button
                        onClick={() => setMembersModal(venue)}
                        className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                      >
                        查看成員
                        {venue.members && venue.members.length > 0 && (
                          <span className="ml-1 text-gray-400">({venue.members.length})</span>
                        )}
                      </button>

                      {/* 加入 LINE 群 */}
                      {venue.lineGroupUrl && (
                        <a
                          href={venue.lineGroupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-xl hover:bg-green-600 transition-colors flex items-center gap-1"
                        >
                          <span>💬</span>
                          <span>加入 LINE 群</span>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </>
      )}

      {/* 成員 Modal */}
      {membersModal && (
        <MembersModal
          venue={membersModal}
          onClose={() => setMembersModal(null)}
        />
      )}
    </div>
  )
}
