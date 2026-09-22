-- MCS: one overall goal per student/class. Derived month/week/day targets are not stored.
-- Existing math_month_goals and lesson_reports remain unchanged.
create table if not exists public.math_learning_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null,
  student_id uuid not null,
  study_grade text not null check (char_length(study_grade) between 1 and 60),
  start_block text not null check (char_length(start_block) between 1 and 500),
  end_block text not null check (char_length(end_block) between 1 and 500),
  start_date date not null,
  end_date date not null,
  textbook text check (char_length(textbook) <= 500),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint math_learning_goals_dates_ck check (end_date >= start_date and end_date - start_date <= 730),
  constraint math_learning_goals_position_uq unique (tenant_id, class_id, student_id),
  constraint math_learning_goals_class_fk foreign key (tenant_id, class_id) references public.classes(tenant_id, id) on delete cascade,
  constraint math_learning_goals_student_fk foreign key (tenant_id, student_id) references public.students(tenant_id, id) on delete cascade
);
alter table public.math_learning_goals enable row level security;
revoke all on table public.math_learning_goals from public, anon, authenticated;
grant all on table public.math_learning_goals to service_role;
drop trigger if exists set_updated_at on public.math_learning_goals;
create trigger set_updated_at before update on public.math_learning_goals
  for each row execute function public.tg_set_updated_at();
notify pgrst, 'reload schema';
