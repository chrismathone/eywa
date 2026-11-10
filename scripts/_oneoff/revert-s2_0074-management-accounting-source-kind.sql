-- s2_0074 되돌리기 — 회계 자료 유일 조건을 (지점 · 기간)으로 되돌리고 종류 칸을 지운다.
-- 🔴 앱을 먼저 되돌린 뒤. 같은 기간에 손익계산서와 원장이 함께 저장돼 있으면 멈춘다(먼저 한쪽을 정리할 것).
-- 저장 함수 본문은 s2_0070 파일의 것으로 다시 만든다(이 파일 뒤에 s2_0070의 create function 부분을 create or replace로 실행).
begin;
do $$
begin
  if exists (select 1 from public.management_accounting_reports group by tenant_id, period_start, period_end having count(*) > 1) then
    raise exception '같은 기간에 회계 자료가 둘 이상 있어 되돌릴 수 없습니다';
  end if;
end $$;
alter table public.management_accounting_reports drop constraint management_accounting_period_unique;
alter table public.management_accounting_reports add constraint management_accounting_period_unique unique (tenant_id, period_start, period_end);
alter table public.management_accounting_reports drop column source_kind;
commit;
