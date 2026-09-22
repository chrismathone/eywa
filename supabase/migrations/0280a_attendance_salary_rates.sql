-- Attendance: teacher-specific regular/special x elementary/middle/high rates.
-- Kept separate from public class metadata and from legacy payslip snapshots.
create table if not exists public.attendance_salary_rates (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  teacher_id uuid not null references public.users(id) on delete cascade,
  rates jsonb not null check (jsonb_typeof(rates) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, teacher_id)
);
alter table public.attendance_salary_rates enable row level security;
-- Server-only access. The application checks attendance administrator permission,
-- teacher-view scope, tenant membership, and freelance status before reading/writing.
revoke all on public.attendance_salary_rates from anon, authenticated;
grant all on public.attendance_salary_rates to service_role;
notify pgrst, 'reload schema';
