/**
 * scripts/_makeedu/import-prospects.cjs — makeedu 예비원생관리 → eywa `enrollment_consultations` (makeedu_id 멱등, 0057a).
 * 입력: $MAKEEDU_OUT/prospects.json. outcome enum 매핑(등원가능성).
 *   node --env-file=.env.local scripts/_makeedu/import-prospects.cjs [--apply]
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const OUT = process.env.MAKEEDU_OUT || "D:/tmp/makeedu";
const idx = (H) => (s) => H.findIndex((h) => (h || "").includes(s));

// 등원가능성 자유텍스트 → enrollment_consultations.outcome enum.
function outcome(v) {
  const s = L.txt(v) || "";
  if (/등록\s*완료|등록함|등록$/.test(s)) return "enrolled";
  if (/거절|미등록|안\s*함/.test(s)) return "declined";
  if (/노쇼|불참/.test(s)) return "no_show";
  if (/상담\s*완료/.test(s)) return "consulted";
  if (/예약|예정/.test(s)) return "scheduled";
  return "pending"; // "선택"·보류·미입력
}

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(OUT, "prospects.json"), "utf8"));
  const H = idx(data.headers);
  const ci = { name: H("이름"), school: H("학교"), grade: H("학년"), parent: H("보호자연락처"), stud: H("원생연락처"), like: H("등원가능성"), cdate: H("상담일") };
  const rows = [];
  for (const r of data.rows) {
    const name = L.txt(r[ci.name]);
    if (!name || name === "신규") continue;
    rows.push({
      makeedu_id: L.txt(r[0]),
      prospect_name: name,
      prospect_school: L.txt(r[ci.school]),
      prospect_grade: L.gradeNorm(r[ci.grade]),
      parent_phone: L.normPhone(r[ci.parent]),
      student_phone: L.normPhone(r[ci.stud]),
      outcome: outcome(r[ci.like]),
      consulted_at: L.parseTimestamp(r[ci.cdate]),
    });
  }
  console.log("file: prospects.json  parsed:", rows.length);
  console.log("outcome dist:", rows.reduce((a, r) => ((a[r.outcome] = (a[r.outcome] || 0) + 1), a), {}));
  console.log("dup makeedu_id:", rows.length - new Set(rows.map((r) => r.makeedu_id)).size, "| missing name:", rows.filter((r) => !r.prospect_name).length);
  console.log("sample:", JSON.stringify(rows[0]));

  if (!APPLY) {
    console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
    return;
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    let up = 0;
    for (const r of rows) {
      await sql`
        insert into enrollment_consultations
          (tenant_id, makeedu_id, prospect_name, prospect_school, prospect_grade, parent_phone, student_phone, outcome, consulted_at)
        values (${tenantId}, ${r.makeedu_id}, ${r.prospect_name}, ${r.prospect_school}, ${r.prospect_grade},
                ${r.parent_phone}, ${r.student_phone}, ${r.outcome}, ${r.consulted_at ?? null})
        on conflict (tenant_id, makeedu_id) where makeedu_id is not null
        do update set prospect_name = excluded.prospect_name, prospect_school = excluded.prospect_school,
          prospect_grade = excluded.prospect_grade, parent_phone = excluded.parent_phone,
          student_phone = excluded.student_phone, outcome = excluded.outcome, updated_at = now()`;
      up++;
    }
    await L.recordSync(sql, tenantId, "prospects", up);
    console.log("upserted prospects:", up);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
