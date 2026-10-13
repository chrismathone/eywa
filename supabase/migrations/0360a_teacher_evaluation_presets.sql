-- 0360a — 강사평가 구성 저장·불러오기.
--
-- 원장 2026-10-13: *"폼 저장? 불러오기? 도 있으면 좋긴하겠네."* — 학원 설정 → 강사평가에서 지금 화면의 구성(지표 켜고 끄기·만점·
-- 점수 규칙·직접 만든 지표)에 이름을 붙여 저장하고, 나중에 불러와 바로 고치거나 저장한다. 기본 제공 구성(원장 기본 · 옛 직원
-- 포트폴리오)은 코드에 있고(`evaluation/config.ts`), 이 표는 원장이 이름 붙여 저장한 구성만 담는다.
--
--  · 불러오기는 화면에 얹을 뿐이다 — 점수를 매기는 설정(teacher_evaluation_settings)은 원장이 [저장]을 눌러야 바뀐다.
--  · ⚠️ RLS는 켜되 정책을 만들지 않는다 — 서버(service_role)가 원장 게이트를 지난 뒤에만 읽고 쓴다(0359a와 같다).
--
-- 멱등 · 앱은 이 SQL 전에도 돈다(목록이 비어 보이고, 구성 저장만 준비 안내).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.teacher_evaluation_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  config jsonb not null check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 262144),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
alter table public.teacher_evaluation_presets enable row level security;
revoke all on public.teacher_evaluation_presets from public, anon, authenticated;
grant all on public.teacher_evaluation_presets to service_role;
comment on table public.teacher_evaluation_presets is
  '강사평가 — 원장이 이름 붙여 저장한 구성(불러와 화면에 얹는다). service_role 전용 — 원장 게이트를 지난 서버만 읽고 쓴다.';

notify pgrst, 'reload schema';
commit;
