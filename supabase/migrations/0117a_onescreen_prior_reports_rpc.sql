-- 0117a_onescreen_prior_reports_rpc.sql (손수 alpha)
-- 원스크린 로스터가 강사 담당 학생 전원의 lesson_reports **전체 이력**을 limit 없이 fetch하던 것(roster.ts)이
-- PostgREST 1000행 상한에 조용히 절단돼(B2 위반, #54) 이전 회차 참고행·'가져오기'·직전 점수Δ·교재 승계가
-- 오래된 학생부터 통째로 사라졌다. 필요한 건 (학생×과목)별 "대상 날짜 직전 최신 1건"뿐이므로 DISTINCT ON RPC로
-- 정확히 그만큼만 반환한다(반환 행수 = 학생×과목 수준 = 수백 이하, 절단 불가). 당일 행은 roster가 별도로 eq(date) 조회.
-- security invoker + auth_tenant_id() 이중격리(0039a/0040a 패턴) — 호출자(강사) RLS로 테넌트 밖 차단.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create or replace function onescreen_prior_reports(p_student_ids uuid[], p_before date)
returns table (
  student_id uuid,
  subject text,
  report_date date,
  progress text,
  exam_info text,
  textbook text,
  homework_today text,
  homework_score text,
  attitude text,
  notes text
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (r.student_id, r.subject)
    r.student_id, r.subject, r.report_date, r.progress,
    r.exam_info, r.textbook, r.homework_today, r.homework_score,
    r.attitude, r.notes
  from lesson_reports r
  where r.tenant_id = auth_tenant_id()
    and r.student_id = any(p_student_ids)
    and r.report_date < p_before
  order by r.student_id, r.subject, r.report_date desc
$$;
