/**
 * 데모 강사(박지훈, teacher@ijw-demo.com)를 "실제 강사"로 만든다.
 *
 * 배경: 박지훈은 seed가 만든 auth 로그인 계정인데, 데모 데이터(564명 POC 임포트)의 반들은
 * 자체 teacher_id(POC 강사 14명)를 갖고 있어 박지훈에겐 담당 반이 0개였다 → 선생님 원스크린을
 * 실데이터로 바꾸면 빈 화면. 그래서 박지훈에게 담당 반을 부여한다.
 *
 * 비파괴 원칙(⚠️ 공유 DB·병렬 owner 세션): **teacher_id가 비어있는(null) 반만** 박지훈에게 배정한다.
 * 기존 POC 강사의 반은 절대 빼앗지 않는다(owner 화면 무영향). 데모엔 null-teacher english 반이 45개 있어
 * 그중 학생 많고 요일이 mon~fri로 분산된 6개를 고정 이름으로 배정(멱등 — 재실행해도 동일).
 *
 * 멱등: 대상은 고정 반명 리스트. teacher_id가 null이거나 이미 박지훈인 반만 set → 재실행 no-op.
 * 되돌리기: update classes set teacher_id=null where teacher_id='<박지훈id>' and class_name in (...).
 *
 * 실행: node --env-file=.env.local scripts/_poc_migration/assign-demo-teacher.cjs
 */
const postgres = require("postgres");

// mon~fri 커버 + 학생 9~11명 (2026-06 측정 기준 null-teacher english 반).
const TARGET_CLASS_NAMES = [
  "RTT3", // mon,thu,wed · 10명
  "중등E_중2 정규 A", // mon,thu · 10명
  "중등E_초6 의치대", // fri,tue,wed · 11명
  "중등E_중1 정규 A", // fri,tue,wed · 10명
  "중고E_중3 심화", // mon,thu,wed · 10명
  "중등E_중1 TOP", // fri,tue,wed · 10명
];

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

(async () => {
  const teacher = await sql`select id, display_name, tenant_id from users where email = 'teacher@ijw-demo.com'`;
  if (!teacher.length) throw new Error("teacher@ijw-demo.com 없음");
  const { id: teacherId, display_name, tenant_id } = teacher[0];

  // 대상 반: 이름 일치 + (teacher_id null 또는 이미 박지훈) → 절대 남의 반 안 뺏음.
  const updated = await sql`
    update classes
       set teacher_id = ${teacherId}
     where tenant_id = ${tenant_id}
       and class_name = any(${TARGET_CLASS_NAMES})
       and (teacher_id is null or teacher_id = ${teacherId})
    returning class_name`;

  // 충돌(이미 다른 강사가 가진 동명 반)은 건너뛴 것 — 보고.
  const skipped = await sql`
    select class_name from classes
     where tenant_id = ${tenant_id}
       and class_name = any(${TARGET_CLASS_NAMES})
       and teacher_id is not null and teacher_id <> ${teacherId}`;

  const total = await sql`select count(*)::int n from classes where teacher_id = ${teacherId}`;
  const studs = await sql`
    select count(distinct e.student_id)::int n
      from enrollments e join classes c on c.id = e.class_id
     where c.teacher_id = ${teacherId} and e.end_date is null`;

  console.log(`강사: ${display_name} (${teacherId})`);
  console.log(`배정/확정된 반: ${updated.length}개 → [${updated.map((r) => r.class_name).join(", ")}]`);
  if (skipped.length) console.log(`⚠️ 건너뜀(이미 타 강사 보유): [${skipped.map((r) => r.class_name).join(", ")}]`);
  console.log(`박지훈 총 담당 반: ${total[0].n}개 · 담당 학생(중복제거): ${studs[0].n}명`);

  await sql.end();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
