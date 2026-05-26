-- RLS for enrollment_consultations + consultation_ai_analysis
alter table public.enrollment_consultations enable row level security;
alter table public.consultation_ai_analysis enable row level security;

drop policy if exists ec_tenant_isolation on public.enrollment_consultations;
create policy ec_tenant_isolation on public.enrollment_consultations
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

-- AI analysis rows are tenant-scoped via their consultation parent.
drop policy if exists ai_tenant_isolation on public.consultation_ai_analysis;
create policy ai_tenant_isolation on public.consultation_ai_analysis
  for all to authenticated
  using (
    exists (
      select 1 from public.enrollment_consultations ec
      where ec.id = consultation_ai_analysis.consultation_id
        and ec.tenant_id = public.auth_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from public.enrollment_consultations ec
      where ec.id = consultation_ai_analysis.consultation_id
        and ec.tenant_id = public.auth_tenant_id()
    )
  );

-- updated_at auto-bump on enrollment_consultations
drop trigger if exists enrollment_consultations_set_updated_at on public.enrollment_consultations;
create trigger enrollment_consultations_set_updated_at
  before update on public.enrollment_consultations
  for each row execute function public.tg_set_updated_at();
