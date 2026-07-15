// 일회성 백필: 폐지(is_active=false)·종강(closed_at) 반에 남은 "유령 수강"(end_date IS NULL) 종료.
//
// 배경: archiveClass/endClassTerm이 오래도록 classes 플래그만 바꿔 그 반 학생 수강이 영영 '수강중'으로
// 남았다(2026-07-15 원장 제보). 코드는 fix/class-end-enrollments에서 고쳤고, 이 스크립트는 그 전에
// 쌓인 기존 행을 정리한다.
//
// 종료일 규칙:
//   · 종강 반 = closed_at (실제 운영 종료일이 기록돼 있음)
//   · 폐지 반 = 오늘. ⚠️ 폐지는 시점을 남기지 않아(closed_at NULL) DB에 근거가 전혀 없다
//     (실측: 14개 반 전부 출석 0건이나 활성 반도 102개 중 58개만 출석이 있어 근거로 못 씀).
//     과거 날짜를 지어내지 않고 "오늘 종료 처리했다"는 사실만 기록한다 = 신규 archiveClass와 동일 의미.
//   · start_date > 종료일이면 end_date=start_date로 클램프(daterange lower>upper throw 방지).
//
// 학생 상태(students.status)는 **건드리지 않는다** — 수강이 0이 된 학생은 재원인 채로 대시보드
// '반 미배정 재원생'에 잡혀 재배정 대상이 된다(원장 확정). 자동 퇴원 금지.
//
// 사용: node scripts/_poc_migration/backfill-archived-class-enrollments.cjs           (dry-run)
//       node scripts/_poc_migration/backfill-archived-class-enrollments.cjs --apply   (실제 UPDATE + 롤백 파일)
const fs = require("fs");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const ARCHIVE_REASON = "반 폐지";
const CLOSE_TERM_REASON = "종강";
const ROLLBACK = "D:/tmp/rollback-archived-class-enrollments.json";

let url = process.env.DATABASE_URL;
if (!url) {
  const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8");
  url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, "");
}
if (!url) throw new Error("DATABASE_URL not found");
const sql = postgres(url, { prepare: false });

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST

(async () => {
  console.log(`[${APPLY ? "APPLY" : "DRY-RUN"}] 폐지/종강 반 유령 수강 종료  (오늘=${today})\n`);

  const rows = await sql`
    select e.id, e.student_id, e.start_date::text as start_date,
           c.class_name, c.is_active, c.closed_at::text as closed_at, s.name as student_name
    from enrollments e
    join classes c on c.id = e.class_id
    join students s on s.id = e.student_id
    where e.end_date is null
      and (c.is_active = false or c.closed_at is not null)
    order by c.class_name, s.name`;

  if (rows.length === 0) {
    console.log("정리할 유령 수강 없음.");
    await sql.end();
    return;
  }

  const plan = rows.map((r) => {
    const reason = r.is_active === false ? ARCHIVE_REASON : CLOSE_TERM_REASON;
    const base = r.is_active === false ? today : r.closed_at;
    // 미래 시작 수강은 end_date=start_date로 클램프(zero-length = 사실상 배정 취소).
    const endDate = r.start_date > base ? r.start_date : base;
    return { id: r.id, endDate, reason, clamped: endDate !== base, ...r };
  });

  const byClass = new Map();
  for (const p of plan) {
    const k = `${p.class_name} [${p.is_active === false ? "폐지" : `종강 ${p.closed_at}`}]`;
    byClass.set(k, (byClass.get(k) ?? 0) + 1);
  }
  console.log("=== 반별 종료 예정 ===");
  for (const [k, n] of [...byClass].sort((a, b) => b[1] - a[1])) console.log(`  ${n}건  ${k}`);

  const clamped = plan.filter((p) => p.clamped);
  console.log(`\n총 ${plan.length}건 / 학생 ${new Set(plan.map((p) => p.student_id)).size}명`);
  if (clamped.length) console.log(`  ↳ 미래 시작 클램프: ${clamped.length}건`);

  if (!APPLY) {
    console.log("\n(dry-run — 쓰기 없음. --apply 로 실제 반영)");
    await sql.end();
    return;
  }

  fs.writeFileSync(
    ROLLBACK,
    JSON.stringify({ at: new Date().toISOString(), ids: plan.map((p) => p.id) }, null, 2),
  );
  console.log(`\n롤백 파일: ${ROLLBACK}  (되돌리기 = 이 id들의 end_date/withdrawal_reason 을 NULL로)`);

  let n = 0;
  for (const p of plan) {
    await sql`update enrollments set end_date = ${p.endDate}::date, withdrawal_reason = ${p.reason} where id = ${p.id}`;
    n++;
  }
  console.log(`\n✅ ${n}건 종료 완료.`);

  const left = await sql`
    select count(*)::int as n from enrollments e join classes c on c.id = e.class_id
    where e.end_date is null and (c.is_active = false or c.closed_at is not null)`;
  console.log(`잔여 유령 수강: ${left[0].n}건 (0이어야 정상)`);

  await sql.end();
})();
