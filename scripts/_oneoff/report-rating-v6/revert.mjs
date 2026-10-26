// 평점 기준 v6 재채점 되돌리기 — rerate.ts submit이 남긴 backup.json(옛 평점 줄 전부)으로 표를 그대로 되돌린다.
// 사용: node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/report-rating-v6/revert.mjs --backup D:/tmp/rating-v6-rerate/backup.json [--apply]
// 기본 = 미리보기(바뀔 줄 수만). --apply = 한 거래로 덮어쓰기(지점 일치 확인).
// ⚠️ 되돌린 뒤 화면에 옛 점수를 다시 보이려면 코드도 함께 되돌려야 한다(화면은 기준 v6 줄만 읽는다 — report-admin/server/report-ratings.ts).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const postgres = createRequire(import.meta.url)("postgres");
const i = process.argv.indexOf("--backup");
if (i < 0) throw new Error("--backup <backup.json> 이 필요합니다");
const backup = JSON.parse(readFileSync(process.argv[i + 1], "utf8"));
const APPLY = process.argv.includes("--apply");
const COLS = ["report_id", "tenant_id", "points", "items", "parent_feeling", "suggestion", "claim", "claim_reason", "rubric", "model", "rated_on", "created_at", "input_hash"];
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
try {
  const rows = backup.rows.filter((r) => r.tenant_id === backup.tenantId);
  if (rows.length !== backup.rows.length) throw new Error("백업에 다른 지점 줄이 섞여 있습니다");
  const now = await sql`select rubric, count(*)::int n from lesson_report_ratings where tenant_id=${backup.tenantId} group by 1`;
  console.log(JSON.stringify({ 백업줄: rows.length, 백업시각: backup.at, 지금표: now }));
  if (!APPLY) { console.log("미리보기 — --apply를 붙이면 백업 값으로 덮어씁니다"); process.exit(0); }
  await sql.begin(async (tx) => {
    for (let k = 0; k < rows.length; k += 500) {
      const part = rows.slice(k, k + 500).map((r) => ({ ...Object.fromEntries(COLS.map((c) => [c, r[c] ?? null])), items: tx.json(r.items ?? []) }));
      await tx`insert into lesson_report_ratings ${tx(part, ...COLS)}
        on conflict (report_id) do update set points=excluded.points, items=excluded.items, parent_feeling=excluded.parent_feeling,
          suggestion=excluded.suggestion, claim=excluded.claim, claim_reason=excluded.claim_reason, rubric=excluded.rubric,
          model=excluded.model, rated_on=excluded.rated_on, created_at=excluded.created_at, input_hash=excluded.input_hash
        where lesson_report_ratings.tenant_id = excluded.tenant_id`;
    }
  });
  console.log("되돌림:", JSON.stringify(await sql`select rubric, count(*)::int n from lesson_report_ratings where tenant_id=${backup.tenantId} group by 1`));
} finally { await sql.end(); }
