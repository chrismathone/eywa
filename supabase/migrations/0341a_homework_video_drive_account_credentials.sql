-- 웹 클라이언트 비밀은 환경변수에만 있다. Vault에는 계정 갱신 토큰 하나만 보관한다.
begin;
create or replace function public.claim_homework_video_drive_legacy_account(p_tenant uuid,p_root text,p_permission_id text,p_auth_fingerprint text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(338104);
  if not exists(select 1 from public.homework_video_drive_roots where tenant_id=p_tenant and root_folder_id=p_root and connection_id is null) then
    raise exception '기존 영상 저장 연결을 확인해 주세요';
  end if;
  if exists(select 1 from public.homework_video_drive_account_owners where permission_id=p_permission_id and tenant_id<>p_tenant) then
    raise exception '이 Google 계정은 연결할 수 없습니다. 이 지점 전용 계정으로 로그인해 주세요';
  end if;
  insert into public.homework_video_drive_account_owners(permission_id,tenant_id) values(p_permission_id,p_tenant)
    on conflict(permission_id) do nothing;
  update public.homework_video_drive_roots set legacy_permission_id=p_permission_id,legacy_auth_fingerprint=p_auth_fingerprint
    where tenant_id=p_tenant and root_folder_id=p_root and connection_id is null;
end $$;

create or replace function public.connect_homework_video_drive_account(
  p_tenant uuid,p_expected_version uuid,p_google_subject text,p_permission_id text,p_email text,
  p_oauth_client_id text,p_refresh_token text,p_intent text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_version uuid; v_selected uuid; v_connection public.homework_video_drive_connections;
  v_new uuid:=gen_random_uuid(); v_secret uuid; v_id uuid;
begin
  perform pg_advisory_xact_lock(338104);
  select version,connection_id into v_version,v_selected from public.homework_video_drive_settings where tenant_id=p_tenant for update;
  if v_version is distinct from p_expected_version then raise exception '다른 화면에서 설정이 변경되었습니다. 새로고침해 주세요'; end if;
  if p_intent is null or p_intent not in ('switch','reconnect') or p_refresh_token is null or length(p_refresh_token) not between 1 and 8192 then
    raise exception 'Google 연결 정보를 다시 확인해 주세요';
  end if;
  if p_intent='reconnect' and not exists(select 1 from public.homework_video_drive_connections
    where id=v_selected and tenant_id=p_tenant and google_subject=p_google_subject and permission_id=p_permission_id) then
    raise exception '현재 연결된 Google 계정으로 다시 로그인해 주세요';
  end if;
  if exists(select 1 from public.homework_video_drive_account_owners where permission_id=p_permission_id and tenant_id<>p_tenant)
    or exists(select 1 from public.homework_video_drive_connections where google_subject=p_google_subject and tenant_id<>p_tenant) then
    raise exception '이 Google 계정은 연결할 수 없습니다. 이 지점 전용 계정으로 로그인해 주세요';
  end if;
  insert into public.homework_video_drive_account_owners(permission_id,tenant_id) values(p_permission_id,p_tenant)
    on conflict(permission_id) do nothing;
  select * into v_connection from public.homework_video_drive_connections where google_subject=p_google_subject;
  if found then
    if v_connection.tenant_id<>p_tenant or v_connection.permission_id<>p_permission_id then raise exception 'Google 연결 정보를 다시 확인해 주세요'; end if;
    v_id:=v_connection.id;
    perform vault.update_secret(v_connection.refresh_secret_id,p_refresh_token);
    update public.homework_video_drive_connections set email=p_email,oauth_client_id=p_oauth_client_id,
      token_version=token_version+1,status='ready',updated_at=now() where id=v_id and tenant_id=p_tenant;
  else
    if exists(select 1 from public.homework_video_drive_connections where permission_id=p_permission_id) then
      raise exception 'Google 연결 정보를 다시 확인해 주세요';
    end if;
    v_secret:=vault.create_secret(p_refresh_token);
    insert into public.homework_video_drive_connections(tenant_id,google_subject,permission_id,email,oauth_client_id,refresh_secret_id)
      values(p_tenant,p_google_subject,p_permission_id,p_email,p_oauth_client_id,v_secret) returning id into v_id;
  end if;
  insert into public.homework_video_drive_settings(tenant_id,connection_id,root_folder_id,enabled,version,updated_at)
    values(p_tenant,v_id,null,false,v_new,now())
    on conflict(tenant_id) do update set connection_id=excluded.connection_id,
      root_folder_id=case when public.homework_video_drive_settings.connection_id=v_id then public.homework_video_drive_settings.root_folder_id else null end,
      enabled=case when public.homework_video_drive_settings.connection_id=v_id then public.homework_video_drive_settings.enabled else false end,
      version=v_new,updated_at=now();
  return jsonb_build_object('connectionId',v_id,'version',v_new);
end $$;

create or replace function public.read_homework_video_drive_connection(p_tenant uuid,p_connection uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('connectionId',c.id,'oauthClientId',c.oauth_client_id,'refreshToken',v.decrypted_secret,
    'tokenVersion',c.token_version,'status',c.status)
  from public.homework_video_drive_connections c join vault.decrypted_secrets v on v.id=c.refresh_secret_id
  where c.tenant_id=p_tenant and c.id=p_connection
$$;
create or replace function public.read_homework_video_drive_credential(p_tenant uuid,p_root text,p_connection uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.homework_video_drive_roots where tenant_id=p_tenant and root_folder_id=p_root
    and connection_id is not distinct from p_connection) then return null; end if;
  if p_connection is null then return jsonb_build_object('legacy',true); end if;
  return public.read_homework_video_drive_connection(p_tenant,p_connection);
end $$;
create or replace function public.mark_homework_video_drive_needs_reauth(p_tenant uuid,p_connection uuid,p_token_version integer)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.homework_video_drive_connections set status='needs_reauth',updated_at=now()
    where tenant_id=p_tenant and id=p_connection and token_version=p_token_version;
  return found;
end $$;
revoke all on function public.claim_homework_video_drive_legacy_account(uuid,text,text,text),
  public.connect_homework_video_drive_account(uuid,uuid,text,text,text,text,text,text),
  public.read_homework_video_drive_connection(uuid,uuid),public.read_homework_video_drive_credential(uuid,text,uuid),
  public.mark_homework_video_drive_needs_reauth(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_homework_video_drive_legacy_account(uuid,text,text,text),
  public.connect_homework_video_drive_account(uuid,uuid,text,text,text,text,text,text),
  public.read_homework_video_drive_connection(uuid,uuid),public.read_homework_video_drive_credential(uuid,text,uuid),
  public.mark_homework_video_drive_needs_reauth(uuid,uuid,integer) to service_role;
commit;
notify pgrst,'reload schema';
