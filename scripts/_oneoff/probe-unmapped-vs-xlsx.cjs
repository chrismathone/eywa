// Read-only: Edutrix unmapped (reports>0) × makeedu 원생목록 xlsx name match.
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const { createClient } = require("@supabase/supabase-js");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const FILE =
  process.argv[2] ||
  path.join(process.env.USERPROFILE || "C:/Users/user", "Downloads", "원생목록_20260710153700.xlsx");

function txt(v) {
  if (v == null) return null;
  if (typeof v === "object") return (v.text || v.result || "").toString().trim() || null;
  const s = String(v).trim();
  return s || null;
}
function parseDate(v) {
  const s = txt(v);
  if (!s) return null;
  const d = s.replace(/[^0-9]/g, "");
  if (d.length >= 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return null;
}
function norm(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .toLowerCase();
}
function isDummy(name, school, grade) {
  const n = (name || "").trim();
  if (/^학원[일이삼사오육칠팔구십\dA-Za-z]+$/.test(n)) return true;
  if (/^(테스트|test|demo)/i.test(n)) return true;
  const ph = (s) => !s || /^(미입력|미정|없음|-|—)$/i.test(String(s).trim());
  return ph(school) && ph(grade);
}

(async () => {
  const edu = createClient(process.env.EDUTRIX_SUPABASE_URL, process.env.EDUTRIX_SUPABASE_ANON_KEY);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

  const mapped = new Set(
    (await sql`select edutrix_student_id from students where tenant_id = ${TENANT} and edutrix_student_id is not null`).map(
      (r) => r.edutrix_student_id,
    ),
  );

  const reportCount = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await edu.from("reports").select("student_id").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) {
      if (!r.student_id) continue;
      reportCount.set(r.student_id, (reportCount.get(r.student_id) || 0) + 1);
    }
    if (data.length < 1000) break;
  }

  const unmapped = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await edu.from("students").select("id, name, school, grade").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const s of data) {
      if (mapped.has(s.id)) continue;
      const rc = reportCount.get(s.id) || 0;
      if (rc === 0) continue;
      unmapped.push({
        id: s.id,
        name: s.name,
        school: s.school,
        grade: s.grade,
        rc,
        dummy: isDummy(s.name, s.school, s.grade),
      });
    }
    if (data.length < 1000) break;
  }

  // parse xlsx
  if (!fs.existsSync(FILE)) throw new Error("xlsx not found: " + FILE);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];
  const head = (ws.getRow(1).values || []).map(txt);
  const col = {};
  head.forEach((h, i) => {
    if (h) col[h] = i;
  });

  const byExact = new Map(); // name -> rows
  const byNorm = new Map();
  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values || [];
    const get = (n) => (col[n] != null ? txt(vals[col[n]]) : null);
    const id = get("원생고유번호");
    if (!id) continue;
    const name = get("이름");
    if (!name) continue;
    const isEnrolled = get("재원여부") === "O";
    const onHold = get("휴원여부") === "O";
    const wd = parseDate(get("퇴원일"));
    let status = "enrolled";
    if (isEnrolled) status = "enrolled";
    else if (onHold) status = "on_hold";
    else if (wd) status = "withdrawn";
    const row = {
      makeedu_id: id,
      name,
      school: get("학교"),
      grade: get("학년"),
      status,
      withdrawn_at: status === "withdrawn" ? wd : null,
      parent_phone: get("보호자연락처"),
    };
    if (!byExact.has(name)) byExact.set(name, []);
    byExact.get(name).push(row);
    const n = norm(name);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(row);
  }

  let exact1 = 0;
  let exactMany = 0;
  let normOnly = 0;
  let none = 0;
  let dummyNone = 0;
  let realHits = [];
  let realMiss = [];

  for (const u of unmapped) {
    const exact = byExact.get(u.name) || [];
    const normHits = exact.length ? exact : byNorm.get(norm(u.name)) || [];
    const hits = exact.length ? exact : normHits;
    const via = exact.length ? "exact" : normHits.length ? "norm" : "none";

    if (via === "none") {
      none++;
      if (u.dummy) dummyNone++;
      else realMiss.push(u);
      continue;
    }
    if (via === "norm") normOnly++;
    if (hits.length === 1) exact1++;
    else exactMany++;

    if (!u.dummy) {
      realHits.push({
        edutrix: { name: u.name, school: u.school, grade: u.grade, rc: u.rc },
        via,
        makeedu: hits.map((h) => ({
          id: h.makeedu_id,
          name: h.name,
          school: h.school,
          grade: h.grade,
          status: h.status,
          wd: h.withdrawn_at,
        })),
      });
    }
  }

  console.log("=== unmapped Edutrix (reports>0) ===", unmapped.length);
  console.log("  dummy:", unmapped.filter((u) => u.dummy).length);
  console.log("  real (not dummy):", unmapped.filter((u) => !u.dummy).length);

  console.log("\n=== vs xlsx name match (all unmapped) ===");
  console.log({
    exactOrNorm_1: exact1,
    exactOrNorm_many: exactMany,
    normOnly_extra: normOnly,
    none,
    noneOfWhichDummy: dummyNone,
    noneReal: realMiss.length,
  });

  console.log("\n=== REAL unmapped that MATCH xlsx ===", realHits.length);
  realHits.forEach((h) => console.log(JSON.stringify(h)));

  console.log("\n=== REAL unmapped with NO xlsx name ===", realMiss.length);
  realMiss
    .sort((a, b) => b.rc - a.rc)
    .forEach((u) => console.log(JSON.stringify({ name: u.name, school: u.school, grade: u.grade, rc: u.rc })));

  await sql.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
