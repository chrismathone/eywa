-- 미수 상위 RPC — 수납 지표 단일 공식(src/features/billing/calc.ts invoiceOutstanding)과 통일.
-- 구 0039a는 학생 단위로 합산한 뒤 clamp(having)라, 한 행의 음수 잔차(과납)가 다른 행의 미수를
-- 상쇄해 calc.ts(행 레벨 max(0, 청구−할인−수납) 합)와 금액이 어긋났다 → 행 레벨 greatest(0, …)로 교체.
-- 상태는 unpaid/partial 한정 그대로 = calc.ts의 refunded/void/paid 제외와 동치(status enum 5종).

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
    sum(greatest(0, i.amount_total - coalesce(i.amount_discount, 0) - i.amount_paid)) as amount,
    case when bool_or(i.status = 'unpaid') then 'unpaid' else 'partial' end as status
  from invoices i
  join students s on s.id = i.student_id and s.tenant_id = i.tenant_id
  where i.tenant_id = auth_tenant_id()
    and i.status in ('unpaid', 'partial')
  group by s.id, s.name
  having sum(greatest(0, i.amount_total - coalesce(i.amount_discount, 0) - i.amount_paid)) > 0
  order by amount desc
  limit p_limit;
$$;
