-- s2_0054 — 경영 분석: AI 경영 검토 결과 보관
-- 규칙(CLAUDE.md 작업 원칙): AI는 명시 버튼에서만 부르고 마지막 결과는 DB에 남겨 '다시 검토'를 누르기 전까지 그대로 보여 준다.
--   복제본(aywa-next)은 결과를 저장하지 않았다 — main에서 이 표를 새로 둔다.
-- AI에 보낸 것 = 선택 월의 집계 지표·산식뿐(학생·직원 이름, 상담 원문, 개인별 급여 없음). facts_hash = 그 입력의 sha256(같은 입력인지 비교용).
-- 서버 전용: 브라우저 정책 0개는 의도적이다. 덧붙이기만 한다(이력 보존 — 화면은 그 달의 가장 최근 한 줄).
-- 🔴 s2_0052 뒤 · 한 번만 실행. 되돌리기 = scripts/_oneoff/revert-s2_0054-management-ai-reviews.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.management_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  month text not null check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  answer jsonb not null check (jsonb_typeof(answer) = 'object'),
  model text not null check (length(model) between 1 and 120),
  facts_hash text not null check (facts_hash ~ '^[a-f0-9]{64}$'),
  facts_observed_at timestamptz not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);
create index management_ai_reviews_month_idx on public.management_ai_reviews (tenant_id, month, created_at desc);

alter table public.management_ai_reviews enable row level security;
revoke all on public.management_ai_reviews from public, anon, authenticated, service_role;
grant select, insert on public.management_ai_reviews to service_role;

commit;
