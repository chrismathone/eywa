-- 0092a: AI 멘트 프롬프트 오버라이드 (edutrix ai_prompt_settings 이식) — 원장이 재배포 없이
-- 멘트/추세 프롬프트 톤을 런타임 편집. 활성값(is_active)이 코드 기본 프롬프트를 덮어씀. append-only(버전 이력).
-- 프로덕션 실제 멘트는 이 테이블 활성값이 우선 → config만 봐선 결과를 알 수 없음(테스트≠프로덕션 주의).
create table if not exists ai_prompt_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- comment=단일 멘트, trend=학습 추세, comment_p1/p2=공지 모드 B 2문단(4c).
  prompt_type text not null check (prompt_type in ('comment','trend','comment_p1','comment_p2')),
  prompt_text text not null,
  is_active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- (tenant,type)당 활성 1건 보장(부분 unique) + 활성 조회 인덱스.
create unique index if not exists ai_prompt_overrides_active_key
  on ai_prompt_overrides (tenant_id, prompt_type) where is_active;
create index if not exists ai_prompt_overrides_history_idx
  on ai_prompt_overrides (tenant_id, prompt_type, created_at desc);

-- updated_at 자동 갱신
create or replace function touch_ai_prompt_overrides_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
drop trigger if exists trg_touch_ai_prompt_overrides on ai_prompt_overrides;
create trigger trg_touch_ai_prompt_overrides before update on ai_prompt_overrides
  for each row execute function touch_ai_prompt_overrides_updated_at();

-- RLS: 테넌트 멤버 read, insert/update(원장·사무 write는 앱단 canWriteTenant로 이중 방어). 0086a auth_tenant_id 패턴.
alter table ai_prompt_overrides enable row level security;
drop policy if exists ai_prompt_overrides_tenant_sel on ai_prompt_overrides;
create policy ai_prompt_overrides_tenant_sel on ai_prompt_overrides for select using (tenant_id = auth_tenant_id());
drop policy if exists ai_prompt_overrides_tenant_ins on ai_prompt_overrides;
create policy ai_prompt_overrides_tenant_ins on ai_prompt_overrides for insert with check (tenant_id = auth_tenant_id());
drop policy if exists ai_prompt_overrides_tenant_upd on ai_prompt_overrides;
create policy ai_prompt_overrides_tenant_upd on ai_prompt_overrides for update
  using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
