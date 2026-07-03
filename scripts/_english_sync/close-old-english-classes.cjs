// 옛 영어 반 19개 정리 — 시트(7월)에 없고 열린 수강 0인 반.
//
// ⚠️ 핸드오프 원문은 "is_active=false + closed_at"이나 eywa 의미론(CLAUDE.md 수업 종강 섹션)상:
//   - 폐지(is_active=false) = 잘못 만든 반 완전 제거 → 타임머신(과거 주)에서도 숨김
//   - 종강(closed_at, is_active 유지) = 정상 운영 종료 → 종강일 이전 주엔 수강이력 표시
// 이 19개 중 18개는 실제 수강 이력(3~10건)이 있는 정상 반 → **종강(closed_at='2026-07-02')**.
// '고등특강(테스트)'만 이력 0 + 테스트 반 → **폐지(is_active=false)**.
//
// 실행: node --env-file=.env.local scripts/_english_sync/close-old-english-classes.cjs [--apply]

const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const ART_DIR = "D:/영어시간표/_english-sync-artifacts";
const CLOSE_AT = "2026-07-02"; // 마지막 운영일 (enrollment 전환 [start,end) 컷오버와 정합)
const CUTOVER = "2026-07-03"; // 열린 수강 판정 기준(daterange [start,end) — end=07-03이면 07-02까지 재원)
const APPLY = process.argv.includes("--apply");

const TO_CLOSE = [
  "LE4", "PJ4", "고등E_고2 SKY", "LT1", "PL5", "고등E_고1 특별", "고등E_고1 정규 A",
  "RTT3", "DP2", "LS2", "고등E_고1 정규 B", "LT4b", "JP6", "KW3", "고등E_고2 TOP",
  "PJ2", "LT4a", "LS1",
];
const TO_ARCHIVE = ["고등특강(테스트)"]; // 이력 0 = 폐지

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
  try {
    const all = [...TO_CLOSE, ...TO_ARCHIVE];
    const rows = await sql`
      select c.id, c.class_name, c.is_active, c.closed_at,
        (select count(*) from enrollments e where e.class_id = c.id
           and (e.end_date is null or e.end_date > ${CUTOVER})) as open_enr
      from classes c
      where c.tenant_id = ${TENANT} and c.subject = 'english' and c.class_name = any(${all})`;

    if (rows.length !== all.length) {
      const found = new Set(rows.map((r) => r.class_name));
      throw new Error(`반 개수 불일치: 기대 ${all.length}, 실제 ${rows.length}. 누락: ${all.filter((n) => !found.has(n)).join(", ")}`);
    }
    const withOpen = rows.filter((r) => Number(r.open_enr) > 0);
    if (withOpen.length) {
      throw new Error(`열린 수강 있는 반 — 중단: ${withOpen.map((r) => `${r.class_name}(${r.open_enr})`).join(", ")}`);
    }

    console.log("=== 계획 ===");
    for (const r of rows) {
      const mode = TO_ARCHIVE.includes(r.class_name) ? `폐지(is_active=false)` : `종강(closed_at=${CLOSE_AT})`;
      console.log(`  ${r.class_name}: ${mode} (현재 active=${r.is_active}, closed_at=${r.closed_at ?? "-"})`);
    }
    if (!APPLY) {
      console.log("\n(dry-run — 쓰기 없음. --apply로 적용)");
      return;
    }

    const undo = rows.map((r) => ({ id: r.id, className: r.class_name, prevIsActive: r.is_active, prevClosedAt: r.closed_at }));
    await sql.begin(async (tx) => {
      const closeIds = rows.filter((r) => TO_CLOSE.includes(r.class_name)).map((r) => r.id);
      const archIds = rows.filter((r) => TO_ARCHIVE.includes(r.class_name)).map((r) => r.id);
      await tx`update classes set closed_at = ${CLOSE_AT} where tenant_id = ${TENANT} and id = any(${closeIds})`;
      await tx`update classes set is_active = false where tenant_id = ${TENANT} and id = any(${archIds})`;
    });
    const stamp = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(ART_DIR, `CLASSES_UNDO_${stamp}.json`), JSON.stringify(undo, null, 1));
    console.log(`적용 완료: 종강 ${TO_CLOSE.length} + 폐지 ${TO_ARCHIVE.length}. 언두: CLASSES_UNDO_${stamp}.json`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
