// 반명 시트 정합 — `고등E_고1 특별S` → `고등E_고1 특별 S` (시트 표기, 공백 포함).
// 시트↔aywa 전격비교(2026-07-06)에서 발견: 배치는 일치, 반명 띄어쓰기만 상이.
// 참조는 전부 class_id FK라 rename 안전. unique (tenant_id, class_name, subject) 충돌 없음(사전 확인).
// 사용: node --env-file=.env.local scripts/_english_sync/fix-classname-teukbyeol-s.cjs [--apply]
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const CLASS_ID = "2859b774-0e33-4a71-a805-3b0b1c0338bd";
const FROM = "고등E_고1 특별S";
const TO = "고등E_고1 특별 S";
const APPLY = process.argv.includes("--apply");
const ART_DIR = process.env.ENGLISH_SYNC_ART_DIR || path.join(__dirname, "_artifacts");

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
  try {
    const rows = await sql`
      select id, class_name, subject, tenant_id from classes
      where id = ${CLASS_ID} and tenant_id = ${TENANT} and subject = 'english'`;
    if (rows.length !== 1) throw new Error(`대상 반 1행 기대, 실제 ${rows.length}`);
    const cur = rows[0];
    console.log(`현재: "${cur.class_name}"`);

    if (cur.class_name === TO) {
      console.log("이미 적용됨(멱등) — 변경 없음.");
      return;
    }
    if (cur.class_name !== FROM) throw new Error(`예상 반명 "${FROM}" 아님 — 중단`);

    // 충돌 재확인 (unique tenant+name+subject)
    const dup = await sql`
      select id from classes where tenant_id = ${TENANT} and subject = 'english' and class_name = ${TO}`;
    if (dup.length > 0) throw new Error(`"${TO}" 이미 존재(${dup[0].id}) — 중단`);

    if (!APPLY) {
      console.log(`[dry-run] UPDATE classes SET class_name='${TO}' WHERE id=${CLASS_ID} — --apply로 실행`);
      return;
    }

    fs.mkdirSync(ART_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(ART_DIR, "CLASSNAME_UNDO_2026-07-06.json"),
      JSON.stringify({ table: "classes", id: CLASS_ID, before: cur.class_name, after: TO }, null, 1),
    );
    await sql`update classes set class_name = ${TO} where id = ${CLASS_ID}`;
    const after = await sql`select class_name from classes where id = ${CLASS_ID}`;
    console.log(`적용 완료: "${after[0].class_name}" (undo → _artifacts/CLASSNAME_UNDO_2026-07-06.json)`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
