-- 0113a: AI 호출 usage 계측 — 호출 1건 = 1행 (2026-07-16, 운영실 AI 브리핑 선행 PR0).
--
-- 왜: 지금까지 generateJSON이 provider 응답의 usage(토큰)를 버려서 AI 비용 계측이 0이었다
-- (키 분리 ANTHROPIC_API_KEY vs _CONSULTATIONS가 유일한 빌링 구분). 일일 브리핑처럼
-- 사용자-무트리거 반복 호출이 생기는 시점부터는 실측 없이는 비용 통제가 불가능하다.
--
-- 쓰기 = 서버(generateJSON 내부, service_role admin client)만 — insert 정책 없음(0074a notifications 선례).
-- 읽기 = 테넌트 멤버 자기 테넌트 행(select 정책, 0108a 선례). 현재 앱 소비 화면은 없음(운영 점검·SQL 집계용).
-- tenant_id nullable: 테넌트 컨텍스트를 아직 안 넘기는 기존 호출부는 null로 기록(스레딩은 점진 확장).
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create table if not exists ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade, -- null = 컨텍스트 미상 호출
  feature text not null,        -- 호출부 식별자: 'meeting_analysis' | 'enrollment_analysis' | 'classnote_ment' | 'daily_briefing' …
  provider text not null,       -- 'anthropic' | 'upstage'
  model text not null,          -- 실사용 모델 id (UI 미노출 정책 — 계측 전용)
  key_name text not null,       -- 빌링 버킷: 'default' | 'consultations'
  input_tokens int,             -- provider가 usage를 안 주면 null
  output_tokens int,
  ok boolean not null default true,
  error text,                   -- 실패 시 한 줄 사유(원문은 로그로)
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_logs_tenant_created_idx
  on ai_usage_logs (tenant_id, created_at desc);

alter table ai_usage_logs enable row level security;

-- 테넌트 멤버는 자기 테넌트 행 read. write는 서버(service_role)만 — 정책 없음 = RLS bypass만 통과.
drop policy if exists ai_usage_logs_tenant_read on ai_usage_logs;
create policy ai_usage_logs_tenant_read on ai_usage_logs
  for select using (tenant_id = auth_tenant_id());
