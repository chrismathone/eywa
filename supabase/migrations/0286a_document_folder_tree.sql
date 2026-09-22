-- 문서 분류를 임의 깊이의 폴더 트리로 확장한다. 기존 키와 문서 연결은 유지한다.
begin;
alter table public.document_categories add column if not exists parent_key text;
create index if not exists document_categories_parent_idx on public.document_categories(tenant_id, parent_key, sort_order, key);
create unique index if not exists document_categories_sibling_label_uq on public.document_categories(tenant_id, coalesce(parent_key, ''), label);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'document_categories_parent_fk' and conrelid = 'public.document_categories'::regclass) then
    alter table public.document_categories add constraint document_categories_parent_fk
      foreign key (tenant_id, parent_key) references public.document_categories(tenant_id, key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'academy_documents_category_fk' and conrelid = 'public.academy_documents'::regclass) then
    -- NOT VALID는 오래된 자료를 변경하지 않는다. 신규 쓰기/폴더 삭제는 항상 검증한다.
    alter table public.academy_documents add constraint academy_documents_category_fk
      foreign key (tenant_id, category) references public.document_categories(tenant_id, key) not valid;
  end if;
end $$;

create or replace function public.guard_document_folder_tree() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v_tenant uuid;
begin
  v_tenant := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  perform pg_advisory_xact_lock(hashtextextended('document-folders:' || v_tenant::text, 0));
  if tg_op = 'DELETE' then
    if old.is_system and exists(select 1 from public.tenants where id = old.tenant_id) then
      raise exception 'folder_system';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.key is distinct from old.key or new.is_system is distinct from old.is_system) then
    raise exception 'folder_identity_immutable';
  end if;
  if new.parent_key is not null then
    if new.parent_key = new.key then raise exception 'folder_cycle'; end if;
    if not exists(select 1 from public.document_categories where tenant_id = new.tenant_id and key = new.parent_key) then
      raise exception 'folder_parent_missing';
    end if;
    if exists(
      with recursive ancestors as (
        select key, parent_key from public.document_categories where tenant_id = new.tenant_id and key = new.parent_key
        union
        select c.key, c.parent_key from public.document_categories c join ancestors a on c.key = a.parent_key where c.tenant_id = new.tenant_id
      ) select 1 from ancestors where key = new.key
    ) then raise exception 'folder_cycle'; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists document_categories_tree_guard on public.document_categories;
create trigger document_categories_tree_guard before insert or update or delete on public.document_categories
  for each row execute function public.guard_document_folder_tree();

-- 한 폴더 변경을 한 트랜잭션으로 처리한다. 삭제 도중 실패하면 문서 이동도 되돌린다.
create or replace function public.mutate_document_folder(
  p_operation text, p_key text default null, p_label text default null,
  p_parent_key text default null, p_direction text default null, p_absorb_into text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := public.auth_tenant_id();
  current_folder public.document_categories%rowtype;
  v_key text;
  v_label text;
  v_order integer;
  v_moved integer := 0;
  v_keys text[];
  v_index integer;
  v_swap integer;
  v_temp text;
begin
  if v_tenant is null then raise exception 'folder_permission'; end if;
  perform pg_advisory_xact_lock(hashtextextended('document-folders:' || v_tenant::text, 0));
  if p_operation in ('create', 'rename') then
    v_label := btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
    if length(v_label) not between 1 and 20 then raise exception 'folder_label'; end if;
  end if;
  if p_operation = 'create' then
    v_key := 'cat_' || replace(gen_random_uuid()::text, '-', '');
    select coalesce(max(sort_order), 0) + 10 into v_order from public.document_categories
      where tenant_id = v_tenant and parent_key is not distinct from p_parent_key;
    insert into public.document_categories(tenant_id, key, label, parent_key, sort_order)
      values(v_tenant, v_key, v_label, p_parent_key, v_order);
    return jsonb_build_object('ok', true, 'key', v_key, 'label', v_label, 'parentKey', p_parent_key);
  end if;
  select * into current_folder from public.document_categories where tenant_id = v_tenant and key = p_key for update;
  if not found then raise exception 'folder_missing'; end if;
  if p_operation = 'rename' then
    update public.document_categories set label = v_label where tenant_id = v_tenant and key = p_key;
  elsif p_operation = 'reparent' then
    select coalesce(max(sort_order), 0) + 10 into v_order from public.document_categories
      where tenant_id = v_tenant and parent_key is not distinct from p_parent_key;
    update public.document_categories set parent_key = p_parent_key, sort_order = v_order where tenant_id = v_tenant and key = p_key;
  elsif p_operation = 'reorder' then
    if p_direction not in ('up', 'down') or p_direction is null then raise exception 'folder_invalid'; end if;
    select array_agg(key order by sort_order, key) into v_keys from public.document_categories
      where tenant_id = v_tenant and parent_key is not distinct from current_folder.parent_key;
    v_index := array_position(v_keys, p_key);
    v_swap := v_index + case when p_direction = 'up' then -1 else 1 end;
    if v_swap between 1 and array_length(v_keys, 1) then
      v_temp := v_keys[v_swap]; v_keys[v_swap] := v_keys[v_index]; v_keys[v_index] := v_temp;
      update public.document_categories c set sort_order = x.position * 10
        from unnest(v_keys) with ordinality x(key, position) where c.tenant_id = v_tenant and c.key = x.key;
    end if;
  elsif p_operation = 'delete' then
    if current_folder.is_system then raise exception 'folder_system'; end if;
    if exists(select 1 from public.document_categories where tenant_id = v_tenant and parent_key = p_key) then
      raise exception 'folder_has_children';
    end if;
    if p_absorb_into is null or p_absorb_into = p_key or not exists(
      select 1 from public.document_categories where tenant_id = v_tenant and key = p_absorb_into
    ) then raise exception 'folder_parent_missing'; end if;
    update public.academy_documents set category = p_absorb_into, updated_at = now() where tenant_id = v_tenant and category = p_key;
    get diagnostics v_moved = row_count;
    delete from public.document_categories where tenant_id = v_tenant and key = p_key;
  else raise exception 'folder_invalid';
  end if;
  return jsonb_build_object('ok', true, 'key', p_key, 'label', coalesce(v_label, current_folder.label),
    'fromLabel', current_folder.label, 'fromParentKey', current_folder.parent_key, 'parentKey', p_parent_key, 'moved', v_moved);
end;
$$;
revoke all on function public.mutate_document_folder(text,text,text,text,text,text) from public, anon;
grant execute on function public.mutate_document_folder(text,text,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
