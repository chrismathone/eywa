-- 지점별 Google 계정. 비밀은 Vault에만, 조회/쓰기/RPC는 서버 전용.
begin;
create table if not exists public.homework_video_drive_account_owners (
  permission_id text primary key check(permission_id ~ '^[A-Za-z0-9_-]{1,160}$'),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(), unique(tenant_id,permission_id)
);
create table if not exists public.homework_video_drive_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  google_subject text not null unique check(length(google_subject) between 1 and 255),
  permission_id text not null unique,
  email text not null check(length(email) between 3 and 320),
  oauth_client_id text not null check(length(oauth_client_id) between 1 and 255),
  refresh_secret_id uuid not null references vault.secrets(id),
  token_version integer not null default 1 check(token_version>0),
  status text not null default 'ready' check(status in ('ready','needs_reauth')),
  connected_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(tenant_id,id),
  foreign key(tenant_id,permission_id) references public.homework_video_drive_account_owners(tenant_id,permission_id)
);
create table if not exists public.homework_video_drive_oauth_attempts (
  state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  challenge text not null check(challenge ~ '^[A-Za-z0-9_-]{43}$'),
  expected_version uuid, oauth_client_id text not null,
  intent text not null check(intent in ('reconnect','switch')),
  expires_at timestamptz not null default now()+interval '10 minutes',
  consumed_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists homework_video_drive_oauth_user_idx on public.homework_video_drive_oauth_attempts(tenant_id,user_id);
create index if not exists homework_video_drive_oauth_expiry_idx on public.homework_video_drive_oauth_attempts(expires_at);
alter table public.homework_video_drive_roots
  add column if not exists connection_id uuid,
  add column if not exists chain_complete boolean not null default false,
  add column if not exists legacy_permission_id text,
  add column if not exists legacy_auth_fingerprint text check(legacy_auth_fingerprint ~ '^[a-f0-9]{64}$');
alter table public.homework_video_drive_settings add column if not exists connection_id uuid;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.homework_video_drive_roots'::regclass and conname='homework_video_drive_roots_connection_tenant_fk') then
    alter table public.homework_video_drive_roots add constraint homework_video_drive_roots_connection_tenant_fk
      foreign key(tenant_id,connection_id) references public.homework_video_drive_connections(tenant_id,id);
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.homework_video_drive_settings'::regclass and conname='homework_video_drive_settings_connection_tenant_fk') then
    alter table public.homework_video_drive_settings add constraint homework_video_drive_settings_connection_tenant_fk
      foreign key(tenant_id,connection_id) references public.homework_video_drive_connections(tenant_id,id);
  end if;
end $$;
alter table public.homework_video_drive_account_owners enable row level security;
alter table public.homework_video_drive_connections enable row level security;
alter table public.homework_video_drive_oauth_attempts enable row level security;
revoke all on public.homework_video_drive_account_owners,public.homework_video_drive_connections,
  public.homework_video_drive_oauth_attempts from public,anon,authenticated;
grant all on public.homework_video_drive_account_owners,public.homework_video_drive_connections,
  public.homework_video_drive_oauth_attempts to service_role;

create or replace function public.create_homework_video_drive_oauth_attempt(
  p_tenant uuid,p_user uuid,p_state_hash text,p_challenge text,p_expected_version uuid,p_oauth_client_id text,p_intent text
) returns void language plpgsql security invoker set search_path='' as $$
declare v_version uuid; v_connection uuid;
begin
  perform pg_advisory_xact_lock(338104);
  if not exists(select 1 from public.users where id=p_user and tenant_id=p_tenant and status is distinct from 'inactive') then
    raise exception '로그인 정보를 다시 확인해 주세요';
  end if;
  select version,connection_id into v_version,v_connection from public.homework_video_drive_settings where tenant_id=p_tenant;
  if v_version is distinct from p_expected_version then raise exception '다른 화면에서 설정이 변경되었습니다. 새로고침해 주세요'; end if;
  if p_intent not in ('reconnect','switch') or p_intent is null or (p_intent='reconnect' and v_connection is null) then
    raise exception '연결할 계정을 다시 확인해 주세요';
  end if;
  delete from public.homework_video_drive_oauth_attempts where expires_at<now() or (tenant_id=p_tenant and user_id=p_user);
  insert into public.homework_video_drive_oauth_attempts(state_hash,tenant_id,user_id,challenge,expected_version,oauth_client_id,intent)
    values(p_state_hash,p_tenant,p_user,p_challenge,p_expected_version,p_oauth_client_id,p_intent);
end $$;
create or replace function public.consume_homework_video_drive_oauth_attempt(p_tenant uuid,p_user uuid,p_state_hash text,p_challenge text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.homework_video_drive_oauth_attempts;
begin
  update public.homework_video_drive_oauth_attempts set consumed_at=now()
    where tenant_id=p_tenant and user_id=p_user and state_hash=p_state_hash and challenge=p_challenge
      and consumed_at is null and expires_at>now() returning * into v_row;
  if not found then return null; end if;
  return jsonb_build_object('expectedVersion',v_row.expected_version,'oauthClientId',v_row.oauth_client_id,'intent',v_row.intent);
end $$;
revoke all on function public.create_homework_video_drive_oauth_attempt(uuid,uuid,text,text,uuid,text,text),
  public.consume_homework_video_drive_oauth_attempt(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_homework_video_drive_oauth_attempt(uuid,uuid,text,text,uuid,text,text),
  public.consume_homework_video_drive_oauth_attempt(uuid,uuid,text,text) to service_role;
commit;
notify pgrst,'reload schema';
