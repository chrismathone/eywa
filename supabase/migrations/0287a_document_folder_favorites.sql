-- Personal document-folder shortcuts. A user can save at most ten folders in one tenant.
begin;

create table if not exists public.document_folder_favorites (
  tenant_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  folder_key text not null,
  added_at timestamptz not null default now(),
  primary key (tenant_id, user_id, folder_key),
  constraint document_folder_favorites_folder_fk foreign key (tenant_id, folder_key)
    references public.document_categories(tenant_id, key) on delete cascade
);

create index if not exists document_folder_favorites_order_idx
  on public.document_folder_favorites(tenant_id, user_id, added_at desc, folder_key);

alter table public.document_folder_favorites enable row level security;
drop policy if exists document_folder_favorites_own on public.document_folder_favorites;
create policy document_folder_favorites_own on public.document_folder_favorites
  for all using (tenant_id = public.auth_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.auth_tenant_id() and user_id = auth.uid());

revoke all on public.document_folder_favorites from public, anon;
grant select, insert, delete on public.document_folder_favorites to authenticated;

-- Lock by person before counting, so simultaneous tabs cannot both add an eleventh favorite.
create or replace function public.guard_document_folder_favorite_limit() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.tenant_id is distinct from public.auth_tenant_id() or new.user_id is distinct from auth.uid() then
    raise exception 'favorite_permission';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('document-folder-favorites:' || new.tenant_id || ':' || new.user_id, 0));
  if exists (select 1 from public.document_folder_favorites
      where tenant_id = new.tenant_id and user_id = new.user_id and folder_key = new.folder_key) then
    return new;
  end if;
  if (select count(*) from public.document_folder_favorites
      where tenant_id = new.tenant_id and user_id = new.user_id) >= 10 then
    raise exception 'favorite_limit';
  end if;
  return new;
end;
$$;
drop trigger if exists document_folder_favorites_limit on public.document_folder_favorites;
create trigger document_folder_favorites_limit before insert on public.document_folder_favorites
  for each row execute function public.guard_document_folder_favorite_limit();

notify pgrst, 'reload schema';
commit;
