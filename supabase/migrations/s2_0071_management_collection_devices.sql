-- s2_0071 — 경영 분석: 학원 PC 파일 수집기(기본 꺼짐) · 기기 연결(90일 만료 · 해제 가능)
-- 출처: aywa-next 20261101153401 · 20261101155010. 복제본 전용 가정(복제본 주소 고정 · Vercel 보호 우회 키)은 뺐다.
--
-- 🔴 기본 꺼짐: `management_collection_settings`에 줄이 없거나 collector_enabled=false면 수집기 API는 모든 기기 요청을 거절하고
--   연결 파일도 발급하지 않는다. 원장이 경영 분석 → 자료 수집함에서 켠다(`src/features/management/server/collector-auth.ts`).
-- 기기가 하는 일은 원본 엑셀을 보내 '대조 기록'(s2_0070 management_source_batches)을 남기는 것뿐 — 청구·학생·회계 자료를 고치지 않고,
--   다른 업무 표 권한이 없다. 기기 비밀은 해시(sha256)만 저장한다.
-- 서버 전용: 브라우저 정책 0개는 의도적이다(admin 클라이언트 + tenant_id 필터).
-- 🔴 s2_0070 뒤에 적용 · 한 번만 실행. 되돌리기 = scripts/_oneoff/revert-s2_0071-management-collection-devices.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.management_collection_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid not null references public.users(id),
  name text not null check (length(btrim(name)) between 1 and 60),
  secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  revoked_at timestamptz,
  last_seen_at timestamptz,
  last_request_at timestamptz not null default '1970-01-01T00:00:00Z',
  last_success_at timestamptz,
  last_result jsonb check (last_result is null or jsonb_typeof(last_result) = 'object')
);
create index management_collection_devices_tenant_idx on public.management_collection_devices (tenant_id, created_at desc);
create index management_collection_devices_actor_idx on public.management_collection_devices (created_by);

-- 지점 스위치(원장이 켜고 끈다). 줄이 없으면 꺼짐.
create table public.management_collection_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  collector_enabled boolean not null default false,
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default now()
);

alter table public.management_collection_devices enable row level security;
alter table public.management_collection_settings enable row level security;
revoke all on public.management_collection_devices, public.management_collection_settings from public, anon, authenticated, service_role;
grant select, insert, update on public.management_collection_devices, public.management_collection_settings to service_role;

commit;
