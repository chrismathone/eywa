-- 0111a — 지출 금액 소수점 지원(달러·유로 등 소수 통화)
-- expenses.amount가 numeric(12,0)이라 $10.60을 입력해도 정수로 반올림($11)돼 저장됐다. 통화별 소수 자릿수는
-- 코드가 단일 소스로 관리하고(src/features/billing/currencies.ts: KRW/JPY=0, USD/EUR/CNY/GBP=2), DB는 최대
-- 2자리까지 담도록 scale을 0→2로 넓힌다. 원·엔 지출은 코드에서 정수로 반올림해 넣으므로 소수 꼬리가 붙지 않는다.
--
-- 기존 값은 전부 정수라 확대(0→2)는 무손실. numeric의 scale 확대는 값 재작성 없이 카탈로그만 바꾸는
-- 가벼운 연산이지만, 안전하게 IF EXISTS/현재 타입 확인 후 멱등 실행한다.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'expenses'
      and column_name = 'amount'
      and numeric_scale = 0
  ) then
    alter table public.expenses
      alter column amount type numeric(12, 2) using amount::numeric(12, 2);
  end if;
end $$;

alter table public.expenses alter column amount set default 0;
