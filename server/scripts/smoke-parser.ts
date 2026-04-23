import { parseClassServiceList } from '../src/iccf/parser'

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
console.log('\n✓ parser ok')
