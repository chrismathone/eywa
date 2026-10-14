-- 0359a — 강사평가 설정 + 직접 만든 지표의 월 입력 + 포트폴리오 저장 표 제약 완화.
--
-- 원장 2026-10-13: 지표를 넣고 빼고, 만점·구간표·자료 없을 때 처리까지 원장이 설정에서 고친다
-- ("'이것까지 커스터마이징 가능해?' 할 정도로") · "만점이 100점이 아니여도 됨" · 수동 지표는 수동으로 입력.
--
--  · teacher_evaluation_settings = 지점마다 설정 한 줄(config = src/features/teacher-portfolio/evaluation/config.ts의 모양).
--    학원 설정 문서(tenant_settings)에 넣지 않은 까닭: 크고 원장만 쓰는 설정이라 창마다 읽는 설정 문서를 키우지 않고,
--    급여 비율 같은 민감한 기준을 다른 직원의 설정 조회에 싣지 않는다.
--  · teacher_evaluation_entries = 직접 만든 지표의 값(강사 × 달 × 지표). 마감한 달은 점수에 그때 값으로 굳어 있어,
--    나중에 이 값을 고쳐도 마감한 점수는 바뀌지 않는다(포트폴리오 저장 표의 잠금 트리거).
--  · teacher_portfolio_months: 총점 0~100 · 항목 수 0~8 제약을 푼다(켠 지표 만점의 합 · 직접 만든 지표).
--    raws = {지표 id: 원래 수치} — 설정 화면이 근거 전체(payload)를 읽지 않고 미리보기를 계산한다.
--  · ⚠️ 두 새 표 모두 RLS는 켜되 정책을 만들지 않는다 — 서버(service_role)가 원장 게이트를 지난 뒤에만 읽고 쓴다.
--
-- 멱등 · 앱은 이 SQL 전에도 돈다(설정 표가 없으면 기본 설정으로 계산하고, raws 칸이 없으면 쓰지 않는다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.teacher_evaluation_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  config jsonb not null check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 262144),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.teacher_evaluation_settings enable row level security;
revoke all on public.teacher_evaluation_settings from public, anon, authenticated;
grant all on public.teacher_evaluation_settings to service_role;
comment on table public.teacher_evaluation_settings is
  '강사평가 설정(지점마다 한 줄) — 지표 켜고 끄기·만점·점수 규칙·자료 없을 때. service_role 전용 — 원장 게이트를 지난 서버만 읽고 쓴다.';

create table if not exists public.teacher_evaluation_entries (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  teacher_id uuid not null references public.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  metric_key text not null check (metric_key ~ '^[a-z0-9]{1,16}$'),
  value numeric,
  note text check (note is null or char_length(note) <= 500),
  entered_by uuid references public.users(id) on delete set null,
  entered_at timestamptz not null default now(),
  primary key (tenant_id, teacher_id, month, metric_key)
);
create index if not exists teacher_evaluation_entries_tenant_month_idx on public.teacher_evaluation_entries (tenant_id, month);
alter table public.teacher_evaluation_entries enable row level security;
revoke all on public.teacher_evaluation_entries from public, anon, authenticated;
grant all on public.teacher_evaluation_entries to service_role;
comment on table public.teacher_evaluation_entries is
  '강사평가 — 원장이 직접 만든 지표의 월 입력(강사 × 달 × 지표). service_role 전용.';

alter table public.teacher_portfolio_months drop constraint if exists teacher_portfolio_months_total_check;
alter table public.teacher_portfolio_months alter column total type numeric(8,1);
alter table public.teacher_portfolio_months drop constraint if exists teacher_portfolio_months_known_count_check;
alter table public.teacher_portfolio_months add constraint teacher_portfolio_months_known_count_check check (known_count between 0 and 100);
alter table public.teacher_portfolio_months add column if not exists raws jsonb
  check (raws is null or (jsonb_typeof(raws) = 'object' and octet_length(raws::text) <= 16384));

notify pgrst, 'reload schema';
commit;
