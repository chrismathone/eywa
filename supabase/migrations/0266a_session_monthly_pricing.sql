-- EiE 월 정액도 강사 정산에 포함(2026-09-16 원장 확정).
-- 금액 단위는 확정 시점에 스냅샷으로 보존한다. 기존 행은 회당으로 유지하며 재계산하지 않는다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.invoice_session_terms
  add column if not exists pricing_mode text not null default 'per_session'
  check (pricing_mode in ('per_session', 'monthly'));
alter table public.invoice_teacher_splits
  add column if not exists pricing_mode text not null default 'per_session'
  check (pricing_mode in ('per_session', 'monthly'));

comment on column public.invoice_session_terms.pricing_mode is
  '확정 금액 단위. per_session=회차×단가, monthly=월 고정 금액(회차 곱셈 없음). 확정 시점 스냅샷.';
comment on column public.invoice_session_terms.unit_price is
  '확정 시 단가. pricing_mode=monthly이면 월 금액이며 회차를 곱하지 않는다.';
comment on column public.invoice_teacher_splits.pricing_mode is
  '정산 금액 단위 스냅샷. monthly는 confirmed_amount=actual_amount=확정 월 금액.';
comment on column public.invoice_teacher_splits.unit_price is
  '정산 시 단가. pricing_mode=monthly이면 월 금액.';

notify pgrst, 'reload schema';
commit;
