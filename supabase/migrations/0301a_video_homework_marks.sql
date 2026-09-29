-- Video homework precheck, shared by the teacher onescreen and management view.
create table if not exists public.video_homework_marks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null,
  student_id uuid not null,
  round_no smallint not null check (round_no between 1 and 10),
  status text not null check (status in ('submitted', 'timed', 'missing')),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_homework_marks_class_fk foreign key (tenant_id, class_id)
    references public.classes(tenant_id, id) on delete cascade,
  constraint video_homework_marks_student_fk foreign key (tenant_id, student_id)
    references public.students(tenant_id, id) on delete cascade,
  constraint video_homework_marks_unique unique (tenant_id, class_id, student_id, round_no)
);

create index if not exists video_homework_marks_student_idx
  on public.video_homework_marks (tenant_id, student_id);

alter table public.video_homework_marks enable row level security;
revoke all on public.video_homework_marks from public, anon, authenticated;
grant select, insert, update, delete on public.video_homework_marks to service_role;

notify pgrst, 'reload schema';
