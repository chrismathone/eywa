/**
 * scripts/_poc_migration/fix-bulk-withdrawal-dates.mjs — **시스템 일괄 퇴원일 교정**. 기본 dry-run.
 *
 * 배경(2026-07-30, 원장 지시): `2026-07-10` 하루에 **119명**이 퇴원으로 찍혔는데(다음으로 많은 날은 07-13의
 * 12명) 그들의 **수강 종료일은 제각각**이다(07-03 40 · 04-06 15 · 05-04 8 · 03-31 7 …). 그날 수업이 끝난 게
 * 아니라 **이미 끝나 있던 학생들에게 일괄로 `status=withdrawn` 도장을 찍은 날**이라, `withdrawn_at`이
 * **장부상 날짜**가 되어 버렸다. 그 결과 퇴원관리 화면이 **"7월 퇴원 152명"** 이라는 사실이 아닌 숫자를 보여준다.
 *
 * 교정: 일괄분 중 **마지막 수강 종료일을 알 수 있는 학생**의 `withdrawn_at`을 그 날짜로 되돌린다.
 * → 7월 152 → 73명이 되고 3~6월로 제대로 분산된다(실측 03월 +5 · 04월 +20 · 05월 +8 · 06월 +4).
 *
 * ⚠️ **수강 이력이 아예 없는 42명은 건드리지 않는다** — 진짜 날짜를 알 수 없어 추측하면 없는 사실을 만드는 것이다.
 *    그들은 `2026-07-10`에 남고, ClassNote 판정의 `system_withdrawal` 가드가 계속 보호한다.
 * ⚠️ `withdrawal_metadata`(퇴원 사유)는 손대지 않는다. `status`도 그대로다 — **날짜만** 고친다.
 * ⚠️ 실행 전 **undo JSON**을 반드시 남긴다(되돌릴 유일한 수단).
 *
 * 실행:
 *   node --env-file=.env.local scripts/_poc_migration/fix-bulk-withdrawal-dates.mjs           # dry-run
 *   node --env-file=.env.local scripts/_poc_migration/fix-bulk-withdrawal-dates.mjs --apply
 *
 * 2026-10-15 추가(원장 *"실제 퇴원일이 존재하면 실제 퇴원일로, 아니고 단체 정리면 그냥 장부 정리는 미출력되게"*):
 *   `--tenant=<slug>` — 지점이 여럿이 된 뒤로 대상 지점을 고른다(하나뿐이면 생략 가능).
 *   `--cleanup-only` — 장부 정리 메모(`system-bulk.ts` `isCleanupWithdrawal`과 같은 글)가 붙은 퇴원만 고친다. 그날 **실제로**
 *     퇴원한 학생까지 마지막 수강 종료일로 옮기지 않게. 관리 도구 일괄 퇴원(2026-08-17 31명)은 이 옵션으로:
 *     `--tenant=cs --date=2026-08-17 --cleanup-only`(침산)
 *   수강 이력이 없는 장부 정리 퇴원은 여전히 손대지 않는다 — 화면이 모집단에서 뺀다(`isBookkeepingOnlyExit`).
 */
import fs from "node:fs";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const BULK_DATE = process.argv.find((a) => a.startsWith("--date="))?.split("=")[1] ?? "2026-07-10";
const UNDO_DIR = process.argv.find((a) => a.startsWith("--undo-dir="))?.split("=")[1] ?? "D:/tmp";
const TENANT_SLUG = process.argv.find((a) => a.startsWith("--tenant="))?.split("=")[1] ?? null;
const CLEANUP_ONLY = process.argv.includes("--cleanup-only");

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
try {
  const tenants = await sql`select id, slug from tenants`;
  const picked = TENANT_SLUG ? tenants.filter((t) => t.slug === TENANT_SLUG) : tenants;
  if (picked.length !== 1) throw new Error(`대상 지점 ${picked.length}개(전체 ${tenants.length}개) — --tenant=<slug>로 하나를 고르세요`);
  const tenant = picked[0].id;
  // 장부 정리 메모 = `src/features/withdrawals/system-bulk.ts`의 CLEANUP_WITHDRAWAL_MEMO · LEGACY_CLEANUP_MEMO_PREFIX(글을 바꾸면 함께).
  const cleanupOnly = CLEANUP_ONLY
    ? sql`and (s.withdrawal_metadata->>'memo' = '데이터 정리 일괄 퇴원' or s.withdrawal_metadata->>'memo' like '수강 반 없음 일괄 퇴원 처리%')`
    : sql``;

  // 대상 = 그 날짜로 찍힌 퇴원생 중 **마지막 수강 종료일이 있는** 학생
  const rows = await sql`
    select s.id, s.name, to_char(s.withdrawn_at,'YYYY-MM-DD') as cur,
           to_char(max(e.end_date),'YYYY-MM-DD') as real_end
    from students s
    join enrollments e on e.student_id = s.id and e.tenant_id = ${tenant} and e.end_date is not null
    where s.tenant_id = ${tenant} and s.status = 'withdrawn' and s.withdrawn_at = ${BULK_DATE} ${cleanupOnly}
    group by s.id, s.name, s.withdrawn_at
    order by 4, 2`;

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const targets = [];
  const skipped = [];
  for (const r of rows) {
    if (!r.real_end) skipped.push({ ...r, why: "종료일 없음" });
    else if (r.real_end > today) skipped.push({ ...r, why: `종료일이 미래(${r.real_end})` });
    else if (r.real_end === r.cur) skipped.push({ ...r, why: "이미 같은 날짜" });
    else targets.push(r);
  }

  const noHistory = await sql`
    select count(*)::int as n from students s
    where s.tenant_id = ${tenant} and s.status='withdrawn' and s.withdrawn_at = ${BULK_DATE} ${cleanupOnly}
      and not exists (select 1 from enrollments e where e.student_id = s.id and e.tenant_id = ${tenant} and e.end_date is not null)`;

  const byMonth = new Map();
  for (const t of targets) byMonth.set(t.real_end.slice(0, 7), (byMonth.get(t.real_end.slice(0, 7)) ?? 0) + 1);

  console.log(`\n════ 시스템 일괄 퇴원일 교정 ${APPLY ? "실행(--apply)" : "DRY-RUN"} · 기준일 ${BULK_DATE} ════`);
  console.log(`일괄분 총 ${rows.length + noHistory[0].n}명 = 교정 대상 ${targets.length} · 건너뜀 ${skipped.length} · **수강 이력 없음 ${noHistory[0].n}(손대지 않음)**`);
  console.log(`교정 후 분포: ${[...byMonth].sort().map(([m, n]) => `${m} ${n}명`).join(" · ")}`);
  console.log(`표본 10:`);
  for (const t of targets.slice(0, 10)) console.log(`   · ${t.name} : ${t.cur} → ${t.real_end}`);

  if (!APPLY) {
    console.log(`\n(dry-run) 아무것도 변경하지 않았습니다. 실행은 --apply.`);
  } else if (!targets.length) {
    console.log(`\n대상이 없어 종료합니다.`);
  } else {
    // ── undo 스냅샷 먼저 ──
    const stamp = today.replace(/-/g, "");
    const undoPath = `${UNDO_DIR}/undo-bulk-withdrawal-${stamp}-${BULK_DATE}.json`;
    fs.writeFileSync(undoPath, JSON.stringify({ tenant, bulkDate: BULK_DATE, rows: targets.map((t) => ({ id: t.id, name: t.name, from: t.cur, to: t.real_end })) }, null, 2));
    console.log(`\nundo 스냅샷 저장: ${undoPath}`);

    let done = 0;
    for (const t of targets) {
      // 조건에 현재 값을 함께 걸어 **동시 변경을 덮어쓰지 않는다**(TOCTOU).
      const res = await sql`
        update students set withdrawn_at = ${t.real_end}::date
        where id = ${t.id} and tenant_id = ${tenant} and status='withdrawn' and withdrawn_at = ${BULK_DATE}::date`;
      if (res.count === 1) done++;
    }
    console.log(`교정 완료: ${done}/${targets.length}`);

    const after = await sql`
      select to_char(withdrawn_at,'YYYY-MM') m, count(*)::int n from students
      where tenant_id=${tenant} and status='withdrawn' and withdrawn_at >= '2026-01-01' group by 1 order by 1`;
    console.log(`\n교정 후 월별 퇴원:`, after.map((r) => `${r.m} ${r.n}`).join(" · "));
  }
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
