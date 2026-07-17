-- 0121a: dashboard_top_outstanding의 cron(service_role) 변형 — 미수 임계 이벤트(Phase 3, 2026-07-17).
--
-- 0101a dashboard_top_outstanding은 security invoker + auth_tenant_id()라 service_role(cron admin client)에서
-- auth.uid()=null → 에러 없이 0행(silent 오보). 이벤트 감지 cron이 학생별 총 미수를 읽으려면 p_tenant 변형이
-- 필요하다(absence_risk_admin·unassigned_enrolled_admin 선례와 동일). 로직은 0101a와 바이트 동일(행 레벨
-- greatest(0, 청구−할인−수납), unpaid/partial 한정)하되 auth_tenant_id() → p_tenant. execute는 service_role만.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create or replace function public.dashboard_top_outstanding_admin(p_limit int, p_tenant uuid)
returns table (student_id uuid, student_name text, amount numeric, status text)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id as student_id,
    s.name as student_name,
    sum(greatest(0, i.amount_total - coalesce(i.amount_discount, 0) - i.amount_paid)) as amount,
    case when bool_or(i.status = 'unpaid') then 'unpaid' else 'partial' end as status
  from invoices i
  join students s on s.id = i.student_id and s.tenant_id = i.tenant_id
  where i.tenant_id = p_tenant
    and i.status in ('unpaid', 'partial')
  group by s.id, s.name
  having sum(greatest(0, i.amount_total - coalesce(i.amount_discount, 0) - i.amount_paid)) > 0
  order by amount desc
  limit p_limit;
$$;

revoke all on function public.dashboard_top_outstanding_admin(int, uuid) from public;
revoke all on function public.dashboard_top_outstanding_admin(int, uuid) from anon;
revoke all on function public.dashboard_top_outstanding_admin(int, uuid) from authenticated;
grant execute on function public.dashboard_top_outstanding_admin(int, uuid) to service_role;

comment on function public.dashboard_top_outstanding_admin(int, uuid) is
  '0101a dashboard_top_outstanding의 cron(service_role) 변형 — auth_tenant_id() 대신 p_tenant. execute는 service_role만.';
