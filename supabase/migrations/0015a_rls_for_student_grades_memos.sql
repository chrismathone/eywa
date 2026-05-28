-- RLS for student_grades + student_memos
alter table public.student_grades enable row level security;
alter table public.student_memos enable row level security;

drop policy if exists student_grades_tenant_isolation on public.student_grades;
create policy student_grades_tenant_isolation on public.student_grades
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists student_memos_tenant_isolation on public.student_memos;
create policy student_memos_tenant_isolation on public.student_memos
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());
