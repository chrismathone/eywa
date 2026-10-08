-- Apply before deploying updated workers. Stop legacy workers separately.
create table public.worker_execution_leases (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  worker_kind text not null check (worker_kind in ('classnote', 'makeedu', 'unified')),
  instance_id uuid not null,
  generation bigint not null check (generation > 0),
  expires_at timestamptz not null,
  primary key (tenant_id, worker_kind)
);
alter table public.worker_execution_leases enable row level security;
revoke all on public.worker_execution_leases from public, anon, authenticated;

create function public.claim_worker_execution_lease(p_tenant uuid, p_kind text, p_instance uuid)
returns table(generation bigint, remaining_ms bigint)
language sql security definer set search_path = pg_catalog as $$
  insert into public.worker_execution_leases as held (tenant_id, worker_kind, instance_id, generation, expires_at)
  values (p_tenant, p_kind, p_instance, 1, clock_timestamp() + interval '180 seconds')
  on conflict (tenant_id, worker_kind) do update set
    instance_id = excluded.instance_id,
    generation = case when held.instance_id = excluded.instance_id and held.expires_at > clock_timestamp()
      then held.generation else held.generation + 1 end,
    expires_at = clock_timestamp() + interval '180 seconds'
  where held.instance_id = excluded.instance_id or held.expires_at <= clock_timestamp()
  returning held.generation, floor(extract(epoch from (held.expires_at - clock_timestamp())) * 1000)::bigint;
$$;

create function public.renew_worker_execution_lease(p_tenant uuid, p_kind text, p_instance uuid, p_generation bigint)
returns table(generation bigint, remaining_ms bigint)
language sql security definer set search_path = pg_catalog as $$
  update public.worker_execution_leases as held
  set expires_at = clock_timestamp() + interval '180 seconds'
  where held.tenant_id = p_tenant and held.worker_kind = p_kind
    and held.instance_id = p_instance and held.generation = p_generation
    and held.expires_at > clock_timestamp()
  returning held.generation, floor(extract(epoch from (held.expires_at - clock_timestamp())) * 1000)::bigint;
$$;

create function public.release_worker_execution_lease(p_tenant uuid, p_kind text, p_instance uuid, p_generation bigint)
returns boolean
language sql security definer set search_path = pg_catalog as $$
  with released as (
    update public.worker_execution_leases as held set expires_at = clock_timestamp()
    where held.tenant_id = p_tenant and held.worker_kind = p_kind
      and held.instance_id = p_instance and held.generation = p_generation
    returning 1
  ) select exists(select from released);
$$;

revoke all on function public.claim_worker_execution_lease(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.renew_worker_execution_lease(uuid, text, uuid, bigint) from public, anon, authenticated;
revoke all on function public.release_worker_execution_lease(uuid, text, uuid, bigint) from public, anon, authenticated;
grant execute on function public.claim_worker_execution_lease(uuid, text, uuid) to service_role;
grant execute on function public.renew_worker_execution_lease(uuid, text, uuid, bigint) to service_role;
grant execute on function public.release_worker_execution_lease(uuid, text, uuid, bigint) to service_role;
