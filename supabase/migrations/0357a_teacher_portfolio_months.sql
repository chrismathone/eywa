-- 0357a — 직원 포트폴리오: 강사 × 월 점수와 근거(직원 평가의 내부 탭).
--
-- 원장 2026-10-12: "모든 점수는 말일 마감하고 1일부터 새점수" · "마감 이후에 뭘 보충하더라도 점수 변화는 없음".
-- 그래서 한 달을 한 행으로 저장하고, 마감한 행(closed_at)은 DB가 고치지 못하게 막는다.
--
--  · payload = 화면이 그리는 그 달의 점수와 근거(PortfolioPeriod). 학생은 id로만 싣는다.
--  · closing_source: 'month_end' = 달이 끝난 직후 마감 · 'reconstructed' = 한참 뒤 남은 기록으로 다시 만든 마감
--    (화면이 '마감 · 재구성'이라고 밝힌다 — 그 달 말일에 실제로 확정한 점수가 아니다).
--  · ⚠️ RLS는 켜되 정책을 만들지 않는다. 강사별 점수·담당 매출이 실려 있어 테넌트 전체 읽기 정책을 붙이면
--    강사가 브라우저 키로 남의 점수를 읽는다(#77). 읽기·쓰기는 서버(service_role)가 화면 게이트를 지난 뒤에만 한다.
--  · 산식이 바뀌어 마감한 달을 다시 계산해야 하면 그 달의 행을 지우고 다시 집계한다(삭제는 막지 않는다).
--
-- 멱등 · 새 표 하나라 기존 화면에 영향 없음. 앱은 이 표가 없어도 돈다(포트폴리오 탭이 '아직 집계 전'으로 보일 뿐).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.teacher_portfolio_months (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  teacher_id uuid not null references public.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- 수업 대상 마지막 날. 진행 중인 달은 집계 전날, 마감한 달은 말일.
  period_end date not null,
  -- 8개 항목이 모두 산출됐을 때만 합계. null = 산출불가.
  total numeric(4,1) check (total is null or total between 0 and 100),
  known_count smallint not null check (known_count between 0 and 8),
  class_count integer not null check (class_count >= 0),
  subjects text[] not null default '{}',
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2097152),
  closed_at timestamptz,
  closing_source text check (closing_source in ('month_end', 'reconstructed')),
  computed_at timestamptz not null default now(),
  primary key (tenant_id, teacher_id, month),
  constraint teacher_portfolio_months_closing_pair check ((closed_at is null) = (closing_source is null))
);
create index if not exists teacher_portfolio_months_tenant_month_idx
  on public.teacher_portfolio_months (tenant_id, month);
create index if not exists teacher_portfolio_months_teacher_idx
  on public.teacher_portfolio_months (teacher_id);

alter table public.teacher_portfolio_months enable row level security;
revoke all on public.teacher_portfolio_months from public, anon, authenticated;
grant all on public.teacher_portfolio_months to service_role;
-- 정책 없음(의도) — service_role만 지난다.

-- 마감한 달은 굳는다. 집계 코드가 마감한 행을 건너뛰는 것이 1차 방어이고, 이 트리거가 마지막 벽이다.
create or replace function public.tg_teacher_portfolio_months_lock_closed() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.closed_at is not null then
    raise exception '마감한 달의 점수는 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists teacher_portfolio_months_lock_closed on public.teacher_portfolio_months;
create trigger teacher_portfolio_months_lock_closed
  before update on public.teacher_portfolio_months
  for each row execute function public.tg_teacher_portfolio_months_lock_closed();

comment on table public.teacher_portfolio_months is
  '직원 포트폴리오 월간 점수(강사 × 월). 마감한 행은 수정 불가. service_role 전용 — 화면 게이트를 지난 서버만 읽는다.';
notify pgrst, 'reload schema';
commit;
