-- 0082a: 최근 접속(로그인) 기록 — 활동 로그(0081a)와 같은 사무실 전용 뷰에 표시. 멱등.
-- 2겹:
--   A. login_events = **수동 로그인 영구 기록**(로그인 액션이 signInWithPassword 성공 시 1건 insert).
--      세션이 만료·정리돼도 "누가 언제 로그인했나" 이력이 남는다.
--   B. get_staff_recent_access() = **최근 접속·자동 판별**을 auth.sessions(Supabase가 관리)에서 읽기.
--      created_at(세션 시작=로그인)·마지막 활동·기기·IP. 세션이 오래전 시작됐는데 지금도 활동 = 자동 로그인(세션 유지).
-- ⚠️ getCurrentUser(핫패스)·미들웨어는 건드리지 않음 — 반응속도 1순위 + 로그인 쿠키 버그([[#10]]) 회피.

-- A. 수동 로그인 영구 기록
create table if not exists public.login_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,           -- 로그인한 사용자(FK 없음 — 삭제돼도 이력 보존, user_name 비정규화).
  user_name text,
  session_id uuid,                 -- auth 세션 id(중복 로깅 방지·세션 연결). 유니크(세션당 1건).
  at timestamptz not null default now(),
  user_agent text,
  ip text
);
create unique index if not exists login_events_session_idx on public.login_events (session_id) where session_id is not null;
create index if not exists login_events_tenant_user_idx on public.login_events (tenant_id, user_id, at desc);

alter table public.login_events enable row level security;
-- 읽기 = 사무실(master/admin/manager)만(활동 로그와 동일). auth_system_role/auth_tenant_id(0001a·0072a).
drop policy if exists login_events_office_read on public.login_events;
create policy login_events_office_read on public.login_events
  for select
  using (tenant_id = public.auth_tenant_id() and (select public.auth_system_role()) in ('master', 'admin', 'manager'));
-- 삽입 = 본인 것만(로그인 액션이 자기 로그인 기록). 위조해도 본인 로그인 행뿐 + 사무실만 열람.
drop policy if exists login_events_self_insert on public.login_events;
create policy login_events_self_insert on public.login_events
  for insert
  with check (user_id = auth.uid() and tenant_id = public.auth_tenant_id());

-- B. 최근 접속·자동 판별 — auth.sessions 읽기(사무실·동일 테넌트만). security definer(auth 스키마 접근).
create or replace function public.get_staff_recent_access(target uuid)
returns table (session_id uuid, started_at timestamptz, last_active timestamptz, user_agent text, ip text)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  -- 사무실(master/admin/manager) + target이 호출자와 같은 테넌트일 때만. 아니면 빈 결과.
  if public.auth_system_role() not in ('master', 'admin', 'manager') then return; end if;
  if not exists (select 1 from public.users u where u.id = target and u.tenant_id = public.auth_tenant_id()) then
    return;
  end if;
  -- ⚠️ auth.sessions.refreshed_at은 timestamp(비-tz) — updated_at(tz)과 greatest 시 세션 TimeZone GUC에
  --    의존해 조용히 어긋날 수 있음(적대리뷰 LOW). GoTrue는 UTC 저장이므로 `at time zone 'utc'`로 tz 고정.
  return query
    select s.id,
           s.created_at,
           greatest(s.updated_at, coalesce(s.refreshed_at at time zone 'utc', s.updated_at)) as last_active,
           s.user_agent,
           host(s.ip) as ip
    from auth.sessions s
    where s.user_id = target
    order by greatest(s.updated_at, coalesce(s.refreshed_at, s.updated_at)) desc
    limit 10;
end;
$$;
revoke all on function public.get_staff_recent_access(uuid) from public;
grant execute on function public.get_staff_recent_access(uuid) to authenticated;
