/**
 * smoke-match-class-name.ts
 *
 * Sanity-check `pickByNameSubsequence` against synthetic class lists modelled
 * on real iccf className formats (from select_class_service5.html fixture)
 * combined with real app class.name values (from production screenshot).
 *
 * Run:
 *   cd server
 *   npx tsx scripts/smoke-match-class-name.ts
 *
 * Exits non-zero on any assertion failure.
 */

import { isSubsequence, pickByNameSubsequence } from '../src/iccf/matchClassName'

interface Case {
  label: string
  appName: string
  candidates: Array<{ className: string; iccfClassCode: string }>
  expectedCodes: string[]   // sorted; matched class codes
}

const cases: Case[] = [
  {
    label: '光明智勇 → 命中唯一一個',
    appName: '光明智勇',
    candidates: [
      { className: '寶光崇正北部光明大學智勇人才班第一期', iccfClassCode: 'B3000549' },
      { className: '寶光崇正北部光明大學仁德基礎班第二期', iccfClassCode: 'B2000347' },
      { className: '寶光崇正北部光明大學義理禮節班第四期', iccfClassCode: 'B1000643' },
      { className: '寶光崇正北部光明大學禮行禮節班第二期', iccfClassCode: 'B0000445' },
    ],
    expectedCodes: ['B3000549'],
  },
  {
    label: '光明仁德 → 命中唯一一個',
    appName: '光明仁德',
    candidates: [
      { className: '寶光崇正北部光明大學智勇人才班第一期', iccfClassCode: 'B3000549' },
      { className: '寶光崇正北部光明大學仁德基礎班第二期', iccfClassCode: 'B2000347' },
    ],
    expectedCodes: ['B2000347'],
  },
  {
    label: '光明禮行 → 命中所有「光明…禮行…」班別（多命中應 no-op）',
    appName: '光明禮行',
    candidates: [
      { className: '寶光崇正北部光明大學禮行禮節班第一期', iccfClassCode: 'B0000373' },
      { className: '寶光崇正北部光明大學禮行禮節班第二期', iccfClassCode: 'B0000445' },
      { className: '寶光崇正北部光明大學義理禮節班第四期', iccfClassCode: 'B1000643' },
    ],
    expectedCodes: ['B0000373', 'B0000445'],
  },
  {
    label: '光明智勇 ⊄ 義理禮節班 (缺 智、勇)',
    appName: '光明智勇',
    candidates: [
      { className: '寶光崇正北部光明大學義理禮節班第四期', iccfClassCode: 'B1000643' },
    ],
    expectedCodes: [],
  },
  {
    label: '宣賢禮行 → 命中宣賢禮行班',
    appName: '宣賢禮行',
    candidates: [
      { className: '寶光崇正北部宣賢大學禮行禮節班第三期', iccfClassCode: 'B0000900' },
      { className: '寶光崇正北部光明大學禮行禮節班第二期', iccfClassCode: 'B0000445' },
    ],
    expectedCodes: ['B0000900'],
  },
  {
    label: '浩賢禮行 → 命中浩賢禮行班（佛堂在前、班別在後）',
    appName: '浩賢禮行',
    candidates: [
      { className: '寶光崇正北部浩賢大學禮行禮節班第一期', iccfClassCode: 'B0001000' },
      { className: '寶光崇正北部光明大學禮行禮節班第二期', iccfClassCode: 'B0000445' },
    ],
    expectedCodes: ['B0001000'],
  },
  {
    label: '順序 invariant：「禮行光明」應不命中（subsequence 嚴守順序）',
    appName: '禮行光明',
    candidates: [
      { className: '寶光崇正北部光明大學禮行禮節班第一期', iccfClassCode: 'B0000373' },
    ],
    expectedCodes: [],
  },
  {
    label: '空字串 needle → 一律不命中',
    appName: '   ',
    candidates: [
      { className: '寶光崇正北部光明大學禮行禮節班第一期', iccfClassCode: 'B0000373' },
    ],
    expectedCodes: [],
  },
  {
    label: '帶空白的 className 也能比對',
    appName: '光明智勇',
    candidates: [
      { className: '  寶光崇正  北部 光明 大學 智勇 人才班 第一期 ', iccfClassCode: 'B3000549' },
    ],
    expectedCodes: ['B3000549'],
  },
]

let failed = 0
for (const c of cases) {
  const matched = pickByNameSubsequence(c.appName, c.candidates).map(m => m.iccfClassCode).sort()
  const expected = [...c.expectedCodes].sort()
  const ok = matched.length === expected.length && matched.every((m, i) => m === expected[i])
  if (ok) {
    console.log(`  ✓ ${c.label}  → [${matched.join(', ')}]`)
  } else {
    failed++
    console.log(`  ✗ ${c.label}`)
    console.log(`      expected: [${expected.join(', ')}]`)
    console.log(`      got:      [${matched.join(', ')}]`)
  }
}

// Spot-check primitive isSubsequence behaviour
const primitiveChecks: Array<[string, string, boolean]> = [
  ['光明智勇', '寶光崇正北部光明大學智勇人才班第一期', true],
  ['光明智勇', '寶光崇正北部光明大學仁德基礎班第二期', false],
  ['', '光明大學', false],
  ['華語', '寶光崇正北部光明大學華語入門班', true],
]
for (const [needle, haystack, expected] of primitiveChecks) {
  const got = isSubsequence(needle, haystack)
  if (got === expected) {
    console.log(`  ✓ isSubsequence("${needle}" ⊆ "${haystack.slice(0, 30)}…") = ${got}`)
  } else {
    failed++
    console.log(`  ✗ isSubsequence("${needle}", "${haystack}") expected ${expected} got ${got}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`)
  process.exit(1)
}
console.log(`\nAll ${cases.length + primitiveChecks.length} cases passed`)
