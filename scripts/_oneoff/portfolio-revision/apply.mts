/**
 * 강사평가 마감 달의 **담임 판정 정정** — 적용(원장 지시 때만 · 2026-11-11 *"추천방식으로 시작"*).
 *
 * plan.mts가 만든 plan.json을 그대로 쓴다(다시 계산하지 않는다 — 원장이 본 계획과 같은 값).
 * 전례(2026-10-14·15 `teacher_portfolio_rule_patch`·`teacher_portfolio_recompute`)와 같은 길 — 마감한 행은 고치지 않고
 * **지우고 다시 넣는다**(0357a 트리거는 UPDATE만 막는다 · 결정 문서 staff.md '마감한 달은 굳는다').
 *
 * 1) 대상 행 원본 전체를 저장소 밖 파일로 백업한다(되돌리기 재료).
 * 2) 한 트랜잭션: 행마다 계획을 만든 때의 `computed_at`과 같을 때만 지운다(그사이 바뀐 행이 하나라도 있으면 전부 되돌림).
 *    고침 = 같은 마감 시각 · 같은 수업 끝날로 다시 넣는다(근거·점수·합계·반·과목·원래 수치) · 마감 구분은 '재구성'(한참 뒤 남은
 *    기록으로 다시 만든 값이라는 뜻 — 화면이 '마감 · 재구성'으로 밝힌다) · 집계 시각 = 지금.
 *    지움 = 입사 전·퇴사 뒤 달(그 사람의 근무가 아니다).
 * 3) 같은 트랜잭션에 감사로그 한 줄(`teacher_portfolio_homeroom_fix`).
 *
 * 실행(작업본 루트에서 · 먼저 plan.mts):
 *   TSX_TSCONFIG_PATH=scripts/_oneoff/portfolio-revision/tsconfig.json \
 *   node --env-file=.env.local --import tsx scripts/_oneoff/portfolio-revision/apply.mts --plan=<plan.json> [--apply]
 * `--apply`가 없으면 백업·확인까지만 하고 트랜잭션을 되돌린다(드라이런).
 * 적용 기록(행마다 새 집계 시각 · 지움)은 **같은 트랜잭션의 감사로그 metadata.applied**에 남고, 파일(applied-*.json)은 사본이다 —
 * 커밋 뒤 파일 쓰기가 실패해도 되돌리기 재료가 사라지지 않는다. 되돌리기는 지금 행이 그 기록과 같을 때만 되살린다.
 * 되돌리기 = restore.mts --backup=<백업 파일> --applied=<applied 파일 | audit:latest>.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import type { RevisionAction } from "@/features/teacher-portfolio/model/revision";
import { rawsOf } from "@/features/teacher-portfolio/server/store";

const PLAN = process.argv.find((a) => a.startsWith("--plan="))?.slice(7);
const APPLY = process.argv.includes("--apply");
if (!PLAN) throw new Error("--plan=<plan.json> 이 필요합니다");
const ACTOR = "system:portfolio-revision(원장 지시 2026-11-11 · 마감 달 담임 판정 정정)";

type PlanAction = Extract<RevisionAction, { kind: "revise" | "remove" }> & { original: { computed_at: string; closed_at: string } };
const plan = JSON.parse(readFileSync(PLAN, "utf8")) as { generatedAt: string; tenantId: string; end: string; actions: PlanAction[] };
const T = plan.tenantId;
console.log(`계획 ${plan.generatedAt} · 고침 ${plan.actions.filter((a) => a.kind === "revise").length} · 지움 ${plan.actions.filter((a) => a.kind === "remove").length}`);

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
class DryRun extends Error {}
try {
  // 1) 원본 백업(행 전체 · 문자열로 — 날짜·시각을 다른 시간대로 바꾸지 않게).
  const keys = plan.actions.map((a) => `${a.teacherId}|${a.month}`);
  const originals = await sql`
    select tenant_id, teacher_id, month, period_end::text as period_end, total::text as total, known_count, class_count, subjects,
           payload, closed_at::text as closed_at, closing_source, computed_at::text as computed_at, raws
      from public.teacher_portfolio_months
     where tenant_id = ${T} and (teacher_id::text || '|' || month) in ${sql(keys)}`;
  if (originals.length !== keys.length) throw new Error(`대상 행 ${keys.length}개 중 ${originals.length}개만 있습니다 — 계획을 다시 만드세요`);
  const backup = join(dirname(PLAN), `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backup, JSON.stringify({ tenantId: T, plan: PLAN, savedAt: new Date().toISOString(), rows: originals }));
  console.log("원본 백업", originals.length, "행 →", backup);

  // 2) 한 트랜잭션.
  const done = { revised: 0, removed: 0 };
  const applied: { teacherId: string; month: string; kind: "revise" | "remove"; computedAt: string | null }[] = [];
  const appliedPath = backup.replace(/backup-/, "applied-");
  await sql.begin(async (tx) => {
    for (const a of plan.actions) {
      const [r] = await tx`
        delete from public.teacher_portfolio_months
         where tenant_id = ${T} and teacher_id = ${a.teacherId} and month = ${a.month}
           and closed_at is not null and computed_at = ${a.original.computed_at}::timestamptz
        returning period_end::text as period_end, closed_at::text as closed_at`;
      if (!r) throw new Error(`${a.teacherId} ${a.month}: 계획을 만든 뒤 행이 바뀌었거나 없습니다 — 전부 되돌립니다`);
      if (a.kind === "remove") { done.removed++; applied.push({ teacherId: a.teacherId, month: a.month, kind: "remove", computedAt: null }); continue; }
      const p = a.payload;
      const [ins] = await tx`
        insert into public.teacher_portfolio_months
          (tenant_id, teacher_id, month, period_end, total, known_count, class_count, subjects, payload, closed_at, closing_source, computed_at, raws)
        values (${T}, ${a.teacherId}, ${a.month}, ${r.period_end}::date, ${p.total}, ${p.knownCount}, ${p.classes.length},
                ${p.subjects.length ? sql.array(p.subjects) : "{}"}::text[], ${sql.json(p as never)}, ${r.closed_at}::timestamptz, 'reconstructed', now(),
                ${sql.json(rawsOf(p) as never)})
        returning computed_at::text as computed_at`;
      applied.push({ teacherId: a.teacherId, month: a.month, kind: "revise", computedAt: ins!.computed_at as string });
      done.revised++;
    }
    const months = [...new Set(plan.actions.map((a) => a.month))].sort();
    // 적용 기록은 감사로그에 함께(같은 트랜잭션) — 되돌리기의 기준.
    await tx`
      insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (${T}, null, ${ACTOR}, 'teacher_portfolio_homeroom_fix', 'teacher_portfolio_months', ${`강사평가 ${months[0]} ~ ${months.at(-1)}`},
              ${sql.json({ months, revised: done.revised, removed: done.removed, plan: plan.generatedAt, backup, appliedFile: appliedPath, applied, via: "cli" })})`;
    if (!APPLY) throw new DryRun();
  }).catch((e) => {
    if (e instanceof DryRun) { console.log("드라이런 — 확인만 하고 되돌렸습니다(고침", done.revised, "· 지움", done.removed, ")"); return; }
    throw e;
  });
  if (APPLY) {
    writeFileSync(appliedPath, JSON.stringify({ tenantId: T, backup, savedAt: new Date().toISOString(), rows: applied }));
    console.log("적용했습니다 — 고침", done.revised, "· 지움", done.removed, "· 적용 기록", appliedPath);
  }
} finally {
  await sql.end();
}
