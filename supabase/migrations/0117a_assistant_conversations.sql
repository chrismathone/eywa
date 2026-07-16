-- 0117a: 운영실 AI 비서 대화 저장 (2026-07-16, "학원 매니저 팀" Phase 2 — 대화형 비서 도입 승인).
--
-- assistant_conversations — 대화 1건 = 1행. messages jsonb에는 **표시용 텍스트 턴만** 저장
-- ([{role:'user'|'assistant', content, at}]) — tool_use 원시 블록·툴 조회 결과는 저장하지 않는다
-- (재질문 시 모델이 툴을 다시 부른다 = 저장분에 조회 데이터 스냅샷이 안 남아 권한 변화에도 안전).
--
-- 실행 경로가 **사용자 세션**(쿠키 createClient — RLS·teacher scope 자동 상속, service_role 불사용)이라
-- 저장도 세션 경로 — RLS는 (tenant, 본인) own-row로 한정. 질문 UI·서버 액션은 canManageStaff
-- (master/admin/manager) 게이트 뒤(#77 — 모든 표면이 같은 게이트: 대시보드 카드 + askAssistant 액션뿐).
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create table if not exists assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text,                                   -- 첫 질문 앞 60자(목록 표시용)
  messages jsonb not null default '[]'::jsonb,  -- [{role:'user'|'assistant', content: text, at: iso}]
  model_version text,                           -- 마지막 응답 모델 id(계측·라벨용, modelDisplayLabel 경유 표시)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_conversations_tenant_user_idx
  on assistant_conversations (tenant_id, user_id, updated_at desc);

alter table assistant_conversations enable row level security;

-- own-row 전권(select/insert/update/delete) — 본인 대화만. 타 사용자·타 테넌트 행은 완전 불가시.
drop policy if exists assistant_conversations_own on assistant_conversations;
create policy assistant_conversations_own on assistant_conversations
  for all to authenticated
  using (tenant_id = public.auth_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.auth_tenant_id() and user_id = auth.uid());

drop trigger if exists assistant_conversations_set_updated_at on assistant_conversations;
create trigger assistant_conversations_set_updated_at
  before update on assistant_conversations
  for each row execute function public.tg_set_updated_at();
