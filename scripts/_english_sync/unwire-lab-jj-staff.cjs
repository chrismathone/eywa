// LAB·JJ = 사람이 아니라 **자리**(랩실 603호 · 집중자율수업실 305호) — 직원 배선 해제 (2026-07-29 원장 지시).
//
// 배경: ijw 시트의 LAB/JJ 블록이 임포트 과정에서 users 계정(`LAB@imported.local`·`JJ@imported.local`)으로
// 만들어져 **가짜 강사**가 됐다. 그 결과 출석부 강사 필터·직원명부·급여표·담임 드롭다운·상담자 선택지에
// 사람처럼 노출됐고, 2026-07-23엔 공지 발송실패 알림이 **로그인 불가한 JJ 계정으로 배달돼 아무도 못 봤다.**
//
// 하는 일(멱등):
//   1. classes.teacher_id — LAB/JJ 담임 해제. 유효 슬롯 최다 강사가 **단독**인 반만 그 강사로 이관(REASSIGN),
//      동률인 반은 **비운다**(자동 선택 = 없는 사실 생성이라 안 한다 → 원장이 수업목록에서 지정).
//   2. class_schedules.teacher_id — 특수 자리 라벨 슬롯의 강사 FK 해제. ⚠️ `slot_teacher_label` 원문은
//      **손대지 않는다**(ijw 임포트·시트 동기의 원본. 표시는 코드 teacher-label.ts가 담당).
//   3. users — LAB·JJ 계정을 status='inactive'로. 직원명부·급여표·담임 드롭다운이 전부 inactive를 제외한다.
//      (행은 남긴다 = 과거 감사로그 참조가 안 끊긴다. 되돌리기 = status='active')
//
// 사용: node --env-file=.env.local scripts/_english_sync/unwire-lab-jj-staff.cjs        (dry-run)
//       node --env-file=.env.local scripts/_english_sync/unwire-lab-jj-staff.cjs --apply
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const SPECIAL_LABELS = ["LAB", "JJ", "이주희"]; // slot_teacher_label 원문(시트 원본 표기)
const PLACEHOLDER_EMAILS = ["LAB@imported.local", "JJ@imported.local"];

// 담임 이관 — 유효 슬롯 최다 강사가 단독인 반만. (2026-07-29 실측: DP5 Kristine 3>Anna 2 ·
// 중등E_초등 브릿지 C2 Hannah 2>Sam 1. 나머지 3반은 슬롯·분까지 완전 동률이라 비운다.)
const REASSIGN = [
  { className: "DP5", teacherEnglishName: "Kristine", why: "유효 슬롯 Kristine 3 > Anna 2" },
  { className: "중등E_초등 브릿지 C2", teacherEnglishName: "Hannah", why: "유효 슬롯 Hannah 2 > Sam 1" },
];

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  const log = (...a) => console.log(...a);
  try {
    const placeholders = await sql`
      select id, tenant_id, display_name, email, status from users where email = any(${PLACEHOLDER_EMAILS})`;
    if (placeholders.length === 0) {
      log("대상 계정 없음 — 이미 정리됐거나 다른 테넌트입니다.");
      return;
    }
    const ids = placeholders.map((u) => u.id);
    const tenantId = placeholders[0].tenant_id;
    log(`대상 계정 ${placeholders.length}건:`, placeholders.map((u) => `${u.display_name}(${u.status})`).join(" · "));
    log(`모드: ${APPLY ? "APPLY(쓰기)" : "DRY-RUN(읽기만)"}\n`);

    // ── 1. 담임 ────────────────────────────────────────────────────────────
    const owned = await sql`
      select c.id, c.class_name, u.display_name teacher
      from classes c join users u on u.id = c.teacher_id
      where c.teacher_id = any(${ids}) order by c.class_name`;
    log(`[1] 담임이 자리 계정인 반: ${owned.length}건`);
    for (const c of owned) {
      const plan = REASSIGN.find((r) => r.className === c.class_name);
      log(`  - ${c.class_name} (현 담임 ${c.teacher}) → ${plan ? `${plan.teacherEnglishName} (${plan.why})` : "미배정(동률 — 원장 지정 대기)"}`);
    }
    for (const r of REASSIGN) {
      const [t] = await sql`
        select id, display_name from users
        where tenant_id = ${tenantId} and english_name = ${r.teacherEnglishName} and status = 'active'
          and system_role in ('teacher','manager','master')`;
      if (!t) { log(`  ⚠️ ${r.teacherEnglishName} 계정을 못 찾음 — ${r.className}은 미배정으로 둡니다.`); continue; }
      if (APPLY) {
        await sql`update classes set teacher_id = ${t.id}
                  where tenant_id = ${tenantId} and class_name = ${r.className} and teacher_id = any(${ids})`;
      }
      log(`  ${APPLY ? "✔" : "·"} ${r.className} 담임 → ${t.display_name}`);
    }
    if (APPLY) {
      const cleared = await sql`
        update classes set teacher_id = null
        where tenant_id = ${tenantId} and teacher_id = any(${ids}) returning class_name`;
      log(`  ✔ 나머지 담임 해제: ${cleared.length}건 (${cleared.map((c) => c.class_name).join(", ") || "-"})`);
    }

    // ── 2. 슬롯 FK ────────────────────────────────────────────────────────
    const slotCount = await sql`
      select count(*)::int n from class_schedules
      where tenant_id = ${tenantId} and teacher_id = any(${ids})`;
    log(`\n[2] 자리 계정이 강사로 걸린 슬롯: ${slotCount[0].n}건 (slot_teacher_label 원문은 유지)`);
    if (APPLY) {
      const upd = await sql`
        update class_schedules set teacher_id = null
        where tenant_id = ${tenantId} and (teacher_id = any(${ids}) or slot_teacher_label = any(${SPECIAL_LABELS}))
          and teacher_id is not null returning id`;
      log(`  ✔ 해제 ${upd.length}건`);
    }

    // ── 3. 계정 비활성 ─────────────────────────────────────────────────────
    log(`\n[3] 자리 계정 비활성화(직원명부·급여표·담임 드롭다운에서 제외)`);
    if (APPLY) {
      const upd = await sql`
        update users set status = 'inactive', updated_at = now()
        where id = any(${ids}) and status <> 'inactive' returning display_name`;
      log(`  ✔ ${upd.length}건 (${upd.map((u) => u.display_name).join(", ") || "이미 inactive"})`);
    }

    // ── 검증 ──────────────────────────────────────────────────────────────
    log("\n[검증]");
    const after = await sql`
      select
        (select count(*)::int from classes where teacher_id = any(${ids})) as classes_left,
        (select count(*)::int from class_schedules where teacher_id = any(${ids})) as slots_left,
        (select count(*)::int from users where id = any(${ids}) and status = 'active') as active_left,
        (select count(*)::int from class_schedules
           where tenant_id = ${tenantId} and slot_teacher_label = any(${SPECIAL_LABELS})) as labels_kept`;
    log("  ", JSON.stringify(after[0]));
    log(`  기대값: classes_left 0 · slots_left 0 · active_left 0 · labels_kept 242(라벨 원문 보존)`);
    if (!APPLY) log("\n(dry-run — 아무것도 쓰지 않았습니다. 적용하려면 --apply)");
  } finally {
    await sql.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
