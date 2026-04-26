import { parseClassServiceList, parseClassMemberList, normalizeRegionKey } from '../src/iccf/parser'

/**
 * Synthetic HTML that mirrors the real iccf 班務 page markup. The real HTML
 * (see 班務列表.html in repo root) embeds each class row as a <tr> containing:
 *   - An <a href="...?class_code=B…&class_sec_code=XYZ"> link (details URL)
 *   - A <a href="show_classmbr5.php?…">NAME</a> link (class name)
 *   - A status badge cell with <b>上課中</b> / <b>已結班</b> / <b>聯班結業</b>
 */
const html = `
<table>
  <tr>
    <td>
      <a href="../class/show_class_detail5_v2.php?class_code=B7000170&section_code=TWT&geo_code=n">B7000170</a>
      <a href="show_classmbr5.php?class_code=B7000170&class_sec_code=TWT&class_close=2">2026光明禮行班</a>
    </td>
    <td><font color=blue><b>上課中</b></font></td>
  </tr>
  <tr>
    <td>
      <a href="../class/show_class_detail5_v2.php?class_code=B3000490&section_code=TWC&geo_code=n">B3000490</a>
      <a href="show_classmbr5.php?class_code=B3000490&class_sec_code=TWC&class_close=*">2025光明禮行班</a>
    </td>
    <td><font color=red><b>已結班</b></font></td>
  </tr>
  <tr>
    <td>
      <a href="../class/show_class_detail5_v2.php?class_code=B2000347&section_code=TWA&geo_code=n">B2000347</a>
      <a href="show_classmbr5.php?class_code=B2000347&class_sec_code=TWA&class_close=3">2024聯班</a>
    </td>
    <td><font color=red><b>聯班結業</b></font></td>
  </tr>
  <tr>
    <td>
      <a href="../class/show_class_detail5_v2.php?class_code=B4000299&section_code=TWB&geo_code=n">B4000299</a>
      <a href="show_classmbr5.php?class_code=B4000299&class_sec_code=TWB&class_close=*">2023班</a>
    </td>
    <td><font color=red><b>已結班</b></font></td>
  </tr>
</table>
`

const parsed = parseClassServiceList(html)

console.log(`Parsed ${parsed.length} entries`)
for (const e of parsed) {
  console.log(
    `  ${e.iccfClassCode.padEnd(10)} [${e.classCode.padEnd(6)}] ${e.status.padEnd(12)} ${e.className}`,
  )
}

const byStatus = parsed.reduce<Record<string, number>>((acc, e) => {
  acc[e.status] = (acc[e.status] ?? 0) + 1
  return acc
}, {})
console.log('\nBy status:', byStatus)

// Assertions
const expected = [
  { iccfClassCode: 'B7000170', status: 'active' },
  { iccfClassCode: 'B3000490', status: 'ended' },
  { iccfClassCode: 'B2000347', status: 'joint_ended' },
  { iccfClassCode: 'B4000299', status: 'ended' },
] as const

let ok = true
for (const exp of expected) {
  const got = parsed.find((p) => p.iccfClassCode === exp.iccfClassCode)
  if (!got) {
    console.error(`MISSING ${exp.iccfClassCode}`)
    ok = false
  } else if (got.status !== exp.status) {
    console.error(`STATUS MISMATCH ${exp.iccfClassCode}: got ${got.status}, want ${exp.status}`)
    ok = false
  }
}
if (parsed.length !== expected.length) {
  console.error(`LENGTH MISMATCH: got ${parsed.length}, want ${expected.length}`)
  ok = false
}
if (!ok) {
  process.exit(1)
}
console.log('\n✓ parseClassServiceList ok')

// ─── parseClassMemberList smoke ───────────────────────────────────────

const memberListHtml = `
<table>
  <tr>
    <td>取消</td><td>改</td><td>性別</td><td>座號</td><td>求道名</td><td>本名</td>
    <td>現況</td><td>類別</td><td>生日</td><td>求道日</td>
    <td>區別</td><td>成全者</td><td>備註</td><td>清口</td><td>住宿</td>
    <td>道歷</td><td>結業否</td><td>歷史</td><td>審核</td>
  </tr>
  <tr>
    <td><input type=checkbox></td>
    <td><a href="/classmbr/edit_classmbr5.php?class_code=B7000170&no_mem=+++30273&class_sec_code=TWT&tmbrtype=A">改</a></td>
    <td>乾</td><td>1</td><td>詹淳璽</td><td>詹淳璽</td>
    <td><a>在學</a></td><td>道親</td><td>70/08/09</td><td>91/07/26/戍</td>
    <td>精明001</td><td>陳愫美</td><td></td><td>是</td><td></td><td>信德</td><td>未結業</td><td>歷史</td><td>審核</td>
  </tr>
  <tr>
    <td><input type=checkbox></td>
    <td><a href="/classmbr/edit_classmbr5.php?class_code=B7000170&no_mem=+++51358&class_sec_code=TWT&tmbrtype=B">改</a></td>
    <td>坤</td><td>2</td><td>蔡玥惠</td><td>蔡月惠</td>
    <td><a>在學</a></td><td>道親</td><td>64/04/21</td><td>96/11/20/午</td>
    <td>精明024</td><td>蘇致和</td><td></td><td>是</td><td></td><td>信德</td><td>未結業</td><td>歷史</td><td>審核</td>
  </tr>
</table>
`

const members = parseClassMemberList(memberListHtml)
const expectedMembers = [
  { name: '詹淳璽', alternateName: '詹淳璽', regionCell: '精明001', iccfMemberId: '30273' },
  { name: '蔡玥惠', alternateName: '蔡月惠', regionCell: '精明024', iccfMemberId: '51358' },
]
let memberOk = true
for (const exp of expectedMembers) {
  const got = members.find(m => m.iccfMemberId === exp.iccfMemberId)
  if (!got) {
    console.error(`MEMBER MISSING: ${exp.iccfMemberId}`)
    memberOk = false
    continue
  }
  for (const k of Object.keys(exp) as (keyof typeof exp)[]) {
    if (got[k] !== exp[k]) {
      console.error(`MEMBER MISMATCH ${exp.iccfMemberId}.${k}: got ${got[k]}, want ${exp[k]}`)
      memberOk = false
    }
  }
}
if (members.length !== expectedMembers.length) {
  console.error(`MEMBER LENGTH: got ${members.length}, want ${expectedMembers.length}`)
  memberOk = false
}

// Empty / unrecognized table → []
if (parseClassMemberList('<html><body>無權限</body></html>').length !== 0) {
  console.error('expected empty array for non-member-list page')
  memberOk = false
}

if (!memberOk) process.exit(1)
console.log('✓ parseClassMemberList ok')

// ─── normalizeRegionKey smoke ─────────────────────────────────────────

const cases: Array<[unknown[], string]> = [
  [['賢德', '19'], '賢德019'],
  [['賢德', '019'], '賢德019'],
  [['賢德', ' 019 '], '賢德019'],
  [['賢德', ''], '賢德'],
  [['賢德 ', '1'], '賢德001'],
  [['精明 001 區'], '精明001'],
  [['精明001'], '精明001'],
  [['精明001區'], '精明001'],
  [['精明024'], '精明024'],
]
let normOk = true
for (const [args, want] of cases) {
  const got = (normalizeRegionKey as (...a: unknown[]) => string)(...args)
  if (got !== want) {
    console.error(`normalizeRegionKey(${JSON.stringify(args)}) = ${got}, want ${want}`)
    normOk = false
  }
}
if (!normOk) process.exit(1)
console.log('✓ normalizeRegionKey ok')
