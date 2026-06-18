-- 0029a — 카카오 알림톡 실발송 배선. 손수 alpha 파일(원래 0027d였으나 main의 0027d_staff_phone과
--   번호 충돌해 0029a로 재명명 — 0028a_exams 다음). 전부 멱등.
-- ⚠️ drizzle migrate 대신 raw 적용한다(_journal 충돌 회피). 0027a와 마찬가지로 IF NOT EXISTS/drop+create.
-- 의존: 0001a public.auth_tenant_id(), public.tg_set_updated_at(); 0027a public.attendance_notifications.

begin;

-- A. attendance_notifications — 실발송 결과 컬럼(시뮬레이션 행은 모두 null) ----------
alter table public.attendance_notifications add column if not exists provider_message_id text;
alter table public.attendance_notifications add column if not exists error text;
alter table public.attendance_notifications add column if not exists sent_at timestamptz;
alter table public.attendance_notifications add column if not exists retry_count integer not null default 0;

-- B. kakao_channels — 학원별 발신프로필(pfId) + 승인 템플릿 ID(식별자, 비밀 아님) -----
create table if not exists public.kakao_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pf_id text,
  checkin_template_id text,
  checkout_template_id text,
  sms_fallback boolean not null default true,
  is_active boolean not null default true,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists kakao_channels_tenant_idx on public.kakao_channels (tenant_id);

-- C. RLS — tenant 격리(0027a 템플릿 그대로). service_role(발송 경로)은 RLS 우회 ---------
do $$
begin
  execute 'alter table public.kakao_channels enable row level security';
  execute 'drop policy if exists kakao_channels_tenant_isolation on public.kakao_channels';
  execute 'create policy kakao_channels_tenant_isolation on public.kakao_channels
     for all to authenticated
     using (tenant_id = public.auth_tenant_id())
     with check (tenant_id = public.auth_tenant_id())';
end $$;

-- D. updated_at 트리거 -----------------------------------------------------------
drop trigger if exists kakao_channels_set_updated_at on public.kakao_channels;
create trigger kakao_channels_set_updated_at
  before update on public.kakao_channels
  for each row execute function public.tg_set_updated_at();

commit;
