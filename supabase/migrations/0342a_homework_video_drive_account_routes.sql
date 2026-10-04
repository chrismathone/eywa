-- 연결 계정과 폴더를 함께 고정한다. 구 코드의 공용 계정 저장 경로는 닫는다.
begin;
create or replace function public.save_homework_video_drive_account_setting(
  p_tenant uuid,p_expected_version uuid,p_connection uuid,p_root text,p_enabled boolean,p_verified_roots jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_version uuid; v_selected uuid; v_new uuid:=gen_random_uuid(); v_item jsonb;
  v_owner uuid; v_connection uuid; v_path text[]; v_root public.homework_video_drive_roots;
begin
  perform pg_advisory_xact_lock(338104);
  select version,connection_id into v_version,v_selected from public.homework_video_drive_settings where tenant_id=p_tenant for update;
  if v_version is distinct from p_expected_version then raise exception '다른 화면에서 설정이 변경되었습니다. 새로고침해 주세요'; end if;
  if p_enabled is null then raise exception '영상 저장 설정을 다시 확인해 주세요'; end if;
  if not p_enabled and (p_connection is not null or p_root is not null) then raise exception '연결 해제 값을 다시 확인해 주세요'; end if;
  if p_enabled and (p_connection is null or p_connection is distinct from v_selected or p_root is null
    or not exists(select 1 from public.homework_video_drive_connections where tenant_id=p_tenant and id=p_connection and status='ready')) then
    raise exception '이 지점의 Google 계정을 연결한 뒤 폴더를 지정해 주세요';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_verified_roots,'[]')) loop
    v_owner:=(v_item->>'tenantId')::uuid; v_connection:=(v_item->>'connectionId')::uuid;
    v_path:=array(select jsonb_array_elements_text(v_item->'ancestorIds'));
    if v_owner is null or v_path[1] is distinct from v_item->>'rootId' or cardinality(v_path) not between 1 and 64
      or (v_item->>'chainComplete') is distinct from 'true'
      or exists(select 1 from unnest(v_path) id where id !~ '^[A-Za-z0-9_-]{10,}$')
      or cardinality(v_path)<>(select count(distinct id) from unnest(v_path) id) then
      raise exception '영상 폴더 경로가 올바르지 않습니다';
    end if;
    select * into v_root from public.homework_video_drive_roots where root_folder_id=v_item->>'rootId';
    if found then
      if v_root.tenant_id<>v_owner or v_root.connection_id is distinct from v_connection then
        raise exception '이 폴더는 지정할 수 없습니다. 비어 있는 새 폴더를 지정해 주세요';
      end if;
    elsif not p_enabled or v_owner<>p_tenant or v_connection is distinct from p_connection or v_item->>'rootId' is distinct from p_root then
      raise exception '영상 폴더 소유 정보를 확인해 주세요';
    end if;
    insert into public.homework_video_drive_roots(root_folder_id,tenant_id,connection_id,folder_name,ancestor_ids,ancestry_verified,chain_complete)
      values(v_item->>'rootId',v_owner,v_connection,coalesce(v_item->>'folderName',''),v_path,true,true)
      on conflict(root_folder_id) do update set folder_name=excluded.folder_name,ancestor_ids=excluded.ancestor_ids,
        ancestry_verified=true,chain_complete=true;
  end loop;
  if p_enabled then
    if not exists(select 1 from public.homework_video_drive_roots where tenant_id=p_tenant and root_folder_id=p_root
      and connection_id=p_connection and ancestry_verified and chain_complete)
      or exists(select 1 from public.homework_video_drive_roots where not ancestry_verified or not chain_complete) then
      raise exception '기존 영상 폴더 정보를 확인한 뒤 저장해 주세요';
    end if;
    if exists(select 1 from public.homework_video_drive_roots a join public.homework_video_drive_roots b
      on a.root_folder_id<>b.root_folder_id and (a.root_folder_id=any(b.ancestor_ids) or b.root_folder_id=any(a.ancestor_ids))
      where a.root_folder_id=p_root) then
      raise exception '이 폴더는 지정할 수 없습니다. 비어 있는 새 폴더를 지정해 주세요';
    end if;
  end if;
  insert into public.homework_video_drive_settings(tenant_id,connection_id,root_folder_id,enabled,version,updated_at)
    values(p_tenant,p_connection,p_root,p_enabled,v_new,now())
    on conflict(tenant_id) do update set connection_id=excluded.connection_id,root_folder_id=excluded.root_folder_id,
      enabled=excluded.enabled,version=v_new,updated_at=now();
  return v_new;
end $$;
create or replace function public.save_homework_video_drive_setting(p_tenant uuid,p_expected_version uuid,p_root text,p_enabled boolean,p_verified_roots jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
begin raise exception '이 지점의 Google 계정을 연결한 뒤 폴더를 지정해 주세요'; end $$;
revoke all on function public.save_homework_video_drive_setting(uuid,uuid,text,boolean,jsonb) from public,anon,authenticated,service_role;

create or replace function public.guard_homework_video_drive_root_binding()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.root_folder_id is distinct from old.root_folder_id
    or new.connection_id is distinct from old.connection_id then raise exception '영상 폴더의 연결 계정은 변경할 수 없습니다'; end if;
  return new;
end $$;
drop trigger if exists homework_video_drive_root_binding on public.homework_video_drive_roots;
create trigger homework_video_drive_root_binding before update of tenant_id,root_folder_id,connection_id on public.homework_video_drive_roots
  for each row execute function public.guard_homework_video_drive_root_binding();

create or replace function public.guard_homework_video_drive_route()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_root text:=new.route->>'rootId'; v_connection text:=new.route->>'connectionId';
  v_old text; v_owned uuid; v_setting public.homework_video_drive_settings; v_configured boolean; v_pinned boolean:=false;
begin
  if tg_op='UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then raise exception '영상의 소속 지점은 변경할 수 없습니다'; end if;
    v_old:=nullif(old.route->>'rootId','');
    if v_old is not null then
      if v_root is distinct from v_old or v_connection is distinct from old.route->>'connectionId' then
        raise exception '시작한 영상의 저장 폴더와 연결 계정은 변경할 수 없습니다';
      end if;
      return new;
    end if;
  end if;
  if v_root is null then
    if v_connection is not null then raise exception '영상 저장 폴더 설정을 확인해 주세요'; end if;
    return new;
  end if;
  perform pg_advisory_xact_lock(338104);
  select connection_id into v_owned from public.homework_video_drive_roots where tenant_id=new.tenant_id and root_folder_id=v_root;
  if not found or v_owned::text is distinct from v_connection then raise exception '영상 저장 폴더와 연결 계정 설정을 확인해 주세요'; end if;
  select * into v_setting from public.homework_video_drive_settings where tenant_id=new.tenant_id;
  v_configured:=found;
  if tg_table_name='student_homework_videos' then
    if new.source='link' then
      select exists(select 1 from public.homework_video_link_uploads where tenant_id=new.tenant_id and id::text=new.source_ref
        and route->>'rootId'=v_root and route->>'connectionId' is not distinct from v_connection) into v_pinned;
    end if;
  end if;
  if not v_pinned and ((v_configured and (not v_setting.enabled or v_setting.root_folder_id is distinct from v_root
    or v_setting.connection_id is distinct from v_owned)) or (not v_configured and v_owned is not null)) then
    raise exception '영상 저장 연결이 변경되었습니다. 발송 PC 연결을 확인해 주세요';
  end if;
  return new;
end $$;
drop trigger if exists homework_video_drive_route_guard on public.student_homework_videos;
create trigger homework_video_drive_route_guard before insert or update of route,tenant_id on public.student_homework_videos
  for each row execute function public.guard_homework_video_drive_route();
drop trigger if exists homework_video_upload_drive_route_guard on public.homework_video_link_uploads;
create trigger homework_video_upload_drive_route_guard before insert or update of route,tenant_id on public.homework_video_link_uploads
  for each row execute function public.guard_homework_video_drive_route();
revoke all on function public.save_homework_video_drive_account_setting(uuid,uuid,uuid,text,boolean,jsonb),
  public.guard_homework_video_drive_root_binding(),public.guard_homework_video_drive_route() from public,anon,authenticated;
grant execute on function public.save_homework_video_drive_account_setting(uuid,uuid,uuid,text,boolean,jsonb),
  public.guard_homework_video_drive_root_binding(),public.guard_homework_video_drive_route() to service_role;
commit;
notify pgrst,'reload schema';
