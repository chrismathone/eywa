/**
 * scripts/_makeedu/import-students.cjs
 *
 * makeedu 원생목록 엑셀(47컬럼) → eywa `students` **additive 동기화**(makeedu_id 외부키, 0057a).
 * ⚠️ ijw 베이스가 정본. makeedu 학생을 (이름+학교+학년)로 ijw 학생에 매칭 → 매칭되면 makeedu_id만
 *    백필(ijw 값 절대 덮어쓰지 않음), ijw에 없는 학생만 신규 추가. dry-run도 DB를 읽어 매칭 건수를 측정.
 *
 * 사용:
 *   node --env-file=.env.local scripts/_makeedu/import-students.cjs          # dry-run(매칭 측정, DB write 0)
 *   node --env-file=.env.local scripts/_makeedu/import-students.cjs --apply  # 백필 + 신규 추가
 *
 * 입력: Downloads(또는 $MAKEEDU_DL)의 최신 '원생목록_*.xlsx'.
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const DL = process.env.MAKEEDU_DL || "C:/Users/user/Downloads";

function latestFile(prefix) {
  const cand = fs
    .readdirSync(DL)
    .filter((n) => n.startsWith(prefix) && n.endsWith(".xlsx"))
    .map((n) => ({ n, m: fs.statSync(path.join(DL, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!cand.length) throw new Error(`no '${prefix}*.xlsx' in ${DL}`);
  return path.join(DL, cand[0].n);
}

function txt(v) {
  if (v == null) return null;
  if (typeof v === "object") return (v.text || v.result || "").toString().trim() || null;
  const s = String(v).trim();
  return s || null;
}
// makeedu 날짜: 'YYYYMMDD' / 'YYYY-MM-DD' / 'YYYY.MM.DD(요일)' → 'YYYY-MM-DD'
function parseDate(v) {
  const s = txt(v);
  if (!s) return null;
  const d = s.replace(/[^0-9]/g, "");
  if (d.length >= 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return null;
}
function gender(v) {
  const s = txt(v);
  if (s === "남") return "male";
  if (s === "여") return "female";
  return null;
}

function mapRows(ws) {
  const head = (ws.getRow(1).values || []).map((v) => txt(v));
  const col = {};
  head.forEach((h, i) => {
    if (h) col[h] = i;
  });
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values || [];
    const get = (name) => (col[name] != null ? txt(vals[col[name]]) : null);
    const id = get("원생고유번호");
    if (!id) continue;
    // status 우선순위: 재원여부=O 면 무조건 재원(재등록생의 옛 퇴원일 잔존 무시) → 휴원 → 퇴원.
    const isEnrolled = get("재원여부") === "O";
    const onHold = get("휴원여부") === "O";
    const withdrawnDate = parseDate(get("퇴원일"));
    let status = "enrolled";
    if (isEnrolled) status = "enrolled";
    else if (onHold) status = "on_hold";
    else if (withdrawnDate) status = "withdrawn";
    const withdrawnAt = status === "withdrawn" ? withdrawnDate : null;
    rows.push({
      makeedu_id: id,
      name: get("이름"),
      gender: gender(get("성별")),
      attendance_code: get("출결번호"),
      school: get("학교"),
      grade: get("학년"),
      student_phone: get("원생연락처"),
      parent_phone: get("보호자연락처"),
      parent_name: get("보호자이름"),
      birth_date: parseDate(get("생일")),
      enrolled_at: parseDate(get("입학일")),
      address: [get("주소1"), get("주소2")].filter(Boolean).join(" ") || null,
      email: get("원생이메일"),
      status,
      withdrawn_at: withdrawnAt,
      notes: get("메모"),
    });
  }
  return rows;
}

(async () => {
  const file = latestFile("원생목록");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const rows = mapRows(wb.worksheets[0]);

  console.log("file:", path.basename(file));
  console.log("parsed students:", rows.length);
  console.log(
    "status dist:",
    rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
  );
  console.log("dup makeedu_id:", rows.length - new Set(rows.map((r) => r.makeedu_id)).size);
  console.log("missing name:", rows.filter((r) => !r.name).length);

  // ── additive: ijw 베이스가 정본. makeedu 학생을 (이름+학교+학년)로 ijw 학생에 매칭 →
  //    매칭되면 makeedu_id만 백필(ijw 값 보존), 매칭 안 되면 신규 추가. ijw 값은 절대 덮어쓰지 않음.
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    console.log("target tenant:", tenantId);
    const existing = await sql`
      select id, makeedu_id, name, school, grade from students where tenant_id = ${tenantId}`;
    const byMakeedu = new Map(existing.filter((e) => e.makeedu_id).map((e) => [e.makeedu_id, e.id]));
    const match = L.tieredMatcher(existing, [
      (r) => `${L.normalizeName(r.name)}|${r.school || ""}|${r.grade || ""}`,
      (r) => `${L.normalizeName(r.name)}|${r.grade || ""}`,
      (r) => L.normalizeName(r.name),
    ]);

    const toLink = []; // 기존 ijw 행에 makeedu_id 백필
    const toInsert = []; // ijw에 없는 신규 makeedu 학생
    let alreadyLinked = 0;
    for (const r of rows) {
      if (byMakeedu.has(r.makeedu_id)) { alreadyLinked++; continue; } // 재실행 멱등
      const id = match(r);
      if (id) toLink.push({ id, makeedu_id: r.makeedu_id });
      else toInsert.push(r);
    }
    console.log(`\n[additive] ijw 기존 학생 ${existing.length} | makeedu ${rows.length}`);
    console.log(`  이미 연결됨(재실행): ${alreadyLinked}`);
    console.log(`  ijw 매칭 → makeedu_id 백필: ${toLink.length}`);
    console.log(`  ijw에 없음 → 신규 추가: ${toInsert.length}`);
    if (toInsert.length) console.log("  신규 표본:", toInsert.slice(0, 5).map((r) => `${r.name}/${r.school || "?"}/${r.grade || "?"}`).join(", "));

    if (!APPLY) {
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }
    let linked = 0, inserted = 0;
    for (const t of toLink) {
      // makeedu_id가 비어있는 경우에만 백필(ijw 다른 필드는 손대지 않음).
      const res = await sql`
        update students set makeedu_id = ${t.makeedu_id}, updated_at = now()
        where id = ${t.id} and makeedu_id is null`;
      linked += res.count;
    }
    for (const r of toInsert) {
      await sql`
        insert into students
          (tenant_id, makeedu_id, name, gender, attendance_code, school, grade,
           student_phone, parent_phone, parent_name, birth_date, enrolled_at,
           address, email, status, withdrawn_at, notes)
        values
          (${tenantId}, ${r.makeedu_id}, ${r.name}, ${r.gender}, ${r.attendance_code},
           ${r.school}, ${r.grade}, ${r.student_phone}, ${r.parent_phone}, ${r.parent_name},
           ${r.birth_date}, ${r.enrolled_at}, ${r.address}, ${r.email}, ${r.status},
           ${r.withdrawn_at}, ${r.notes})
        on conflict (tenant_id, makeedu_id) where makeedu_id is not null do nothing`;
      inserted++;
    }
    await L.recordSync(sql, tenantId, "students", linked + inserted);
    console.log(`\nbackfilled makeedu_id: ${linked} | inserted new: ${inserted}`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
