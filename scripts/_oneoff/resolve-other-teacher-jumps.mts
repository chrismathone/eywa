/**
 * 과거 진도 점프 경고 재판정 — "같은 선생님 자기 줄" 규칙으로 다시 보고 **억제 대상만** 자동 확인으로 닫는다
 * (원장 지시 2026-08-20, 규칙 배선과 같은 푸시).
 *
 * 규칙은 앱과 **같은 순수 함수**([src/features/progress/same-teacher-jump.ts])를 그대로 import한다 —
 * 스크립트에 규칙을 베껴 두면 앱만 고쳐졌을 때 조용히 갈린다.
 *
 * 대상: `progress_events.event_type='jump_error'` AND `resolved_at is null` AND `report_id is not null`.
 *   ⚠️ `report_id`가 없는 이벤트(레거시 임포트 산물, 실측 5건)는 **건드리지 않는다** — 작성자를 물어볼
 *      보고서 자체가 없어 "같은 선생님" 규칙이 판정할 대상이 아니다(사람이 보고 '이상 없음'을 누르면 된다).
 *   ⚠️ 이미 `resolved_at`이 있는 행도 건드리지 않는다(사람이 누른 확인을 덮지 않는다 = 멱등).
 *
 * 실행: node_modules/.bin/tsx scripts/_oneoff/resolve-other-teacher-jumps.mts          (드라이런)
 *      node_modules/.bin/tsx scripts/_oneoff/resolve-other-teacher-jumps.mts --apply   (적용)
 * 원복: update progress_events set resolved_at=null, details=details-'suppressed'-'teacherName'-'sameTeacherLastPosition'
 *        where id in (...)  — 적용 시 출력되는 id 목록으로.
 */
import { config } from "dotenv";
import postgres from "postgres";
import {
  buildJumpSuppressionDetails,
  isSameTeacher,
  jumpWarningApplies,
  normalizeTeacherName,
} from "../../src/features/progress/same-teacher-jump";

config({ path: ".env.local" });

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // injaewon (프로덕션)
const APPLY = process.argv.includes("--apply");
/** 앱(ingest.ts SAME_TEACHER_LOOKBACK)과 같은 상한 — 재판정 결과가 실시간 판정과 갈리지 않게. */
const LOOKBACK = 60;

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

type EventRow = {
  id: string;
  student_id: string;
  student_name: string | null;
  to_position: number | null;
  from_position: number | null;
  jump_size: number | null;
  report_id: string | null;
  report_date: string | null;
  teacher_name: string | null;
  track: string | null;
};

try {
  const events = await sql<EventRow[]>`
    select e.id, e.student_id, st.name as student_name, e.to_position, e.from_position, e.jump_size,
           e.report_id, r.report_date::text as report_date, r.teacher_name, c.track
    from progress_events e
    left join students st on st.id = e.student_id
    left join lesson_reports r on r.id = e.report_id
    left join progress_containers c on c.id = e.container_id
    where e.tenant_id = ${TENANT}
      and e.event_type = 'jump_error'
      and e.resolved_at is null
    order by e.created_at desc`;

  const suppress: { row: EventRow; sameTeacherLastPosition: number | null }[] = [];
  const keep: EventRow[] = [];
  const untouched: EventRow[] = [];

  for (const ev of events) {
    if (!ev.report_id || !ev.report_date || !ev.track || typeof ev.to_position !== "number") {
      untouched.push(ev);
      continue;
    }
    let sameTeacherLastPosition: number | null = null;
    if (normalizeTeacherName(ev.teacher_name) !== null) {
      // 앱 findSameTeacherLastPosition과 같은 조건 — 같은 학생·같은 track·**이 보고서 날짜까지**·자기 제외.
      // 이름 정규화(공백·대소문자)는 SQL로 표현할 수 없어 후보를 받아 JS에서 고른다(앱과 동일).
      const candidates = await sql<{ global_position: number | null; teacher_name: string | null }[]>`
        select pe.global_position, lr.teacher_name
        from progress_entries pe
        join progress_containers pc on pc.id = pe.container_id
        join lesson_reports lr on lr.id = pe.report_id
        where pe.student_id = ${ev.student_id}
          and pc.track = ${ev.track}
          and pe.entry_date <= ${ev.report_date}
          and pe.report_id <> ${ev.report_id}
        order by pe.entry_date desc, pe.created_at desc
        limit ${LOOKBACK}`;
      for (const c of candidates) {
        if (!isSameTeacher(c.teacher_name, ev.teacher_name)) continue;
        if (typeof c.global_position !== "number") continue;
        sameTeacherLastPosition = c.global_position;
        break;
      }
    }
    if (jumpWarningApplies({ sameTeacherLastPosition, newPosition: ev.to_position })) keep.push(ev);
    else suppress.push({ row: ev, sameTeacherLastPosition });
  }

  const label = (ev: EventRow) =>
    `${ev.student_name ?? "(학생)"}\t${ev.report_date ?? "-"}\t${ev.teacher_name ?? "(작성자 미상)"}\t${ev.from_position}→${ev.to_position}\ttrack=${ev.track ?? "-"}`;

  console.log(`대상(미확인 jump_error) ${events.length}건 — ${APPLY ? "적용" : "드라이런"}\n`);
  console.log(`■ 경고 유지 ${keep.length}건 (같은 선생님 자기 줄에서 20 이상 건너뜀)`);
  for (const ev of keep) console.log(`   ${label(ev)}`);
  console.log(`\n■ 억제(자동 확인) ${suppress.length}건`);
  for (const s of suppress)
    console.log(`   ${label(s.row)}\t같은강사직전=${s.sameTeacherLastPosition ?? "없음"}`);
  console.log(`\n■ 손대지 않음 ${untouched.length}건 (보고서 연결 없음 = 작성자를 물어볼 대상이 없다)`);
  for (const ev of untouched) console.log(`   ${label(ev)}\tid=${ev.id}`);

  if (!APPLY) {
    console.log("\n드라이런입니다 — 적용하려면 --apply");
  } else {
    let updated = 0;
    for (const s of suppress) {
      const details = buildJumpSuppressionDetails({
        teacherName: s.row.teacher_name,
        sameTeacherLastPosition: s.sameTeacherLastPosition,
      });
      // ⚠️ jsonb는 sql.json으로([[#82]] 이중 인코딩) · 기존 details가 있으면 병합(남의 키 보존).
      // ⚠️ resolved_by는 비운다 = 시스템 자동 확인(사람이 누른 확인과 화면에서 구분된다).
      // ⚠️ where에 resolved_at is null을 다시 걸어 동시에 사람이 누른 확인을 덮지 않는다(멱등).
      const done = await sql`
        update progress_events
           set resolved_at = now(),
               details = coalesce(details, '{}'::jsonb) || ${sql.json(details)}
         where id = ${s.row.id} and resolved_at is null
        returning id`;
      updated += done.length;
    }
    console.log(`\n적용 완료 — ${updated}건 자동 확인 처리(원복용 id):`);
    for (const s of suppress) console.log(`   ${s.row.id}`);
  }
} finally {
  await sql.end();
}
