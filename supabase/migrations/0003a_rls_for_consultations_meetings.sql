-- RLS for student_consultations + meeting_minutes
alter table public.student_consultations enable row level security;
alter table public.meeting_minutes enable row level security;

drop policy if exists sc_tenant_isolation on public.student_consultations;
create policy sc_tenant_isolation on public.student_consultations
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists mm_tenant_isolation on public.meeting_minutes;
create policy mm_tenant_isolation on public.meeting_minutes
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

-- updated_at auto-bump
drop trigger if exists student_consultations_set_updated_at on public.student_consultations;
create trigger student_consultations_set_updated_at
  before update on public.student_consultations
  for each row execute function public.tg_set_updated_at();

drop trigger if exists meeting_minutes_set_updated_at on public.meeting_minutes;
create trigger meeting_minutes_set_updated_at
  before update on public.meeting_minutes
  for each row execute function public.tg_set_updated_at();
