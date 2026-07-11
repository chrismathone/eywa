-- 대시보드 — "등록됨(enrolled)인데 활성 수강(enrollment)이 없는 학생" = 반 배정 필요 명단.
-- 등록 전환은 정상 경로에서 반 ≥1개를 강제하지만, ①전환 중 enrollments insert 실패로 학생만 생성 ②임포트로
-- status=enrolled만 유입 ③선등록(수업 시작 전) 등으로 미배정 재원생이 생긴다. 원장이 대시보드에서 바로 후속조치.
-- security invoker(호출자 RLS) + 명시적 auth_tenant_id() 필터로 멀티테넌트 격리 이중 방어(0039a 패턴).
-- 활성 수강 정의(end_date IS NULL OR end_date >= today)는 등록상담 칸반 assignedClassCount와 동일.
create or replace function public.dashboard_unassigned_enrolled(p_limit int default 8)
returns table (student_id uuid, student_name text, grade text, school text, enrolled_at date)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.name, s.grade, s.school, s.enrolled_at
  from students s
  where s.tenant_id = auth_tenant_id()
    and s.status = 'enrolled'
    and not exists (
      select 1 from enrollments e
      where e.student_id = s.id
        and (e.end_date is null or e.end_date >= current_date))
  order by s.enrolled_at desc nulls last
  limit p_limit;
$$;
