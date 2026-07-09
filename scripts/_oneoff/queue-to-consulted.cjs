/**
 * 등록상담 대기·예약(pending/scheduled) 전건 → 상담 완료(consulted) 일괄 이동.
 * 사용: node scripts/_oneoff/queue-to-consulted.cjs        (dry-run: 대상 카운트만)
 *       node scripts/_oneoff/queue-to-consulted.cjs --apply (실제 적용 + UNDO 파일 기록)
 * 되돌리기: UNDO JSON의 rows를 읽어 id별 outcome 원복.
 */
const fs = require("node:fs");
const path = require("node:path");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // 인재원
const APPLY = process.argv.includes("--apply");

function loadDatabaseUrl() {
  const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(".env.local에 DATABASE_URL 없음");
  return m[1].trim().replace(/^"|"$/g, "");
}

async function main() {
  const postgres = require("postgres");
  const sql = postgres(loadDatabaseUrl(), { ssl: "require", max: 1 });
  try {
    const rows = await sql`
      SELECT id, outcome, prospect_name FROM enrollment_consultations
      WHERE tenant_id = ${TENANT} AND outcome IN ('pending','scheduled')
      ORDER BY consulted_at DESC`;
    const byOutcome = rows.reduce((a, r) => ((a[r.outcome] = (a[r.outcome] ?? 0) + 1), a), {});
    console.log(`대상: ${rows.length}건`, byOutcome);

    if (!APPLY) {
      console.log("(dry-run — 적용하려면 --apply)");
      return;
    }

    const undoPath = path.join(__dirname, `QUEUE_TO_CONSULTED_UNDO_2026-07-08.json`);
    fs.writeFileSync(
      undoPath,
      JSON.stringify({ appliedAt: new Date().toISOString(), tenant: TENANT, rows: rows.map(({ id, outcome }) => ({ id, outcome })) }, null, 1),
    );
    console.log(`UNDO 기록: ${undoPath}`);

    const ids = rows.map((r) => r.id);
    const updated = await sql`
      UPDATE enrollment_consultations
      SET outcome = 'consulted', updated_at = now()
      WHERE tenant_id = ${TENANT} AND id = ANY(${ids}) AND outcome IN ('pending','scheduled')
      RETURNING id`;
    console.log(`적용 완료: ${updated.length}건 → consulted`);

    const remain = await sql`
      SELECT count(*)::int AS n FROM enrollment_consultations
      WHERE tenant_id = ${TENANT} AND outcome IN ('pending','scheduled')`;
    console.log(`잔여 대기·예약: ${remain[0].n}건`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
