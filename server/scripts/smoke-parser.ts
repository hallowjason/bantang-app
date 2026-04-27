import {
  parseAddMemberResult,
  parseAddMemberSearchResult,
  parseClassServiceList,
  parseClassMemberList,
  normalizeRegionKey,
} from '../src/iccf/parser'

/**
 * Synthetic HTML that mirrors the real iccf 班務 page markup. The real HTML
 * (see 班務列表.html in repo root) embeds each class row as a <tr> containing:
 *   - An <a href="...?class_code=B…&class_sec_code=XYZ"> link (details URL)
 *   - A <a href="show_classmbr5.php?…">NAME</a> link (class name)
 *   - A status badge cell with <b>上課中</b> / <b>已結班</b> / <b>聯班結業</b>
 */
// Active classes additionally have a 補入 button → addMemberHref.
// Real iccf renders the link with leading `../classmbr/` (relative to
// /class/select_class_service5.php) and Big5 percent-encoded `short_name`,
// plus carry-over `select=道親&input=TWT019` from a previous 方式一 search
// — which our parser MUST strip (raw CJK in URL would be sent as UTF-8 by
// axios and mis-parsed by iccf).
const html = `
<table>
  <tr>
    <td>
      <a href="../class/show_class_detail5_v2.php?class_code=B7000170&section_code=TWT&geo_code=n">B7000170</a>
      <a href="show_classmbr5.php?class_code=B7000170&class_sec_code=TWT&class_close=2">2026光明禮行班</a>
    </td>
    <td><font color=blue><b>上課中</b></font></td>
    <td>
      <a href="../classmbr/add_classmbr_sec5.php?label=add&classmbr_sec=&tiov_geo_close=Fn2B7&name_create=++++9184&class_code=B7000170&class_sec_code=TWT&short_name=%A5_%B3%A1%BA%EB%A9%FA%A4%D1%BCz%ABH%BCw%C1%BF%AD%FB%B2%C419%B4%C1&select=道親&input=TWT019">補入</a>
    </td>
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
  { iccfClassCode: 'B7000170', status: 'active', hasAdd: true },
  { iccfClassCode: 'B3000490', status: 'ended', hasAdd: false },
  { iccfClassCode: 'B2000347', status: 'joint_ended', hasAdd: false },
  { iccfClassCode: 'B4000299', status: 'ended', hasAdd: false },
] as const

let ok = true
for (const exp of expected) {
  const got = parsed.find((p) => p.iccfClassCode === exp.iccfClassCode)
  if (!got) {
    console.error(`MISSING ${exp.iccfClassCode}`)
    ok = false
    continue
  }
  if (got.status !== exp.status) {
    console.error(`STATUS MISMATCH ${exp.iccfClassCode}: got ${got.status}, want ${exp.status}`)
    ok = false
  }
  if (exp.hasAdd !== Boolean(got.addMemberHref)) {
    console.error(`addMemberHref presence MISMATCH ${exp.iccfClassCode}: got ${got.addMemberHref}, want ${exp.hasAdd}`)
    ok = false
  }
}
if (parsed.length !== expected.length) {
  console.error(`LENGTH MISMATCH: got ${parsed.length}, want ${expected.length}`)
  ok = false
}

// addMemberHref hygiene: must NOT contain raw CJK chars (which would be
// sent as UTF-8 by axios and mis-parsed by iccf, the original 4th attempt
// failure mode that prompted the rewrite).
const active = parsed.find((p) => p.iccfClassCode === 'B7000170')
if (!active?.addMemberHref) {
  console.error('B7000170 addMemberHref missing entirely')
  ok = false
} else {
  if (/[一-鿿]/.test(active.addMemberHref)) {
    console.error('addMemberHref leaks raw CJK (strip select/input failed):', active.addMemberHref)
    ok = false
  }
  if (!active.addMemberHref.startsWith('../classmbr/add_classmbr_sec5.php')) {
    console.error('addMemberHref path unexpected:', active.addMemberHref)
    ok = false
  }
  if (!active.addMemberHref.includes('class_code=B7000170')) {
    console.error('addMemberHref missing class_code:', active.addMemberHref)
    ok = false
  }
  if (!active.addMemberHref.includes('name_create=')) {
    console.error('addMemberHref missing name_create:', active.addMemberHref)
    ok = false
  }
  if (active.addMemberHref.includes('select=') || active.addMemberHref.includes('input=')) {
    console.error('addMemberHref still has select=/input= leftover:', active.addMemberHref)
    ok = false
  }
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

// ─── parseAddMemberResult smoke ──────────────────────────────────────
//
// Reproduces the bug we shipped 2026-04-26 where iccf returned a page with
// inline `<style>` rules inside <body>. cheerio's .text() pulled the CSS
// (A:link {color: blue}…) into the parser, drowning the real message and
// surfacing a useless error to leaders. The parser must now strip
// style/script before keyword matching, and must extract alert() text.

interface AddCase {
  name: string
  html: string
  wantStatus: 'synced' | 'duplicate' | 'not_found' | 'name_mismatch' | 'forbidden' | 'error'
  /** Optional substring the user-facing message must / must not contain. */
  messageMustNotInclude?: string
  messageMustInclude?: string
}

const addCases: AddCase[] = [
  {
    name: 'inline <style> + 補入成功 alert → synced',
    html: `<html><body>
      <style>A:link {color: blue} A:visited {color: blue } A:active {color: red} A:hover {color: red}</style>
      <script>alert('補入成功');location.href='show_classmbr5.php?mbr_id=12345';</script>
    </body></html>`,
    wantStatus: 'synced',
    messageMustNotInclude: 'A:link',
  },
  {
    name: 'style-only page (the actual bug) → error, but message is NOT CSS',
    html: `<html><body>
      <style>A:link {color: blue} A:visited {color: blue } A:active {color: red} A:hover {color: red}</style>
    </body></html>`,
    wantStatus: 'error',
    messageMustNotInclude: 'A:link',
  },
  {
    name: 'alert with 查無 → not_found (was: error)',
    html: `<html><body>
      <style>A:link {color: blue}</style>
      <script>alert('查無此人，請確認姓名');history.back();</script>
    </body></html>`,
    wantStatus: 'not_found',
  },
  {
    name: '搜尋結果列表 → name_mismatch',
    html: `<html><body>
      <style>A:link {color: blue}</style>
      <p>搜尋結果</p>
      <a href="add_classmbr5.php?mbr_id=1">張三</a>
      <a href="add_classmbr5.php?mbr_id=2">張三</a>
    </body></html>`,
    wantStatus: 'name_mismatch',
  },
  {
    name: 'plain success page (no alert, no style) → synced (regression)',
    html: `<html><body>新增成功 mbr_id=99887</body></html>`,
    wantStatus: 'synced',
  },
  {
    name: '無權限 page → forbidden (regression)',
    html: `<html><body>無權限存取此頁</body></html>`,
    wantStatus: 'forbidden',
  },
]

let addOk = true
for (const c of addCases) {
  const got = parseAddMemberResult(c.html)
  if (got.status !== c.wantStatus) {
    console.error(`[${c.name}] status got=${got.status} want=${c.wantStatus}`)
    addOk = false
    continue
  }
  if (c.messageMustNotInclude && got.message?.includes(c.messageMustNotInclude)) {
    console.error(`[${c.name}] message leaked forbidden substring "${c.messageMustNotInclude}": ${got.message}`)
    addOk = false
  }
  if (c.messageMustInclude && !got.message?.includes(c.messageMustInclude)) {
    console.error(`[${c.name}] message missing required substring "${c.messageMustInclude}": ${got.message}`)
    addOk = false
  }
}

// Verify the synced case actually extracted mbr_id from the alert+redirect HTML
const syncedCase = parseAddMemberResult(addCases[0].html)
if (syncedCase.status === 'synced' && syncedCase.iccfMemberId !== '12345') {
  console.error(`expected iccfMemberId=12345 from alert+redirect page, got ${syncedCase.iccfMemberId}`)
  addOk = false
}

if (!addOk) process.exit(1)
console.log('✓ parseAddMemberResult ok')

// ─── parseAddMemberSearchResult smoke ────────────────────────────────
//
// Real-fixture-derived test cases. The shape of these fixtures is hand-
// extracted from iccf's add_classmbr_thrd5.php response (寶光崇正 instance,
// April 2026). Names/IDs sanitized to synthetic values.

// Case A: 1 candidate found — typical "search for 王小明 returns one row"
const thrdFoundHtml = `
<html><head><meta http-equiv="Content-Type" content="text/html; charset=big5"></head>
<body>
  <style type="text/css">A:link {color: blue}</style>
  <table>
    <tr><td>共1 筆 -- 頁次 : 1 / 1</td></tr>
  </table>
  <form name=form_select_classmbr method=post action=../classmbr/add_classmbr_four5.php>
    <table>
      <tr>
        <td><input type=checkbox name=join[0] value='T'></td>
      </tr>
    </table>
    <input type=hidden name=noo[0] value='1'>
    <input type=hidden name=no[0] value='100001'>
    <input type=hidden name=no_mem[0] value='  200001'>
    <input type=hidden name=name[0] value='王小明'>
    <input type=hidden name=name_org[0] value='王大明'>
    <input type=hidden name=section_code[0] value='ZZZ001'>
    <input type=hidden name=section_name[0] value='測試001'>
    <input type=hidden name=sex[0] value='乾'>
    <input type=hidden name=birthday[0] value='19900101'>
    <input type=hidden name=Type_Is_Form value=True>
    <input type=hidden name=class_code value='B9999999'>
    <input type=hidden name=class_sec_code value='ZZZ'>
    <input type=hidden name=name_create value='    9999'>
    <input type=hidden name=tiov_geo_close value='Fn2B9'>
    <input type=hidden name=short_name value='測試班'>
    <input type=hidden name=method value='1'>
    <input type=hidden name=label value='add'>
    <input type=submit value=確定加入>
  </form>
</body></html>`

const found = parseAddMemberSearchResult(thrdFoundHtml)
let searchOk = true
if (found.status !== 'candidates') {
  console.error('[thrd5 found] expected candidates, got', found.status)
  searchOk = false
} else {
  if (found.candidates.length !== 1) {
    console.error('[thrd5 found] expected 1 candidate, got', found.candidates.length)
    searchOk = false
  }
  const c = found.candidates[0]
  if (c?.name !== '王小明') { console.error('candidate name wrong:', c?.name); searchOk = false }
  if (c?.nameOrg !== '王大明') { console.error('candidate name_org wrong:', c?.nameOrg); searchOk = false }
  if (c?.sectionName !== '測試001') { console.error('candidate section_name wrong:', c?.sectionName); searchOk = false }
  if (c?.idx !== 0) { console.error('candidate idx wrong:', c?.idx); searchOk = false }
  if (!c?.rowHidden.no_mem || c.rowHidden.no_mem.trim() !== '200001') {
    console.error('candidate no_mem wrong:', c?.rowHidden.no_mem); searchOk = false
  }
  if (!found.formAction.includes('add_classmbr_four5.php')) {
    console.error('formAction wrong:', found.formAction); searchOk = false
  }
  if (found.formHidden.class_code !== 'B9999999') {
    console.error('formHidden.class_code wrong:', found.formHidden.class_code); searchOk = false
  }
  if (found.formHidden.method !== '1') {
    console.error('formHidden.method wrong:', found.formHidden.method); searchOk = false
  }
}

// Case B: explicit not-found page — fixture text "中查無 [ 邱軒 ] 資料"
const thrdNotFoundHtml = `
<html><body>
  <style>A:link {color: blue}</style>
  <table><tr><td>共0 筆 -- 頁次 : 1 / 0</td></tr></table>
  <input type=hidden name=class_code value='B9999999'>
  <input type=hidden name=input value='不存在的人'>
  <table>
    <tr><td><font size=7 color=blue><b>◎ [ 道親資料庫 ] 中查無 [ </font><font size=7 color=red>不存在的人</font><font size=7 color=blue> ] 資料 ! </b></font></td></tr>
  </table>
</body></html>`

const nf = parseAddMemberSearchResult(thrdNotFoundHtml)
if (nf.status !== 'not_found') {
  console.error('[thrd5 notfound] expected not_found, got', nf.status)
  searchOk = false
}

// Case C: empty count without explicit 中查無 message — should still be not_found
const thrdEmptyHtml = `<html><body>共0 筆 -- 頁次 : 1 / 0</body></html>`
const empty = parseAddMemberSearchResult(thrdEmptyHtml)
if (empty.status !== 'not_found') {
  console.error('[thrd5 empty] expected not_found, got', empty.status)
  searchOk = false
}

// Case D: unrecognized page (not redirected to 班務 list, no matching markers)
const thrdUnknownHtml = `<html><body>登入過期，請重新登入</body></html>`
const unknown = parseAddMemberSearchResult(thrdUnknownHtml)
if (unknown.status !== 'unknown') {
  console.error('[thrd5 unknown] expected unknown, got', unknown.status)
  searchOk = false
}

// Case E: 2 candidates — same name across regions, parser must keep both
const thrdMultiHtml = `
<html><body>
  <form action=../classmbr/add_classmbr_four5.php method=post>
    <input type=hidden name=name[0] value='王小明'>
    <input type=hidden name=name_org[0] value='王小明'>
    <input type=hidden name=section_name[0] value='測試001'>
    <input type=hidden name=no_mem[0] value='200001'>
    <input type=hidden name=name[1] value='王小明'>
    <input type=hidden name=name_org[1] value='王小明'>
    <input type=hidden name=section_name[1] value='測試002'>
    <input type=hidden name=no_mem[1] value='200002'>
    <input type=hidden name=class_code value='B9999999'>
  </form>
</body></html>`

const multi = parseAddMemberSearchResult(thrdMultiHtml)
if (multi.status !== 'candidates' || multi.candidates.length !== 2) {
  const got = multi.status === 'candidates' ? multi.candidates.length : '(none)'
  console.error('[thrd5 multi] expected 2 candidates, got', multi.status, got)
  searchOk = false
}

if (!searchOk) process.exit(1)
console.log('✓ parseAddMemberSearchResult ok')
