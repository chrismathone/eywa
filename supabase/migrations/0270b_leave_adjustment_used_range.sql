-- 0270b — 연차 조정의 사용일을 **기간**(시작~종료)으로
--
-- 원장 2026-09-18: *"가감일수가 1일 이상이면 사용일 종료일 이렇게 길게해야지 하루씩만 할수있는게
-- 말이안되자나"* — 0270a가 사용일을 하루(`used_on`)로만 받아, 3일을 한 줄로 차감하면 언제부터 언제까지
-- 쉰 건지 적을 곳이 없었다.
--
-- 🔑 **이름을 바로잡을 수 있는 이유**: 적용 시점 실측으로 `leave_adjustments`가 **0줄**이라 옮길 값이
--    없다(0270a는 같은 날 적용됐고 그 사이 조정 기록이 없었다). 그래서 `used_on`을 `used_start`로
--    바꾸고 `used_end`를 더한다 — 하루짜리는 종료일을 비워 둔다.
--
-- 🔴 **잔여 산식은 여전히 안 바뀐다** — 기간은 기록·표시용이고 차감은 `days`(음수)가 한다.
-- 🔴 가감 일수와 기간 길이가 안 맞아도 **막지 않는다**(화면이 경고만) — 반차·반반차가 섞이면 정확히
--    안 맞는 게 정상이라, 세션 기간 검산(0189a)과 같은 결로 사람이 판단한다.
-- ⚠️ 시작 없이 종료만 있는 줄은 뜻이 없어 제약으로 막는다(거꾸로 된 기간도 함께).
-- ⚠️ 앱이 먼저 배포돼도, 늦게 배포돼도 죽지 않는다([[#95]]): 조회는 이 칸들이 없으면 빼고 다시 읽고,
--    쓰기는 기간을 적었을 때만 한글로 "0271a 적용 필요"를 알린다.
-- ⚠️ 0270a를 건너뛴 DB에서도 그대로 돈다(아래 rename은 컬럼이 있을 때만).
--
-- 롤백: alter table public.leave_adjustments drop column if exists used_end;
--       alter table public.leave_adjustments rename column used_start to used_on;
set local statement_timeout = '60s';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leave_adjustments' and column_name = 'used_on'
  ) then
    alter table public.leave_adjustments rename column used_on to used_start;
  end if;
end $$;

alter table public.leave_adjustments
  add column if not exists used_start date;
alter table public.leave_adjustments
  add column if not exists used_end date;

alter table public.leave_adjustments
  drop constraint if exists leave_adjustments_used_range_ordered;
alter table public.leave_adjustments
  add constraint leave_adjustments_used_range_ordered
  check (used_end is null or (used_start is not null and used_end >= used_start));

comment on column public.leave_adjustments.used_start is
  '실제 휴가 사용 **시작일**(차감 행에만 적는다 — 이월·특별휴가 부여 행은 null). 기록·표시용이고 잔여 산식에는 들어가지 않는다. 0270a에서 used_on으로 태어나 0271a에서 개명.';
comment on column public.leave_adjustments.used_end is
  '실제 휴가 사용 **종료일**. 하루면 비워 둔다(= used_start 하루). 0271a';

notify pgrst, 'reload schema';
