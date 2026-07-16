-- 결석 위험 집계는 append-only 출결 원본이 아니라 학생·반·수업일별 최신 정정 행만 센다.
-- security invoker(호출자 RLS) + auth_tenant_id() 명시 필터의 이중 테넌트 격리를 유지한다.

create or replace function public.dashboard_absence_risk(p_min int default 3)
returns table (student_id uuid, student_name text, absences bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with anchor as (
    select max(session_date) as d
    from attendance_records
    where tenant_id = auth_tenant_id()
  ),
  effective as (
    select distinct on (a.student_id, a.class_id, a.session_date)
      a.tenant_id,
      a.student_id,
      a.class_id,
      a.session_date,
      a.status
    from attendance_records a
    cross join anchor
    where a.tenant_id = auth_tenant_id()
      and anchor.d is not null
      and a.session_date >= anchor.d - interval '13 days'
      and a.session_date <= anchor.d
    order by a.student_id, a.class_id, a.session_date, a.recorded_at desc, a.id desc
  )
  select
    s.id as student_id,
    s.name as student_name,
    count(*) as absences
  from effective a
  join students s on s.id = a.student_id and s.tenant_id = a.tenant_id
  where a.status = 'absent'
  group by s.id, s.name
  having count(*) >= p_min
  order by absences desc;
$$;

comment on function public.dashboard_absence_risk(int) is
  '최근 유효 출결일 기준 14일 결석 위험: 학생·반·수업일별 최신 recorded_at, 동률이면 id 내림차순 행만 집계.';
