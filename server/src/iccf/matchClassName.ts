/**
 * Match an app-side class name (短稱，如「光明智勇」) against iccf-side full
 * class names (如「寶光崇正北部光明大學智勇人才班第一期」) by character
 * subsequence: every char of `appName` must appear in `iccfName` in order
 * (other characters may be interleaved between them).
 *
 * Examples:
 *   "光明智勇" ⊆ "寶光崇正北部光明大學智勇人才班第一期"  → true
 *   "光明智勇" ⊆ "寶光崇正北部光明大學仁德基礎班第二期"  → false (缺 智、勇)
 *   "華語"     ⊆ "光明大學華語入門班"                      → true
 *
 * Whitespace in both sides is stripped before comparison (iccf className 偶爾
 * 帶尾巴空白；app class.name 也可能被誤輸入空白).
 */
export function isSubsequence(appName: string, iccfName: string): boolean {
  const needle = appName.replace(/\s+/g, '')
  const haystack = iccfName.replace(/\s+/g, '')
  if (!needle) return false

  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return i === needle.length
}

/**
 * From `candidates`, return the entries whose `className` contains `appName`
 * as a character subsequence. Returns the (possibly empty) match list — the
 * caller decides what to do when matches.length is 0 / 1 / many.
 */
export function pickByNameSubsequence<T extends { className: string }>(
  appName: string,
  candidates: readonly T[],
): T[] {
  return candidates.filter((c) => isSubsequence(appName, c.className))
}
