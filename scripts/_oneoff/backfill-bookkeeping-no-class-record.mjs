/**
 * 장부 정리 퇴원 '수업 흔적 없음' 표식 채우기 — withdrawal_metadata.noClassRecord = true.
 *
 * 원장 2026-11-09 *"저렇게 처리했음 알아서 걸러야지 왜 자꾸 언급하나"* — 2026-07-15 '데이터 정리 일괄 퇴원' 31명 중 26명은 폐지된 고등 수학반에
 * 수강 줄만 걸려 있었고 출결·수업료 청구가 0이었다. 판정(isBookkeepingOnlyExit · 비서 보기 s2_0041)이 이 표식을 보면 장부 정리로 조용히 뺀다.
 * 앞으로의 일괄 퇴원은 앱이 직접 적는다(features/withdrawals/server/no-class-record.ts) — 이 스크립트는 그 전에 정리된 줄만.
 *
 * 대상 = 퇴원(status=withdrawn) · 장부 정리 메모('데이터 정리 일괄 퇴원' 또는 '수강 반 없음 일괄 퇴원 처리…') · 사유 없음/기타 ·
 *        출결 기록 0 · 수업료 청구(category tuition · 취소/환불 제외) 0 · 표식 아직 없음. 끝난 수강이 없는 줄(이미 장부 정리)도 함께 적는다(무해).
 * 기본 = 드라이런(거래 안에서 적고 되돌림 · 대상 수와 학년·반 요약만). `--apply` = 적용 + 감사로그 1행. `--revert` = 이 표식을 지운다(+ 감사로그).
 *   node --env-file=.env.local scripts/_oneoff/backfill-bookkeeping-no-class-record.mjs [--tenant=cs] [--apply | --revert]
 */
import postgres from "postgres";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const apply = process.argv.includes("--apply");
const revert = process.argv.includes("--revert");
const slug = (process.argv.find((a) => a.startsWith("--tenant=")) || "--tenant=cs").slice("--tenant=".length);
const DRY = Symbol("dry-run");

try {
  const tenants = await sql`select id from tenants where slug = ${slug}`;
  if (tenants.length !== 1) throw new Error(`지점 '${slug}'을(를) 하나로 찾지 못함`);
  const tenantId = tenants[0].id;
  await sql
    .begin(async (tx) => {
      const rows = revert
        ? await tx`
            update students set withdrawal_metadata = withdrawal_metadata - 'noClassRecord', updated_at = now()
             where tenant_id = ${tenantId} and withdrawal_metadata ? 'noClassRecord'
            returning id, grade, withdrawn_at`
        : await tx`
            update students s set withdrawal_metadata = s.withdrawal_metadata || jsonb_build_object('noClassRecord', true), updated_at = now()
             where s.tenant_id = ${tenantId}
               and s.status = 'withdrawn'
               and coalesce(nullif(s.withdrawal_metadata ->> 'reason', ''), 'other') = 'other'
               and (btrim(s.withdrawal_metadata ->> 'memo') = '데이터 정리 일괄 퇴원' or btrim(s.withdrawal_metadata ->> 'memo') like '수강 반 없음 일괄 퇴원 처리%')
               and not (s.withdrawal_metadata ? 'noClassRecord')
               and not exists (select 1 from attendance_records a where a.tenant_id = s.tenant_id and a.student_id = s.id)
               and not exists (select 1 from invoices i where i.tenant_id = s.tenant_id and i.student_id = s.id
                                 and coalesce(i.category, 'tuition') = 'tuition' and i.status::text not in ('void', 'refunded'))
            returning s.id, s.grade, s.withdrawn_at`;
      const byDate = {};
      for (const r of rows) {
        const d = r.withdrawn_at ? String(r.withdrawn_at instanceof Date ? r.withdrawn_at.toISOString() : r.withdrawn_at).slice(0, 10) : "날짜 없음";
        byDate[d] = (byDate[d] ?? 0) + 1;
      }
      const ids = rows.map((r) => r.id);
      const ended = ids.length
        ? (await tx`select count(distinct student_id)::int n from enrollments where tenant_id = ${tenantId} and student_id = any(${ids}::uuid[]) and end_date is not null`)[0].n
        : 0;
      console.log(JSON.stringify({ mode: revert ? "revert" : "mark", apply, count: rows.length, withEndedEnrollment: ended, byWithdrawnDate: byDate }, null, 1));
      if (!apply && !revert) throw DRY;
      if (rows.length > 0) {
        await tx`
          insert into audit_logs (tenant_id, action, target_type, target_label, metadata)
          values (${tenantId}, ${revert ? "withdrawal_bookkeeping_backfill_revert" : "withdrawal_bookkeeping_backfill"}, 'student',
                  ${revert ? "장부 정리 '수업 흔적 없음' 표식 제거" : "장부 정리 '수업 흔적 없음' 표식(출결·수업료 청구 0)"},
                  ${sql.json({ count: rows.length, studentIds: ids, byWithdrawnDate: byDate, script: "scripts/_oneoff/backfill-bookkeeping-no-class-record.mjs" })})`;
      }
    })
    .catch((e) => {
      if (e === DRY) console.log("드라이런 — 되돌림(쓰기 0). 적용하려면 --apply");
      else throw e;
    });
} finally {
  await sql.end();
}
