/**
 * 수강(활성 enrollment)이 하나도 없는 "재원" 학생 일괄 퇴원 처리 (2026-07-10, 원장 지시).
 *
 * 대상: status='enrolled' AND 활성 수강(end_date IS NULL) 0건 — 휴원(on_hold) 반이라도 있으면 제외.
 * 적용: status='withdrawn', withdrawn_at=오늘(KST), withdrawal_metadata=앱 기본값+메모(일괄 처리 표식).
 *      이미 withdrawn_at이 있으면 보존.
 * 실행: node --env-file=.env.local scripts/_oneoff/withdraw-no-enrollment.cjs         (dry-run)
 *      node --env-file=.env.local scripts/_oneoff/withdraw-no-enrollment.cjs --apply (적용, 스냅샷 저장)
 * 원복: 스냅샷 JSON(id별 이전 status/withdrawn_at/withdrawal_metadata)으로 UPDATE 되돌리기.
 */
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // injaewon (프로덕션)
const TODAY_KST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const APPLY = process.argv.includes("--apply");

// 앱 DEFAULT_WITHDRAWAL_METADATA(src/features/withdrawals/types.ts)와 동일 구조 + 일괄 처리 메모.
const METADATA = {
  reason: "other",
  memo: `수강 반 없음 일괄 퇴원 처리 (${TODAY_KST})`,
  consultation: {
    adminCalledParent: false,
    teacherCalledParent: false,
    talkedWithStudent: false,
  },
};

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    // ① 대상: 재원인데 활성 수강 0건 (휴원 포함 어떤 활성 enrollment도 없음)
    const targets = await sql`
      select s.id, s.name, s.school, s.grade, s.status, s.enrolled_at, s.withdrawn_at,
             s.withdrawal_metadata, s.makeedu_id is not null as from_makeedu,
             (select count(*)::int from enrollments e where e.student_id = s.id) as total_enr
      from students s
      where s.tenant_id = ${TENANT}
        and s.status = 'enrolled'
        and not exists (
          select 1 from enrollments e
          where e.student_id = s.id and e.end_date is null
        )
      order by s.grade, s.name
    `;

    // ② 참고: 활성 수강이 전부 휴원(on_hold)뿐인 재원생 — 반 연결이 있어 건드리지 않음
    const onHoldOnly = await sql`
      select s.id, s.name, s.grade
      from students s
      where s.tenant_id = ${TENANT} and s.status = 'enrolled'
        and exists (select 1 from enrollments e where e.student_id = s.id and e.end_date is null)
        and not exists (select 1 from enrollments e
          where e.student_id = s.id and e.end_date is null and e.on_hold = false)
    `;

    // 최근 30일 내/미래 등록 = 반 배정 전 신입 가능성 → 자동 퇴원에서 보류(사람 확인).
    const CUTOFF = new Date("2026-06-10T00:00:00+09:00");
    const isRecent = (t) => t.enrolled_at && new Date(t.enrolled_at) >= CUTOFF;
    const recent = targets.filter(isRecent);
    const apply = targets.filter((t) => !isRecent(t));
    const neverEnrolled = targets.filter((t) => t.total_enr === 0);

    console.log(`재원인데 활성 수강 0건: ${targets.length}명`);
    console.log(`  ├ enrollment 이력 자체가 0건: ${neverEnrolled.length}명`);
    console.log(`  ├ 최근 30일 내·미래 등록(신입 가능성 → 보류): ${recent.length}명`);
    if (recent.length)
      console.log(`  │   ${recent.map((r) => `${r.name}(${r.grade ?? "?"}, ${new Date(r.enrolled_at).toISOString().slice(0, 10)})`).join(", ")}`);
    console.log(`  ├ 퇴원 적용 대상: ${apply.length}명`);
    console.log(`  └ makeedu 연동 학생: ${targets.filter((t) => t.from_makeedu).length}명`);
    console.log(`휴원 반만 있는 재원생 (제외, 유지): ${onHoldOnly.length}명`);
    if (onHoldOnly.length) console.log(`   ${onHoldOnly.map((r) => `${r.name}(${r.grade ?? "?"})`).join(", ")}`);
    console.log("");
    console.log(
      targets.map((t) => `  ${t.name} (${t.grade ?? "?"} ${t.school ?? "?"}) enrolled_at=${t.enrolled_at ?? "—"} 이력=${t.total_enr}건`).join("\n"),
    );

    if (!APPLY) {
      console.log("\n[dry-run] --apply 로 실행하면 보류분 제외 전원을 퇴원 처리합니다.");
      return;
    }

    // ③ 스냅샷(원복용) — 적용 직전 상태 저장(적용 대상만)
    const snapPath = path.join(
      __dirname,
      `withdraw-no-enrollment.backup.${TODAY_KST.replaceAll("-", "")}-${Date.now()}.json`,
    );
    fs.writeFileSync(snapPath, JSON.stringify(apply, null, 1), "utf8");
    console.log(`\n스냅샷 저장: ${snapPath}`);

    // ④ 적용 — 단일 UPDATE (조건 재검증 포함: 여전히 재원 + 여전히 활성 수강 0건)
    const ids = apply.map((t) => t.id);
    const updated = await sql`
      update students s
      set status = 'withdrawn',
          withdrawn_at = coalesce(s.withdrawn_at, ${TODAY_KST}),
          withdrawal_metadata = ${sql.json(METADATA)}
      where s.tenant_id = ${TENANT}
        and s.id = any(${ids})
        and s.status = 'enrolled'
        and not exists (select 1 from enrollments e where e.student_id = s.id and e.end_date is null)
      returning s.id
    `;
    console.log(`퇴원 처리 완료: ${updated.length}명 (적용 대상 ${apply.length}명, 보류 ${recent.length}명)`);

    // ⑤ 사후 검증 — 남은 건 보류분(recent)뿐이어야 정상
    const after = await sql`
      select count(*)::int c from students s
      where s.tenant_id = ${TENANT} and s.status = 'enrolled'
        and not exists (select 1 from enrollments e where e.student_id = s.id and e.end_date is null)
    `;
    const enrolledNow = await sql`
      select count(*)::int c from students where tenant_id = ${TENANT} and status = 'enrolled'
    `;
    console.log(`사후: 활성 수강 없는 재원생 ${after[0].c}명(보류 ${recent.length}명과 같아야 정상) / 재원 총 ${enrolledNow[0].c}명`);
  } finally {
    await sql.end();
  }
})();
