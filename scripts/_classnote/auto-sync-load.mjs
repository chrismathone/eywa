// scripts/_classnote/auto-sync-load.mjs — 반 보드 자동 동기화의 **대조용 조회**(aywa DB 읽기만 · ClassNote는 보지 않는다).
//
// 🔴 1분마다 도는 조회다 — 가볍게 유지한다(원장 2026-10-03 *"병목현상과 전체 조회 등 느려질만한 요소 전체 검수 철저히"*):
//   · **한 번의 왕복**으로 끝낸다(워커의 DB 연결은 하나라 여러 조회를 나눠 보내면 그만큼 줄을 선다).
//   · 지점 학생 전체·전화번호는 읽지 않는다(동기화 본체의 loadAywa는 읽는다 — 요청이 있을 때만 도는 길이다).
//     읽는 것 = 대상 수학 반(수십 개)과 그 반의 지금 학생 id · 담임 id · 그 반들의 반 보드 연결·지난 동기화 기록(수백 줄, 사유 글은 안 받는다).
//   · 수강(`enrollments`)은 **지점 필터를 건다** — 인덱스가 (tenant_id, class_id)·(tenant_id, student_id)라, 반 id만으로 조인하면
//     앞 칸이 빠져 전 지점 수강을 통째로 훑는다(지금은 표가 작아 티가 안 나지만 수강 이력은 계속 쌓인다).
//   · 대상 반·지금 다니는 학생의 정의는 동기화 본체와 **같은 SQL 조각**(math-class-boards-load.mjs)을 쓴다.
// 2026-10-03 운영 DB 실측(반 66 · 연결 66 · 기록 311줄): DB 실행 2ms 안쪽 · 왕복 약 28ms.
import { currentEnrollmentOn, targetClassWhere } from "./math-class-boards-load.mjs";

const kstToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * @returns {Promise<{
 *   classes: Array<{classId:string, className:string, studentIds:string[], teacherId:string|null}>,
 *   links: Map<string,{boardName:string}>,
 *   members: Array<{class_id:string, student_id:string, status:string}> }>}
 *   `links` = **지점 전체** 연결(종강 반 포함 — 개명·새 반 판정이 "그 이름을 누가 쥐고 있나"를 봐야 한다) ·
 *   `members` = 대상 반의 기록만.
 * 조회 실패는 throw — 빈 값으로 삼키면 "연결이 하나도 없다 = 전부 새 반"으로 읽힌다.
 */
export async function loadAutoSyncInputs(sql, tenant) {
  const today = kstToday();
  const [row] = await sql`
    with cls as (
      select c.id, c.class_name, c.teacher_id, c.report_optout from classes c where ${targetClassWhere(sql, tenant, today)}
    ), stu as (
      select e.class_id, array_agg(distinct e.student_id) as ids
      from enrollments e join cls on cls.id = e.class_id
      where e.student_id is not null and ${currentEnrollmentOn(sql, tenant, today)}
      group by e.class_id
    )
    select
      (select coalesce(jsonb_agg(jsonb_build_object(
          'id', cls.id, 'name', cls.class_name, 'teacher', cls.teacher_id, 'optout', cls.report_optout,
          'students', coalesce(to_jsonb(stu.ids), '[]'::jsonb))), '[]'::jsonb)
        from cls left join stu on stu.class_id = cls.id) as classes,
      (select coalesce(jsonb_agg(jsonb_build_object('class_id', b.class_id, 'board_name', b.board_name)), '[]'::jsonb)
        from classnote_class_boards b where b.tenant_id = ${tenant}) as links,
      (select coalesce(jsonb_agg(jsonb_build_object('class_id', m.class_id, 'student_id', m.student_id, 'status', m.status)), '[]'::jsonb)
        from classnote_class_board_members m join cls on cls.id = m.class_id where m.tenant_id = ${tenant}) as members`;
  return {
    // reportOptout = 보고서 미발송(JJ) 반 — 오늘 다니는 학생이 1명 이상일 때만 새 보드를 만든다. 학생이 없으면 '새 반'으로 고르지 않는다(sync-request-plan.mjs classDiffReasons).
    classes: arr(row?.classes).map((c) => ({ classId: c.id, className: c.name, studentIds: arr(c.students), teacherId: c.teacher ?? null, ...(c.optout === true ? { reportOptout: true } : {}) })),
    links: new Map(arr(row?.links).map((l) => [l.class_id, { boardName: l.board_name }])),
    members: arr(row?.members),
  };
}
