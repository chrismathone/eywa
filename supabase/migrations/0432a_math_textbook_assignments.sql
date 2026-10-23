-- 수학 교재 배정 — 반 교재 + 학생별 교재(원장 2026-10-19 *"수학의 경우 반에 교재 배정도 되지만 평균적으로
-- 학생 한명당 교재 등록해서 쓸수있기에 2가지 모두 기능 추가"*).
--
-- 🔑 한 줄 = 한 자리의 '지금 교재' 하나. 자리는 둘이다:
--    · student_id null  = 반 교재(그 반 학생 전원의 기본 교재)
--    · student_id 있음  = 그 학생만의 교재 — 반 교재보다 **우선**한다(규칙은 src/features/textbooks/math-assignment.ts 한 곳)
--    한 자리에 한 권이라 유니크를 `nulls not distinct`로 건다(반 교재 줄이 둘 생기지 않게). 🔴 부분 유니크(WHERE) 금지([[#113]]).
-- 🔴 영어의 `class_textbook_plans`(ECS 시트에 차수를 기입하는 배정)와 **다른 물건**이다 — 수학은 시트 칸에 아무것도
--    자동으로 쓰지 않는다. 그래서 표를 따로 둔다.
-- ⚠️ 앱은 이 표가 없어도 돈다([[#95]]) — 수학 강사 시트·교재목록은 그대로 열리고, 배정 칸만 "적용 전"으로 잠긴다.
--
-- 롤백:
--   drop table if exists public.math_textbook_assignments;
set local statement_timeout = '60s';

create table if not exists public.math_textbook_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null,
  student_id uuid references public.students(id) on delete cascade,
  textbook_id uuid not null
    constraint math_textbook_assignments_textbook_fkey references public.textbooks(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint math_textbook_assignments_slot_uniq unique nulls not distinct (tenant_id, class_id, student_id)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'math_textbook_assignments_class_fk') then
    alter table public.math_textbook_assignments
      add constraint math_textbook_assignments_class_fk
      foreign key (tenant_id, class_id) references public.classes (tenant_id, id) on delete cascade;
  end if;
end $$;

create index if not exists math_textbook_assignments_textbook_idx
  on public.math_textbook_assignments (tenant_id, textbook_id);

comment on table public.math_textbook_assignments is
  '수학 교재 배정 — student_id null = 반 교재, 있으면 그 학생 교재(반 교재보다 우선). 자리마다 한 권.';

drop trigger if exists math_textbook_assignments_set_updated_at on public.math_textbook_assignments;
create trigger math_textbook_assignments_set_updated_at before update on public.math_textbook_assignments
  for each row execute function public.tg_set_updated_at();

-- ── RLS — 읽기는 테넌트 전원, 쓰기는 service_role(서버 액션)만 (0266a와 같은 모양) ──────────
alter table public.math_textbook_assignments enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'math_textbook_assignments' and policyname = 'math_textbook_assignments_read'
  ) then
    create policy math_textbook_assignments_read on public.math_textbook_assignments
      for select using (tenant_id = public.auth_tenant_id());
  end if;
end $$;

notify pgrst, 'reload schema';
