/**
 * 강사평가 마감 달 담임 판정 정정 **되돌리기** — apply.mts가 남긴 백업 파일의 원본 행으로 되살린다(한 트랜잭션).
 * 행마다 지금 행을 지우고(정정 뒤 다시 넣은 행 · 없으면 그대로) 원본을 다시 넣는다. 감사로그 한 줄(metadata.revert).
 * 🔴 지금 행이 적용 기록과 같을 때만 — 고친 행은 그때의 집계 시각 그대로(행 잠금 뒤 견줌) · 지운 행은 아직 없음(넣을 때 키가 이미 있으면
 *    멈춤 — 없는 행은 잠글 수 없어 '없음 확인 → 넣기' 사이에 생긴 행을 지우지 않게). 하나라도 다르면 전부 멈춘다(그 뒤의 작업을 덮지 않게).
 * 적용 기록 = applied-*.json 또는 `audit:latest`(그 지점의 마지막 정정 감사로그 metadata.applied — 파일을 잃었을 때).
 *
 * 실행: TSX_TSCONFIG_PATH=scripts/_oneoff/portfolio-revision/tsconfig.json \
 *   node --env-file=.env.local --import tsx scripts/_oneoff/portfolio-revision/restore.mts --backup=<backup-*.json> --applied=<applied-*.json | audit:latest> [--apply]
 * `--apply`가 없으면 확인만 하고 되돌린다.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const BACKUP = process.argv.find((a) => a.startsWith("--backup="))?.slice(9);
const APPLIED = process.argv.find((a) => a.startsWith("--applied="))?.slice(10);
const APPLY = process.argv.includes("--apply");
if (!BACKUP || !APPLIED) throw new Error("--backup=<backup-*.json> --applied=<applied-*.json | audit:latest> 이 필요합니다");
const ACTOR = "system:portfolio-revision(되돌리기)";

type Row = {
  tenant_id: string; teacher_id: string; month: string; period_end: string; total: string | null; known_count: number; class_count: number;
  subjects: string[]; payload: unknown; closed_at: string | null; closing_source: string | null; computed_at: string; raws: unknown;
};
const backup = JSON.parse(readFileSync(BACKUP, "utf8")) as { tenantId: string; rows: Row[] };
type Applied = { teacherId: string; month: string; kind: "revise" | "remove"; computedAt: string | null };
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
let appliedRows: Applied[];
if (APPLIED === "audit:latest") {
  const [log] = await sql`select metadata->'applied' as applied from public.audit_logs
    where tenant_id = ${backup.tenantId} and action = 'teacher_portfolio_homeroom_fix' and metadata ? 'applied' order by created_at desc limit 1`;
  if (!log?.applied) { await sql.end(); throw new Error("감사로그에 적용 기록이 없습니다"); }
  appliedRows = log.applied as Applied[];
} else {
  appliedRows = (JSON.parse(readFileSync(APPLIED, "utf8")) as { rows: Applied[] }).rows;
}
const appliedOf = new Map(appliedRows.map((r) => [`${r.teacherId}|${r.month}`, r]));
class DryRun extends Error {}
try {
  await sql.begin(async (tx) => {
    for (const r of backup.rows) {
      if (r.tenant_id !== backup.tenantId) throw new Error("백업의 지점이 섞였습니다");
      const done = appliedOf.get(`${r.teacher_id}|${r.month}`);
      if (!done) throw new Error(`${r.teacher_id} ${r.month}: 적용 기록에 없는 행입니다 — 멈춥니다`);
      if (done.kind === "revise") {
        const [now] = await tx`select computed_at::text as computed_at from public.teacher_portfolio_months
          where tenant_id = ${r.tenant_id} and teacher_id = ${r.teacher_id} and month = ${r.month} for update`;
        if (now?.computed_at !== done.computedAt) throw new Error(`${r.teacher_id} ${r.month}: 정정 뒤 다시 저장된 행입니다 — 전부 멈춥니다`);
        await tx`delete from public.teacher_portfolio_months where tenant_id = ${r.tenant_id} and teacher_id = ${r.teacher_id} and month = ${r.month}`;
      }
      // 지운 행은 지우지 않고 넣기만 — 키가 이미 있으면(정정 뒤 다시 생긴 행) 넣지 못해 멈춘다.
      const back = await tx`
        insert into public.teacher_portfolio_months
          (tenant_id, teacher_id, month, period_end, total, known_count, class_count, subjects, payload, closed_at, closing_source, computed_at, raws)
        values (${r.tenant_id}, ${r.teacher_id}, ${r.month}, ${r.period_end}::date, ${r.total}::numeric, ${r.known_count}, ${r.class_count},
                ${r.subjects.length ? sql.array(r.subjects) : "{}"}::text[], ${sql.json(r.payload as never)}, ${r.closed_at}::timestamptz,
                ${r.closing_source}, ${r.computed_at}::timestamptz, ${r.raws === null ? null : sql.json(r.raws as never)})
        on conflict (tenant_id, teacher_id, month) do nothing
        returning month`;
      if (!back.length) throw new Error(`${r.teacher_id} ${r.month}: 지운 행이 그사이 다시 생겼습니다 — 전부 멈춥니다`);
    }
    await tx`
      insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (${backup.tenantId}, null, ${ACTOR}, 'teacher_portfolio_homeroom_fix', 'teacher_portfolio_months', '강사평가 정정 되돌리기',
              ${sql.json({ revert: true, rows: backup.rows.length, backup: BACKUP, via: "cli" })})`;
    if (!APPLY) throw new DryRun();
  }).catch((e) => {
    if (e instanceof DryRun) { console.log("드라이런 — 확인만 하고 되돌렸습니다", backup.rows.length, "행"); return; }
    throw e;
  });
  if (APPLY) console.log("되살렸습니다", backup.rows.length, "행");
} finally {
  await sql.end();
}
