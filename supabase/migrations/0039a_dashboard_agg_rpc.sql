-- 대시보드 집계 RPC — 전건 fetch + JS 집계를 DB group-by 1쿼리로 대체(반응속도).
-- security invoker(호출자 RLS 적용) + 명시적 auth_tenant_id() 필터로 멀티테넌트 격리 이중 방어.

-- ① 미수 상위 — 학생별 미납 잔액 합산 top N (구 getTopOutstanding: fetchAllPaged 전건 + JS).
create or replace function public.dashboard_top_outstanding(p_limit int default 8)
returns table (student_id uuid, student_name text, amount numeric, status text)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id as student_id,
    s.name as student_name,
    sum(i.amount_total - i.amount_paid - coalesce(i.amount_discount, 0)) as amount,
    case when bool_or(i.status = 'unpaid') then 'unpaid' else 'partial' end as status
  from invoices i
  join students s on s.id = i.student_id and s.tenant_id = i.tenant_id
  where i.tenant_id = auth_tenant_id()
    and i.status in ('unpaid', 'partial')
  group by s.id, s.name
  having sum(i.amount_total - i.amount_paid - coalesce(i.amount_discount, 0)) > 0
  order by amount desc
  limit p_limit;
$$;

-- ② 결석 위험 — 가장 최근 기록일 기준 14일 결석 ≥ p_min (구 getAbsenceRiskStudents: anchor + 전건 조인 + JS).
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
  )
  select
    s.id as student_id,
    s.name as student_name,
    count(*) as absences
  from attendance_records a
  join students s on s.id = a.student_id and s.tenant_id = a.tenant_id
  cross join anchor
  where a.tenant_id = auth_tenant_id()
    and a.status = 'absent'
    and anchor.d is not null
    and a.session_date >= anchor.d - interval '13 days'
    and a.session_date <= anchor.d
  group by s.id, s.name
  having count(*) >= p_min
  order by absences desc;
$$;
