/**
 * scripts/_makeedu/import-students.cjs
 *
 * makeedu 원생목록 엑셀(47컬럼) → eywa `students` 멱등 upsert (makeedu_id 키, 0057a).
 * makeedu가 진실(source of truth) — 운영 필드만 덮어쓰고 eywa 고유(aiCare*)는 SET에서 제외.
 *
 * 사용:
 *   node --env-file=.env.local scripts/_makeedu/import-students.cjs          # dry-run(매핑 검증, DB write 0)
 *   node --env-file=.env.local scripts/_makeedu/import-students.cjs --apply  # 실제 upsert
 *
 * 입력: Downloads(또는 $MAKEEDU_DL)의 최신 '원생목록_*.xlsx'.
 * ⚠️ --apply는 Phase 1 wipe(데모 비우기) 이후에만 — wipe 전엔 기존 ijw 564명과 별개로 412명이 추가됨(중복).
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
  const dup = rows.length - new Set(rows.map((r) => r.makeedu_id)).size;
  console.log("dup makeedu_id:", dup);
  console.log("missing name:", rows.filter((r) => !r.name).length);
  console.log("sample:", JSON.stringify(rows[0], null, 1));

  if (!APPLY) {
    console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
    return;
  }

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const ten = await sql`select id from tenants order by created_at limit 1`;
    const tenantId = ten[0].id;
    console.log("target tenant:", tenantId);
    let up = 0;
    for (const r of rows) {
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
        on conflict (tenant_id, makeedu_id) where makeedu_id is not null
        do update set
          name = excluded.name, gender = excluded.gender, attendance_code = excluded.attendance_code,
          school = excluded.school, grade = excluded.grade, student_phone = excluded.student_phone,
          parent_phone = excluded.parent_phone, parent_name = excluded.parent_name,
          birth_date = excluded.birth_date, enrolled_at = excluded.enrolled_at,
          address = excluded.address, email = excluded.email, status = excluded.status,
          withdrawn_at = excluded.withdrawn_at, notes = excluded.notes, updated_at = now()`;
      up++;
    }
    await L.recordSync(sql, tenantId, "students", up);
    console.log("upserted:", up);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
