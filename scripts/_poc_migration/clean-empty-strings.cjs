// 전체 재복원 마지막 단계(step 11) — 빈 문자열("")로 저장된 텍스트 컬럼을 null로 정리.
// ijw는 부재 값을 종종 ""로 저장하는데 run.ts의 `?? null`은 ""를 못 잡아 "빈 값이 채워진 것처럼" 보인다.
// 순수 정리(멱등). 사용: node --env-file=.env.local scripts/_poc_migration/clean-empty-strings.cjs
const fs = require("fs");
const postgres = require("postgres");
let url = process.env.DATABASE_URL;
if (!url) { const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8"); url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, ""); }
const T = "becaa316-e636-42e9-9d09-08b133e0b094"; // ijw-demo(=injaewon)
const COLS = {
  students: ["address", "address_detail", "zip_code", "email", "nickname", "graduation_year", "other_phone", "home_phone", "student_phone", "parent_relation"],
  enrollment_consultations: ["address", "registrar", "non_registration_reason", "follow_up_content", "career_goal", "siblings", "consultation_path", "student_phone", "parent_relation", "blood_type", "subject", "parent_request", "registration_status"],
  classes: ["notes"],
  users: ["phone", "default_classroom", "memo"],
};
const sql = postgres(url, { prepare: false });
(async () => {
  let total = 0;
  for (const [t, cols] of Object.entries(COLS)) {
    for (const col of cols) {
      const r = await sql`update ${sql(t)} set ${sql(col)} = null where tenant_id=${T} and btrim(${sql(col)}) = ''`;
      if (r.count) { console.log(`  ${t}.${col}: ${r.count} → null`); total += r.count; }
    }
  }
  console.log(`done. ${total} cells cleaned.`);
  await sql.end();
})().catch((err) => { console.error(err); process.exit(1); });
