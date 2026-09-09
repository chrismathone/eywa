/**
 * 학생상담 `consulted_at`이 **9시간 뒤로** 저장된 것을 KST로 되돌린다.
 *
 * 원장 2026-09-09: *"'상담 시각'이 방금전인데 버그 아닌가?"* → 원인 확정 후 *"kst로 전부 정정해"*.
 * 원인: `<input type="datetime-local">`이 보낸 **타임존 없는 KST 벽시계**를 서버(UTC)가 그대로 읽어
 * 정확히 +9h로 앉았다(코드는 `kstLocalToIso`로 고쳤다 — date-kst.ts).
 *
 * 🔑 **대상을 가리는 근거**(실측 2026-09-09):
 *   · `makeedu_id IS NULL` — makeedu 동기화분(320건)은 KST 자정으로 **정상** 저장돼 있다.
 *   · `consulted_at::time <> '00:00:00'` — UTC 자정(1,410건)은 날짜만 있는 임포트라 시각이 의미 없다.
 *   · **KST 시각이 08~21시 밖** — 남은 62건 중 61건이 22~07시(학원 상담이 불가능한 시간대)에 몰려 있고
 *     그 전부가 `consulted_at − created_at ≈ +9h`다. 되돌리면 전부 13~22시로 들어온다.
 *   · 🔴 남은 1건(KST 19:00, gap 0)은 **녹음 폼 경로**라 처음부터 옳다(그쪽은 클라에서 ISO로 변환해 보낸다).
 *     시각으로 거르면 그 건이 자동으로 빠진다 — 일괄 −9h를 전 행에 돌리지 말 것.
 *
 * ⚠️ 드라이런이 기본. 실제 반영은 `--apply`.
 * 실행: node --env-file=.env.local scripts/_oneoff/fix-consultation-kst-shift.mjs [--apply]
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

try {
  const rows = await sql`
    select c.id,
           s.name as student_name,
           to_char(c.consulted_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as before_kst,
           to_char((c.consulted_at - interval '9 hours') at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as after_kst,
           round(extract(epoch from (c.consulted_at - c.created_at)) / 3600, 1) as gap_h
    from student_consultations c
    left join students s on s.id = c.student_id
    where c.makeedu_id is null
      and c.consulted_at::time <> '00:00:00'
      and extract(hour from (c.consulted_at at time zone 'Asia/Seoul')) not between 8 and 21
    order by c.consulted_at desc`;

  console.log(`정정 대상 ${rows.length}건 (현재 KST → 정정 후 KST)`);
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${r.before_kst} → ${r.after_kst}  (gap ${r.gap_h}h) ${r.student_name ?? "?"}`);
  }
  if (rows.length > 20) console.log(`  … 외 ${rows.length - 20}건`);

  // 되돌린 값이 전부 학원 운영시간(08~22시) 안으로 들어오는지 — 아니면 규칙이 틀린 것이다.
  const outOfBand = rows.filter((r) => {
    const hour = Number(r.after_kst.slice(11, 13));
    return hour < 8 || hour > 22;
  });
  if (outOfBand.length > 0) {
    console.log(`\n🔴 정정 후에도 운영시간 밖인 건 ${outOfBand.length}건 — 규칙을 다시 볼 것.`);
    for (const r of outOfBand.slice(0, 5)) console.log(`   ${r.before_kst} → ${r.after_kst}`);
    process.exitCode = 1;
  } else if (!APPLY) {
    console.log("\n드라이런입니다. 실제 반영은 --apply");
  } else if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    await sql`
      update student_consultations
      set consulted_at = consulted_at - interval '9 hours', updated_at = now()
      where id = any(${ids}::uuid[])`;
    console.log(`\n반영 완료 — ${rows.length}건.`);
  } else {
    console.log("\n정정할 것이 없습니다.");
  }
} finally {
  await sql.end();
}
