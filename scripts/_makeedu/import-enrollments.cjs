/**
 * scripts/_makeedu/import-enrollments.cjs — 학생 엑셀 '수업' 컬럼 → aywa `enrollments` (자연키 student_id+class_id).
 * 원생목록 엑셀의 '수업' 셀(반 + 교재/기타 혼재)을 분해해 **임포트된 classes 이름과 일치하는 토큰만** 수강으로 매핑
 * (교재/기타 라인은 일치 반이 없어 자연 제외). 학생=makeedu_id, 반=class_name 정규화 일치.
 * ⚠️ classes·students(makeedu) 임포트 후 실행. 입력: Downloads 최신 원생목록*.xlsx + DB.
 *   node --env-file=.env.local scripts/_makeedu/import-enrollments.cjs [--apply]
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const DL = process.env.MAKEEDU_DL || "C:/Users/user/Downloads";

function latestFile(prefix) {
  const cand = fs.readdirSync(DL).filter((n) => n.startsWith(prefix) && n.endsWith(".xlsx"))
    .map((n) => ({ n, m: fs.statSync(path.join(DL, n)).mtimeMs })).sort((a, b) => b.m - a.m);
  if (!cand.length) throw new Error(`no '${prefix}*.xlsx' in ${DL}`);
  return path.join(DL, cand[0].n);
}
const normCls = (s) => (s || "").toLowerCase().replace(/[\s\[\]()（）]/g, "");

(async () => {
  const file = latestFile("원생목록");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const head = (ws.getRow(1).values || []).map((v) => L.txt(v));
  const col = {};
  head.forEach((h, i) => { if (h) col[h] = i; });
  const C = (name) => col[name];
  // 학생별 (makeedu_id, 수업셀, 입학일)
  const students = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values || [];
    const id = L.txt(vals[C("원생고유번호")]);
    if (!id) continue;
    students.push({ makeedu_id: id, classesRaw: L.txt(vals[C("수업")]) || "", enrolledAt: (function () { const d = L.txt(vals[C("입학일")]); return d ? d.replace(/[^0-9]/g, "").replace(/^(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3") : null; })() });
  }
  console.log("file:", path.basename(file), "students:", students.length);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const studRows = await sql`select id, makeedu_id from students where tenant_id = ${tenantId} and makeedu_id is not null`;
    const sById = new Map(studRows.map((s) => [s.makeedu_id, s.id]));
    const clsRows = await sql`select id, class_name from classes where tenant_id = ${tenantId}`;
    const cByName = new Map(clsRows.map((c) => [normCls(c.class_name), c.id]));
    const existing = new Set((await sql`select student_id, class_id from enrollments where tenant_id = ${tenantId}`).map((e) => `${e.student_id}|${e.class_id}`));

    const pairs = [];
    const seen = new Set();
    let tokens = 0, matchedTok = 0;
    for (const s of students) {
      const sid = sById.get(s.makeedu_id);
      if (!sid) continue;
      const parts = s.classesRaw.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
      for (const p of parts) {
        tokens++;
        if (L.isNonClass(p)) continue; // 교재/사용료 라인은 수강 아님(반에도 없음, 이중 방어)
        const cid = cByName.get(normCls(p));
        if (!cid) continue;
        matchedTok++;
        const key = `${sid}|${cid}`;
        if (seen.has(key) || existing.has(key)) continue;
        seen.add(key);
        pairs.push({ student_id: sid, class_id: cid, start_date: s.enrolledAt || "2024-03-01" });
      }
    }
    console.log(`student matched: ${[...new Set(students.map((s) => s.makeedu_id))].filter((id) => sById.has(id)).length}/${students.length}`);
    console.log(`class tokens: ${tokens} matched ${matchedTok} | new enrollments: ${pairs.length} (classes in db: ${clsRows.length})`);

    if (!APPLY) { console.log("[DRY-RUN] --apply 없이 종료 (DB write 0)."); return; }
    let up = 0;
    for (const p of pairs) {
      try {
        await sql`insert into enrollments (tenant_id, student_id, class_id, start_date, attendance_days)
          values (${tenantId}, ${p.student_id}, ${p.class_id}, ${p.start_date}, ${sql`'{}'::text[]`})`;
        up++;
      } catch (e) {
        if (!/exclusion|overlap|duplicate/i.test(e.message)) throw e; // 중복/겹침만 무시
      }
    }
    await L.recordSync(sql, tenantId, "enrollments", up);
    console.log("inserted enrollments:", up);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
