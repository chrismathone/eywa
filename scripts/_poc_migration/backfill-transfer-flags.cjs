#!/usr/bin/env node
/**
 * 반이동 전출/전입 플래그 백필 — 수동 이동(수강 배정 + 수강 종료 2단계)으로 옛 반에 퇴원 표시가
 * 뜨고 새 반이 초록이 안 되던 기존 데이터를 교정한다.
 *
 * 매칭(보수적): 같은 학생의
 *   E_old : end_date 있음 · is_transferred=false · (반이동으로 볼) 종료
 *   E_new : end_date 없음(활성) · class_id ≠ E_old.class_id · start_date ∈ [end-1, end+3]
 * → E_old.is_transferred=true(+ withdrawal_reason 'other'/null이면 '반 이동') , E_new.is_transferred_in=true.
 * 현재 재원(status≠withdrawn) 학생만. E_old 하나에 E_new 여럿이면 종료일에 가장 가까운 1건.
 *
 * ⚠️ 프로덕션 데이터. 기본 dry-run(변경 없음). 적용은 --apply. 범위 제한은 --since=YYYY-MM-DD
 *   (기본: eywa 수동 이동 시기 이후 = 2026-06-01. 전체는 --since=2000-01-01).
 * 되돌리기: 출력된 old_id/new_id로 is_transferred / is_transferred_in 을 false 로 UPDATE.
 *
 *   node --env-file=.env.local scripts/_poc_migration/backfill-transfer-flags.cjs          # dry-run(기본 since 2026-06-01)
 *   node --env-file=.env.local scripts/_poc_migration/backfill-transfer-flags.cjs --since=2000-01-01   # 전체 dry-run
 *   node --env-file=.env.local scripts/_poc_migration/backfill-transfer-flags.cjs --apply  # 적용
 */
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const sinceArg = (process.argv.find((a) => a.startsWith("--since=")) || "").split("=")[1];
const SINCE = /^\d{4}-\d{2}-\d{2}$/.test(sinceArg || "") ? sinceArg : "2026-06-01";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

// 매칭 쌍 — data-modifying 없이 SELECT만(dry-run과 apply가 동일 조건 공유).
function pairs() {
  return sql`
    select
      o.id as old_id, oc.class_name as old_class, o.end_date as old_end, o.withdrawal_reason as old_reason,
      n.id as new_id, nc.class_name as new_class, n.start_date as new_start,
      s.name as student, s.school
    from enrollments o
    join students s on s.id = o.student_id and s.status <> 'withdrawn'
    join classes oc on oc.id = o.class_id
    join lateral (
      select n.*
      from enrollments n
      where n.student_id = o.student_id
        and n.class_id <> o.class_id
        and n.end_date is null
        and n.start_date between (o.end_date - 1) and (o.end_date + 3)
      order by abs(n.start_date - o.end_date), n.start_date desc
      limit 1
    ) n on true
    join classes nc on nc.id = n.class_id
    where o.end_date is not null
      and coalesce(o.is_transferred, false) = false
      and o.end_date >= ${SINCE}
    order by o.end_date desc, s.name
  `;
}

(async () => {
  const rows = await pairs();
  console.log(`\n=== 반이동 전출/전입 백필 ${APPLY ? "[적용]" : "[DRY-RUN]"} · since ${SINCE} ===`);
  console.log(`매칭된 (옛 수강→새 수강) 쌍: ${rows.length}건`);

  // 종료 월별 분포(오래된 대량 오탐 감지용)
  const byMonth = {};
  for (const r of rows) {
    const m = String(r.old_end).slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
  }
  console.log("종료월 분포:", byMonth);

  const distinctOld = new Set(rows.map((r) => r.old_id));
  const distinctNew = new Set(rows.map((r) => r.new_id));
  console.log(`플래그 대상: 옛 수강 ${distinctOld.size}건(is_transferred) · 새 수강 ${distinctNew.size}건(is_transferred_in)`);

  console.log("\n표본(최대 15):");
  console.table(
    rows.slice(0, 15).map((r) => ({
      student: r.student,
      old: `${r.old_class} ~${String(r.old_end).slice(0, 10)}`,
      new: `${r.new_class} ${String(r.new_start).slice(0, 10)}~`,
      reason: r.old_reason,
    })),
  );

  if (!APPLY) {
    console.log("\n※ dry-run — 변경 없음. 적용하려면 --apply (필요 시 --since=YYYY-MM-DD).");
    await sql.end();
    return;
  }

  const oldIds = [...distinctOld];
  const newIds = [...distinctNew];
  await sql.begin(async (tx) => {
    // 옛 수강: 전출. withdrawal_reason 은 null/'other'(제네릭)일 때만 '반 이동'으로(구체 사유 보존).
    const upOld = await tx`
      update enrollments
         set is_transferred = true,
             withdrawal_reason = case when withdrawal_reason is null or withdrawal_reason = 'other'
                                      then '반 이동' else withdrawal_reason end
       where id in ${tx(oldIds)}`;
    // 새 수강: 전입.
    const upNew = await tx`
      update enrollments set is_transferred_in = true where id in ${tx(newIds)}`;
    console.log(`\n적용: 옛 수강 ${upOld.count}건 전출 · 새 수강 ${upNew.count}건 전입.`);
  });

  // 되돌리기용 id 덤프
  console.log("\n되돌리기용 id (필요 시 false로 UPDATE):");
  console.log("old_ids:", oldIds.join(","));
  console.log("new_ids:", newIds.join(","));
  await sql.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
