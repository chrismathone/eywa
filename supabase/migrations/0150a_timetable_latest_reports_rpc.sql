-- 시간표 hover용 "학생별 최신 수업보고서" RPC — 전 이력 fetch를 최신 1건 집계로 대체 (2026-07-27 성능).
--
-- 배경(실측): getWeeklyScheduleWithStudents가 hover 카드의 "최근 진도·교재 1건"을 위해 로스터 399명의
-- 보고서 **전 이력 13,233행(3.2MB)** 을 매 렌더마다 끌어왔다(PostgREST 1000행 페이지 → 직렬 왕복 ~14회).
-- 실제 필요한 건 (학생×반)·(학생×과목) 최신 1건씩 = **336행(87KB)**. 시간표의 모든 네비(과목 전환·주 이동·
-- 창 열기)가 이 비용을 물고 있었다. B2 규칙(집계는 RPC) 그대로 — 0039a/0040a 패턴.
--
-- 반환 = 두 버킷의 union:
--   · bucket 'class:<uuid>'  — (학생, 반) 최신 1건. hover의 1순위(0134a: 그 수업의 보고서 우선).
--   · bucket 'subject:<key>' — (학생, 과목) 최신 1건. 반 매칭 실패 시 폴백(과목 게이트, 2026-07-27).
--
-- ⚠️ 과목 판정(rsubj)은 src/features/timetable/lib/report-subject.ts 의 `reportSubject`와 **같은 규칙**이어야
--    한다: 보고서 subject → 반 subject → 레거시 폴백 'math'(이관분 14,695건 = 전부 수학 강사 작성, 실측).
--    한쪽을 바꾸면 반드시 둘 다 바꿀 것(TS쪽 Vitest가 규칙을 문서화한다).
--
-- 격리: security invoker(호출자 RLS) + 명시 tenant 필터 이중 방어.
--   · 세션 경로: p_tenant 미지정 → auth_tenant_id(). RLS도 같은 테넌트로 이미 좁힌다.
--   · cron/admin 경로(시트 익스포터): service_role은 auth_tenant_id()가 null이라 **p_tenant 필수** —
--     쿼리 주입부(TimetableDb)가 신뢰 tenantId를 넘긴다. 인증 사용자가 남의 p_tenant를 넣어도
--     invoker RLS가 자기 테넌트 행만 보여주므로 교집합 = 빈 결과(유출 없음).

create or replace function public.timetable_latest_reports(
  p_student_ids uuid[],
  p_tenant uuid default null
)
returns table (
  bucket text,
  student_id uuid,
  class_id uuid,
  report_date date,
  progress text,
  exam_info text,
  homework_score text,
  teacher_name text,
  textbook text,
  subject text
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      lr.id,
      lr.student_id,
      lr.class_id,
      lr.report_date,
      lr.progress,
      lr.exam_info,
      lr.homework_score,
      lr.teacher_name,
      lr.textbook,
      lr.subject,
      coalesce(nullif(trim(lr.subject), ''), nullif(trim(c.subject), ''), 'math') as rsubj
    from lesson_reports lr
    left join classes c on c.id = lr.class_id
    where lr.tenant_id = coalesce(p_tenant, auth_tenant_id())
      and lr.student_id = any (p_student_ids)
      and lr.progress is not null
  )
  -- (학생, 반) 최신 1건 — report_date desc, id desc(같은 날짜 2건 tie-break, 기존 JS와 동일 규칙)
  (
    select distinct on (b.student_id, b.class_id)
      'class:' || b.class_id::text,
      b.student_id, b.class_id, b.report_date, b.progress, b.exam_info,
      b.homework_score, b.teacher_name, b.textbook, b.subject
    from base b
    where b.class_id is not null
    order by b.student_id, b.class_id, b.report_date desc, b.id desc
  )
  union all
  -- (학생, 과목) 최신 1건 — 반 매칭 없는 슬롯의 폴백(레거시 이관분 포함)
  (
    select distinct on (b.student_id, b.rsubj)
      'subject:' || b.rsubj,
      b.student_id, b.class_id, b.report_date, b.progress, b.exam_info,
      b.homework_score, b.teacher_name, b.textbook, b.subject
    from base b
    order by b.student_id, b.rsubj, b.report_date desc, b.id desc
  );
$$;

comment on function public.timetable_latest_reports(uuid[], uuid) is
  '시간표 hover용 학생별 최신 수업보고서(반 버킷 + 과목 버킷). 과목 판정 규칙은 report-subject.ts와 동기 유지.';
