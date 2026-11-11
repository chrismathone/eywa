// 상담 평점 — 구독 CLI 일괄 평점 결과를 운영 DB(student_consultation_ratings, source='cli')에 올린다.
// node --env-file=.env.local scripts/_oneoff/consult-rating/deliver.mjs <runs/파일.jsonl> [--commit]
//  · 기본은 **롤백 시험**(--commit이 있어야 반영). 한 트랜잭션. 침산(cs)만. 지금 기준(c1)으로 매긴 줄만.
//  · 평점 행의 source_updated_at = 추출 때 그 상담의 updated_at(cs-all.jsonl) — 그 뒤에 고쳐진 상담은 정기 처리가 입력 지문으로 다시 확인한다.
//  · 🔴 이 단계만 DB 쓰기다 — 평가 단계(rate.ts)에는 .env.local을 싣지 않는다.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

const ROOT = join(homedir(), "eywa-data", "consult-rating");
const file = process.argv[2];
const commit = process.argv.includes("--commit");
if (!file) throw new Error("사용법: deliver.mjs <runs/파일.jsonl> [--commit]");
const RUBRIC = "c1";
const lines = readFileSync(file.startsWith("/") ? file : join(ROOT, "04-ratings", "runs", file), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rows = lines.filter((x) => x.ok && x.row && x.row.rubric === RUBRIC).map((x) => x.row);
const extractedAt = statSync(join(ROOT, "cs-all.jsonl")).mtime.toISOString();
// 재료를 읽던 때(= 추출) 그 상담의 updated_at — 평점 행의 source_updated_at. 그 뒤에 고쳐진 상담은 정기 처리가 입력 지문으로 다시 확인한다(상담.updated_at > source_updated_at).
const sourceAt = new Map(readFileSync(join(ROOT, "cs-all.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r.updated_at]; }));
const ratedOn = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
console.log(`올릴 줄 ${rows.length}건 / 파일 ${lines.length}건 · 추출 시각 ${extractedAt} · 반영 ${commit ? "예" : "아니오(롤백 시험)"}`);

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false, connection: { application_name: "aywa-consult-rating-deliver" } });
try {
  await sql.begin(async (tx) => {
    const [{ id: tenant }] = await tx`select id from tenants where slug = 'cs'`;
    const ids = rows.map((r) => r.consultation_id);
    const found = new Set();
    for (let i = 0; i < ids.length; i += 500) for (const r of await tx`select id from student_consultations where tenant_id = ${tenant} and id in ${tx(ids.slice(i, i + 500))}`) found.add(r.id);
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) throw new Error(`이 지점 상담이 아닌 id ${missing.length}건 — 중단`);
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((r) => ({
        consultation_id: r.consultation_id, tenant_id: tenant, points: r.points, reason: r.reason ?? "", evidence: r.evidence ?? "",
        kinds: tx.json(r.kinds ?? []), checks: tx.json(r.checks ?? {}), rule: r.rule ?? null, basis: r.basis ?? "memo", rubric: r.rubric, model: r.model,
        source: "cli", input_hash: r.input_hash, rated_on: ratedOn, source_updated_at: sourceAt.get(r.consultation_id) ?? null, updated_at: extractedAt,
      }));
      await tx`insert into student_consultation_ratings ${tx(chunk)}
        on conflict (consultation_id) do update set points = excluded.points, reason = excluded.reason, evidence = excluded.evidence, kinds = excluded.kinds,
          checks = excluded.checks, rule = excluded.rule, basis = excluded.basis, rubric = excluded.rubric, model = excluded.model, source = excluded.source,
          input_hash = excluded.input_hash, rated_on = excluded.rated_on, source_updated_at = excluded.source_updated_at, updated_at = excluded.updated_at`;
    }
    const dist = await tx`select points, count(*)::int n from student_consultation_ratings where tenant_id = ${tenant} and rubric = ${RUBRIC} group by 1 order by 1`;
    const tot = await tx`select count(*)::int n, count(*) filter (where rule is not null)::int ruled, count(*) filter (where basis = 'recording')::int rec, count(*) filter (where source = 'cli')::int cli from student_consultation_ratings where tenant_id = ${tenant}`;
    console.log("표 안 분포(전체)", JSON.stringify(dist), JSON.stringify(tot[0]));
    if (!commit) throw new Error("__ROLLBACK__");
  }).catch((e) => { if (e.message !== "__ROLLBACK__") throw e; console.log("롤백 시험 끝 — 반영하지 않았다"); });
  if (commit) console.log("반영 완료");
} finally { await sql.end({ timeout: 5 }); }
