-- s2_0056 — 경영 분석 회계 자료: 같은 달의 손익계산서와 계정별원장을 따로 보관한다
-- 까닭(커밋 전 리뷰 2026-11-11): s2_0052의 유일 조건이 (지점 · 기간)뿐이라 10월 손익계산서를 저장하면 10월 원장이 새 버전으로 덮였다 —
--   그 뒤 ECOUNT 월별 대조는 원장을 못 찾아 막히고, 반대 순서면 확정 손익이 원장으로 바뀐다.
-- 무엇: 칸 `source_kind`(profit_loss | ledger · 문서의 sourceKind에서 계산 — 없으면 profit_loss) + 유일 조건을 (지점 · 기간 · 종류)로 +
--   저장 함수가 같은 종류의 줄만 찾는다. s2_0052을 적용한 직후라 표는 비어 있다(줄이 있어도 칸은 문서에서 저절로 채워진다).
-- 🔴 s2_0052 뒤 · 앱보다 먼저. 되돌리기 = scripts/_oneoff/revert-s2_0056-management-accounting-source-kind.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.management_accounting_reports
  add column source_kind text generated always as (case when document->>'sourceKind' = 'ledger' then 'ledger' else 'profit_loss' end) stored;
alter table public.management_accounting_reports drop constraint management_accounting_period_unique;
alter table public.management_accounting_reports
  add constraint management_accounting_period_unique unique (tenant_id, period_start, period_end, source_kind);

create or replace function public.save_management_accounting(p_tenant uuid, p_actor uuid, p_document jsonb, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.management_accounting_reports; start_date date; end_date date; kind text;
begin
  if not exists (select 1 from public.users where id = p_actor and tenant_id = p_tenant and system_role = 'master' and status = 'active') then
    raise exception 'management_access_denied';
  end if;
  start_date := (p_document->>'start')::date;
  end_date := (p_document->>'end')::date;
  kind := case when p_document->>'sourceKind' = 'ledger' then 'ledger' else 'profit_loss' end;
  if p_expected_version is null or p_expected_version < 0 or start_date is null or end_date is null
     or p_document->>'scopeConfirmed' is distinct from 'true' or jsonb_typeof(p_document->'complete') is distinct from 'boolean' then
    raise exception 'invalid_management_document';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || start_date::text || end_date::text || kind, 0));
  select * into current_row from public.management_accounting_reports
    where tenant_id = p_tenant and period_start = start_date and period_end = end_date and source_kind = kind for update;
  if found then
    if current_row.document = p_document then
      return jsonb_build_object('id', current_row.id, 'version', current_row.version, 'unchanged', true);
    end if;
    if current_row.version <> p_expected_version then raise exception 'version_conflict'; end if;
    update public.management_accounting_reports
      set document = p_document, version = version + 1, updated_by = p_actor, updated_at = now()
      where id = current_row.id and tenant_id = p_tenant returning * into current_row;
  else
    if p_expected_version <> 0 then raise exception 'version_conflict'; end if;
    insert into public.management_accounting_reports (tenant_id, period_start, period_end, document, updated_by)
      values (p_tenant, start_date, end_date, p_document, p_actor) returning * into current_row;
  end if;
  insert into public.management_accounting_versions (report_id, version, tenant_id, document, actor_id)
    values (current_row.id, current_row.version, p_tenant, p_document, p_actor);
  return jsonb_build_object('id', current_row.id, 'version', current_row.version, 'unchanged', false);
end $$;
-- 실행 권한은 s2_0052 그대로다(create or replace는 권한을 바꾸지 않는다 — service_role만).

commit;
