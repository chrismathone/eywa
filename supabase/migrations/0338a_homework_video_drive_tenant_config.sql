-- 지점별 숙제영상 저장 폴더. 인증 값은 저장하지 않는다.
-- 기존 영상/폴더를 이동하지 않고 과거 루트 소유권을 보존한다.
begin;

create table if not exists public.homework_video_drive_roots (
  root_folder_id text primary key check (root_folder_id ~ '^[A-Za-z0-9_-]{10,}$'),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  folder_name text not null default '',
  ancestor_ids text[] not null,
  ancestry_verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, root_folder_id),
  check (root_folder_id = any(ancestor_ids))
);
create table if not exists public.homework_video_drive_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  root_folder_id text,
  enabled boolean not null default false,
  version uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, root_folder_id) references public.homework_video_drive_roots(tenant_id, root_folder_id),
  check (not enabled or root_folder_id is not null)
);
alter table public.homework_video_drive_roots enable row level security;
alter table public.homework_video_drive_settings enable row level security;
revoke all on public.homework_video_drive_roots, public.homework_video_drive_settings from public, anon, authenticated;
grant all on public.homework_video_drive_roots, public.homework_video_drive_settings to service_role;

-- 같은 루트를 여러 지점이 이미 쓰면 임의로 소유자를 고르지 않는다.
do $$ begin
  if exists(select 1 from public.classnote_video_folders group by root_folder_id having count(distinct tenant_id)>1) then
    raise exception '여러 지점이 같은 영상 폴더를 사용하고 있어 확인이 필요합니다';
  end if;
end $$;
insert into public.homework_video_drive_roots(root_folder_id,tenant_id,ancestor_ids)
select distinct root_folder_id,tenant_id,array[root_folder_id] from public.classnote_video_folders
on conflict(root_folder_id) do nothing;

create or replace function public.save_homework_video_drive_setting(
  p_tenant uuid, p_expected_version uuid, p_root text, p_enabled boolean, p_verified_roots jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_version uuid; v_new uuid := gen_random_uuid(); v_item jsonb; v_owner uuid; v_path text[];
begin
  perform pg_advisory_xact_lock(338104);
  select version into v_version from public.homework_video_drive_settings where tenant_id=p_tenant for update;
  if v_version is distinct from p_expected_version then raise exception '다른 화면에서 설정이 변경되었습니다. 새로고침해 주세요'; end if;
  if p_enabled and (p_root is null or p_root !~ '^[A-Za-z0-9_-]{10,}$') then raise exception '영상 폴더가 올바르지 않습니다'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_verified_roots,'[]')) loop
    v_owner := (v_item->>'tenantId')::uuid;
    v_path := array(select jsonb_array_elements_text(v_item->'ancestorIds'));
    if not (v_item->>'rootId'=any(v_path)) or cardinality(v_path)>64 then raise exception '영상 폴더 경로가 올바르지 않습니다'; end if;
    if exists(select 1 from public.homework_video_drive_roots where root_folder_id=v_item->>'rootId' and tenant_id<>v_owner) then
      raise exception '이 폴더는 지정할 수 없습니다. 비어 있는 새 폴더를 지정해 주세요';
    end if;
    if v_owner<>p_tenant and not exists(select 1 from public.homework_video_drive_roots where root_folder_id=v_item->>'rootId' and tenant_id=v_owner) then
      raise exception '영상 폴더 소유 정보가 올바르지 않습니다';
    end if;
    insert into public.homework_video_drive_roots(root_folder_id,tenant_id,folder_name,ancestor_ids,ancestry_verified)
    values(v_item->>'rootId',v_owner,coalesce(v_item->>'folderName',''),v_path,true)
    on conflict(root_folder_id) do update set folder_name=excluded.folder_name,ancestor_ids=excluded.ancestor_ids,ancestry_verified=true;
  end loop;
  -- 공통 부모를 공유하는 형제 폴더는 허용. 루트 자체가 상대의 경로 안에 있을 때만 겹친다.
  if p_enabled and exists(select 1 from public.homework_video_drive_roots a join public.homework_video_drive_roots b
    on a.root_folder_id<b.root_folder_id and
       (a.root_folder_id=any(b.ancestor_ids) or b.root_folder_id=any(a.ancestor_ids))
    where a.root_folder_id=p_root or b.root_folder_id=p_root) then
    raise exception '이 폴더는 지정할 수 없습니다. 비어 있는 새 폴더를 지정해 주세요';
  end if;
  if p_enabled and not exists(select 1 from public.homework_video_drive_roots where tenant_id=p_tenant and root_folder_id=p_root) then
    raise exception '영상 폴더 소유 정보를 확인할 수 없습니다';
  end if;
  insert into public.homework_video_drive_settings(tenant_id,root_folder_id,enabled,version,updated_at)
  values(p_tenant,p_root,p_enabled,v_new,now())
  on conflict(tenant_id) do update set root_folder_id=excluded.root_folder_id,enabled=excluded.enabled,version=excluded.version,updated_at=now();
  return v_new;
end $$;
revoke all on function public.save_homework_video_drive_setting(uuid,uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.save_homework_video_drive_setting(uuid,uuid,text,boolean,jsonb) to service_role;

-- 구 워커의 새 작업 각인도 활성 설정을 따라야 한다. 이미 각인된 작업은 옛 루트에서 완료한다.
create or replace function public.guard_homework_video_drive_route()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_root text := new.route->>'rootId'; v_old text; v_active text; v_enabled boolean; v_configured boolean; v_pinned boolean := false;
begin
  if tg_op='UPDATE' then
    v_old := old.route->>'rootId';
    if v_old is not null then
      if v_root is distinct from v_old then raise exception '시작한 영상의 저장 폴더는 변경할 수 없습니다'; end if;
      return new;
    end if;
  end if;
  if v_root is null then return new; end if;
  perform pg_advisory_xact_lock(338104);
  if exists(select 1 from public.homework_video_drive_roots where root_folder_id=v_root and tenant_id<>new.tenant_id) then
    raise exception '다른 지점의 영상 폴더에는 저장할 수 없습니다';
  end if;
  -- 설정 행이 없는 기존 지점도 이관된 소유 루트만 쓴다. 구 PC의 env 변경으로 새 루트를 우회 등록하지 않는다.
  if not exists(select 1 from public.homework_video_drive_roots where root_folder_id=v_root and tenant_id=new.tenant_id) then
    raise exception '영상 저장 폴더 설정을 확인해 주세요';
  end if;
  select root_folder_id,enabled,true into v_active,v_enabled,v_configured from public.homework_video_drive_settings where tenant_id=new.tenant_id;
  if coalesce(v_configured,false) then
    if tg_table_name='student_homework_videos' then
      if new.source='link' then
        select exists(select 1 from public.homework_video_link_uploads where tenant_id=new.tenant_id
          and id::text=new.source_ref and route->>'rootId'=v_root) into v_pinned;
      end if;
    end if;
    if not exists(select 1 from public.homework_video_drive_roots where root_folder_id=v_root and tenant_id=new.tenant_id)
      or (not v_pinned and (not v_enabled or v_active is distinct from v_root)) then
      raise exception '영상 저장 폴더 설정이 변경되었습니다. 발송 PC 연결을 확인해 주세요';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_homework_video_drive_route() from public,anon,authenticated;
drop trigger if exists homework_video_drive_route_guard on public.student_homework_videos;
create trigger homework_video_drive_route_guard before insert or update of route on public.student_homework_videos
for each row execute function public.guard_homework_video_drive_route();
drop trigger if exists homework_video_upload_drive_route_guard on public.homework_video_link_uploads;
create trigger homework_video_upload_drive_route_guard before insert or update of route on public.homework_video_link_uploads
for each row execute function public.guard_homework_video_drive_route();

commit;
notify pgrst,'reload schema';
